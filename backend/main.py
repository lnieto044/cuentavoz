"""La API de CuentaVoz. Aqui se conectan la tableta, el agente y la base."""
import json
import os
import re
import secrets
import socket
import threading
import unicodedata
import urllib.error
import urllib.request
from datetime import timedelta
from horario import ahora

from dotenv import load_dotenv
load_dotenv()

# Apagado por defecto (sin SENTRY_DSN no llama a init ni manda nada a
# ningun lado) - se deja cableado para que activarlo en produccion sea
# solo poner la variable de entorno, sin tocar codigo. send_default_pii
# en False a proposito: Usuario.correo es un correo real de empleado, no
# hay que dejarlo viajar a un tercero por defecto.
import sentry_sdk
_SENTRY_DSN = os.environ.get("SENTRY_DSN", "").strip()
if _SENTRY_DSN:
    sentry_sdk.init(dsn=_SENTRY_DSN, traces_sample_rate=0.0, send_default_pii=False)

from fastapi import (FastAPI, WebSocket, WebSocketDisconnect, Depends,
                     HTTPException, UploadFile, File, Request)
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from bd import Sesion, iniciar_bd
from modelos import (Usuario, Bodega, Articulo, StockSistema, SesionConteo,
                     Conteo, Alerta, Traza, LineaServicio, AsignacionBodega,
                     Aprobacion, HistorialCierre, ConfigClave,
                     Receta, RecetaIngrediente, MensajeSoporte)
from seguridad import (usuario_actual, requiere_perfil, registrar, esquema,
                       COGNITO_REGION, COGNITO_USER_POOL_ID)
from agente.orquestador import procesar_turno, ESTADOS, avance
from servicios.recetas import (calcular_pedido, comparar_legalizacion,
                               analisis_consumo, detalle_receta, _filas_a_legalizar)
from servicios.validacion import umbral_actual, validar_conteo
from servicios import analitica
from servicios.interprete import _numero as _numero_de_texto
import reportes


def _cliente_cognito():
    """El backend administra Cognito (sembrar las cuentas demo, cerrar
    todas las sesiones de una persona) con SU PROPIA credencial de AWS -
    distinta de la que se uso para crear el User Pool: esta solo puede
    AdminCreateUser/AdminSetUserPassword/AdminGetUser/
    AdminUserGlobalSignOut sobre este User Pool en particular, nada mas
    (ver el usuario de IAM "cuentavoz-backend"). Sin AWS_ACCESS_KEY_ID
    configurada (desarrollo local sin AWS a mano), boto3 revienta al
    hacer la primera llamada real, no aqui - se deja igual que el patron
    ya usado para Gemini/Brevo: se degrada en el momento de usarla, no al
    arrancar."""
    import boto3
    return boto3.client("cognito-idp", region_name=COGNITO_REGION)

app = FastAPI(title="CuentaVoz", version="1.0.0",
              description="Asistente por voz para inventarios · Colsubsidio")

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
def _manejador_limite_excedido(request: Request, exc: RateLimitExceeded):
    # El manejador por defecto de slowapi responde {"error": "..."} en vez
    # de {"detail": "..."}, que es la clave que pedir() (api.js) y toda la
    # app ya saben leer para mostrar el mensaje real - sin esto, cualquier
    # pantalla que tropieza con un limite (ingreso, huella, busqueda de
    # perfil...) mostraba "Error 429" en vez de avisar que hay que esperar.
    respuesta = JSONResponse(
        {"detail": "Demasiados intentos. Espere un momento y vuelva a intentarlo."},
        status_code=429)
    _poner_cabeceras_cors(respuesta, request)   # mismo motivo que en el de 500
    return respuesta


@app.exception_handler(Exception)
def _manejador_error_no_capturado(request: Request, exc: Exception):
    # FastAPI ya responde 500 solo ante una excepcion no manejada, pero sin
    # la forma {"detail": "..."} que pedir() (api.js) espera - sin esto, un
    # error real (no uno ya convertido a HTTPException) se veia en pantalla
    # como un mensaje crudo en vez del aviso en español de siempre.
    if _SENTRY_DSN:
        sentry_sdk.capture_exception(exc)
    print(f"[error no capturado] {request.method} {request.url.path}: "
          f"{type(exc).__name__}: {exc}")
    respuesta = JSONResponse({"detail": "Ocurrió un error inesperado. Intente de nuevo."},
                             status_code=500)
    _poner_cabeceras_cors(respuesta, request)
    return respuesta


def _poner_cabeceras_cors(respuesta, request: Request) -> None:
    """Le pega las cabeceras CORS a mano a una respuesta de error.

    Los manejadores de excepcion de Starlette corren POR FUERA del
    CORSMiddleware, asi que sus respuestas salen sin esas cabeceras. El
    navegador entonces no bloquea el error: bloquea la RESPUESTA ENTERA, y
    fetch() lanza un TypeError indistinguible de quedarse sin red. Costo
    real de ese detalle: un 500 de verdad (una insercion que fallaba en
    Postgres) llego a la pantalla como "Sin conexion con el servidor.
    Revise el Wi-Fi", mandando a buscar el problema en el router mientras
    el servidor respondia perfecto. Con las cabeceras puestas, el error se
    ve tal cual es."""
    origen = request.headers.get("origin")
    if origen and origen in _origenes:
        respuesta.headers["Access-Control-Allow-Origin"] = origen
        respuesta.headers["Access-Control-Allow-Credentials"] = "true"
        respuesta.headers["Vary"] = "Origin"


_origenes = {o.strip() for o in os.getenv("ORIGEN_PERMITIDO", "").split(",") if o.strip()}
# 5173 es "npm run dev"; 4173 es "npm run preview" (el build de produccion,
# el unico que arma el service worker real - hace falta para probar el
# modo sin conexion tal como queda desplegado, no solo en modo desarrollo).
_origenes |= {"http://localhost:5173", "http://127.0.0.1:5173",
             "http://localhost:4173", "http://127.0.0.1:4173"}

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(_origenes),
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)


@app.middleware("http")
async def cabeceras(request: Request, llamar):
    resp = await llamar(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "SAMEORIGIN"
    resp.headers["Referrer-Policy"] = "no-referrer"
    # obliga HTTPS en cada visita futura del navegador, no solo en esta -
    # sin esto, un enlace http:// (o un portal cautivo de Wi-Fi) puede
    # interceptar la primera peticion antes de que el servidor la redirija.
    resp.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return resp


# Las 4 cuentas de demostracion (luis/diana/stephanie/valentina, clave
# "StockXperts1" - la misma que aparece en el README) solo se siembran si
# esta variable esta activa. Por defecto NO lo esta: sin esto, cualquier
# despliegue con la base de usuarios vacia -incluido un Render de
# produccion real, con datos reales, antes de que alguien cree las
# cuentas de verdad- quedaba con una cuenta de perfil auditor (diana, con
# permisos de administrador) accesible con una clave publicada. Para el
# hackathon esto se activa a proposito en render.yaml; para un uso real
# despues, basta con no ponerla (o quitarla) para que esas cuentas nunca
# aparezcan solas.
SEMBRAR_DEMO = os.getenv("SEMBRAR_DEMO", "").strip() == "1"
# La clave de las cuentas de demostracion vive en Cognito, no en esta base -
# tiene que cumplir la politica del User Pool (min. 8, mayuscula+minuscula+
# numero). "StockXperts" sola no trae numero; se le agrego un "1" al
# migrar a Cognito (ver README.md/LEEME_PRIMERO.md, ya actualizados).
CLAVE_DEMO = "StockXperts1"


def _crear_usuario_cognito(nombre: str, correo: str, clave: str) -> bool:
    """Crea la cuenta en Cognito con la clave dada, ya confirmada
    (MessageAction=SUPPRESS: no le manda el correo de bienvenida
    automatico de Cognito - esta app ya avisa la clave por su cuenta,
    por voz o en pantalla - y Permanent=True: entra de una con esa clave,
    sin el paso extra de "cambie su clave temporal" que exige Cognito
    para claves no permanentes). Usado tanto al sembrar las cuentas de
    demo como al crear un usuario nuevo por voz o desde Ajustes. Si ya
    existe, no revienta: se ignora y se avisa por consola."""
    cliente = _cliente_cognito()
    try:
        cliente.admin_create_user(
            UserPoolId=COGNITO_USER_POOL_ID, Username=nombre,
            UserAttributes=[{"Name": "email", "Value": correo},
                            {"Name": "email_verified", "Value": "true"},
                            {"Name": "name", "Value": nombre}],
            MessageAction="SUPPRESS",
        )
        cliente.admin_set_user_password(
            UserPoolId=COGNITO_USER_POOL_ID, Username=nombre,
            Password=clave, Permanent=True,
        )
        return True
    except cliente.exceptions.UsernameExistsException:
        return False
    except Exception as e:
        print(f"[cognito] no se pudo crear la cuenta de {nombre}: {e}")
        return False


def _actualizar_correo_cognito(nombre: str, correo: str) -> bool:
    """Cognito es quien manda el código al recuperar clave o al confirmar
    un registro - si el correo cambia aquí (Mi perfil o Ajustes) sin
    avisarle a Cognito, esos códigos seguirían yendo al correo viejo para
    siempre, sin que nada en la pantalla lo delatara. email_verified=true
    porque este cambio lo hace un administrador o la propia persona ya
    autenticada, no alguien sin verificar tratando de robar la cuenta."""
    try:
        _cliente_cognito().admin_update_user_attributes(
            UserPoolId=COGNITO_USER_POOL_ID, Username=nombre,
            UserAttributes=[{"Name": "email", "Value": correo},
                            {"Name": "email_verified", "Value": "true"}],
        )
        return True
    except Exception as e:
        print(f"[cognito] no se pudo actualizar el correo de {nombre}: {e}")
        return False


@app.on_event("startup")
def arranque():
    iniciar_bd()
    with Sesion() as s:
        if SEMBRAR_DEMO and s.query(Usuario).count() == 0:
            s.add_all([
                Usuario(nombre="luis", perfil="auxiliar",
                        correo="lnieto@colsubsidio.com", codigo="CS-48127"),
                Usuario(nombre="diana", perfil="auditor",
                        correo="diana@colsubsidio.com", codigo="CS-48200"),
                Usuario(nombre="stephanie", perfil="auxiliar",
                        correo="stephanie@colsubsidio.com", codigo="CS-48311"),
                Usuario(nombre="valentina", perfil="auxiliar",
                        correo="valentina@colsubsidio.com", codigo="CS-48342"),
            ])
            s.commit()
            for nombre, correo in (("luis", "lnieto@colsubsidio.com"),
                                   ("diana", "diana@colsubsidio.com"),
                                   ("stephanie", "stephanie@colsubsidio.com"),
                                   ("valentina", "valentina@colsubsidio.com")):
                _crear_usuario_cognito(nombre, correo, CLAVE_DEMO)
            print(f"[arranque] usuarios de prueba creados (clave {CLAVE_DEMO})")
        elif s.query(Usuario).count() == 0:
            print("[arranque] base de usuarios vacia y SEMBRAR_DEMO no esta activo: "
                  "no se crearon cuentas de prueba. Registrese desde Ingreso, "
                  "o active SEMBRAR_DEMO=1 para la demo.")

        # bodegas asignadas por persona: solo la primera vez, solo si ya hay
        # bodegas cargadas (cargar_excel.py corre antes que la API), y solo
        # si las cuentas de prueba de arriba existen de verdad - sin
        # SEMBRAR_DEMO no hay "luis"/"stephanie"/"valentina" a quien
        # asignarles nada.
        if SEMBRAR_DEMO and s.query(AsignacionBodega).count() == 0 and s.query(Bodega).count() > 0:
            # del Excel real de Colsubsidio, solo un subconjunto de bodegas
            # trae existencia de sistema (SD) cargada - las demas son
            # ubicaciones del catalogo sin stock_sistema asociado. Priorizar
            # esas para el reparto demo evita que un auxiliar de prueba abra
            # una bodega con "0 referencias" y no pueda mostrar diferencias
            # contra el sistema en una demo en vivo.
            con_stock = {bid for (bid,) in s.query(StockSistema.bodega_id).distinct()}
            todas = s.query(Bodega).order_by(Bodega.nombre_oficial).all()
            bodegas = sorted(todas, key=lambda b: (b.id not in con_stock, b.nombre_oficial))
            usuarios = {u.nombre: u for u in s.query(Usuario).all()}
            reparto = {"luis": bodegas[0:3], "stephanie": bodegas[3:6],
                      "valentina": bodegas[6:9]}
            total = 0
            for nombre, asignadas in reparto.items():
                u = usuarios.get(nombre)
                if not u:
                    continue
                for b in asignadas:
                    s.add(AsignacionBodega(usuario_id=u.id, bodega_id=b.id))
                    total += 1
            s.commit()
            if total:
                print(f"[arranque] {total} bodegas asignadas a los auxiliares de prueba")

        # el conteo inicial de negativos, para que el panel muestre "N -> 0"
        if s.query(ConfigClave).filter_by(clave="negativos_iniciales").first() is None:
            neg = s.query(StockSistema).filter(StockSistema.cantidad_sd < 0).count()
            s.add(ConfigClave(clave="negativos_iniciales", valor=str(neg)))
            s.commit()

        # un par de cierres de ejemplo, para que el histórico de exactitud
        # del panel no arranque vacío (etiquetados como semilla, no reales)
        if s.query(HistorialCierre).count() == 0 and s.query(Bodega).count() > 0:
            primera = s.query(Bodega).order_by(Bodega.nombre_oficial).first()
            from datetime import timedelta
            base = ahora() - timedelta(days=120)
            for i, exact in enumerate([94.2, 95.8, 96.5, 97.1]):
                s.add(HistorialCierre(bodega_id=primera.id, exactitud=exact,
                                      referencias=0, diferencias=0,
                                      fecha=base + timedelta(days=30 * i)))
            s.commit()
            print("[arranque] histórico de exactitud sembrado (4 puntos de ejemplo)")


@app.get("/api/salud")
def salud():
    with Sesion() as s:
        return {"api": "ok",
                "bodegas": s.query(Bodega).count(),
                "articulos": s.query(Articulo).count(),
                "stock": s.query(StockSistema).count(),
                "gemini": bool(os.getenv("GOOGLE_API_KEY", "").strip()),
                "cognito": _estado_cognito()}


def _estado_cognito() -> dict:
    """Con que User Pool y App Client esta trabajando ESTE backend.

    No es informacion secreta: el User Pool Id y el App Client Id viajan en
    el JavaScript que se descarga cualquiera que abra la aplicacion (ver
    frontend/src/cognito.js) - por eso pueden ir aqui sin problema, y no se
    expone nada mas (ni llaves de AWS, ni claves).

    Existe porque estas tres variables van como sync:false en render.yaml,
    o sea que viven solo en el panel de Render: si una queda vacia o
    desactualizada, TODOS los tokens se rechazan con "Sesion invalida o
    vencida.", que suena a problema de la persona cuando en realidad es de
    configuracion. Comparar esto contra el frontend responde en un segundo
    algo que si no toca adivinar."""
    from seguridad import (COGNITO_REGION as reg, COGNITO_USER_POOL_ID as pool,
                           COGNITO_APP_CLIENT_ID as cli, _jwks_client)
    return {"region": reg,
            "user_pool_id": pool or "(sin definir)",
            "app_client_id": cli or "(sin definir)",
            "puede_verificar_tokens": _jwks_client is not None}


# ─────────────────────── identidad ───────────────────────
def _buscar_usuario_por_entrada(s, entrada: str):
    """Se puede ingresar con el nombre de usuario o con el codigo de
    empleado (ej. CS-48127) - lo que la persona tenga a la mano."""
    entrada = entrada.strip()
    return s.query(Usuario).filter(
        (Usuario.nombre == entrada.lower()) | (Usuario.codigo == entrada.upper())
    ).first()


@app.get("/api/usuarios/perfil")
@limiter.limit("20/minute")
def perfil_por_usuario(request: Request, usuario: str = ""):
    """Para que la pantalla de ingreso muestre «Auxiliar» o «Administrador»
    apenas se escribe el usuario, sin esperar a iniciar sesion. Solo
    devuelve el perfil (nada mas sensible: ni nombre, ni correo) y esta
    limitado por minuto para no servir de lista para adivinar usuarios
    validos. El login mismo (usuario+clave) lo resuelve Cognito
    directamente desde el frontend - este backend nunca ve la clave."""
    if not usuario.strip():
        return {"perfil": None}
    with Sesion() as s:
        u = _buscar_usuario_por_entrada(s, usuario)
        if not u or not u.activo:
            return {"perfil": None}
    return {"perfil": u.perfil}


class RegistroCompletadoIn(BaseModel):
    nombre_completo: str
    codigo: str = ""
    correo: str


@app.post("/api/registro-completado")
@limiter.limit("10/minute")
def registro_completado(request: Request, datos: RegistroCompletadoIn,
                        token: str = Depends(esquema)):
    """Cognito ya creo Y confirmo la cuenta (el codigo que Cognito manda al
    correo al registrarse) antes de llegar aqui - el frontend inicia
    sesion contra Cognito justo despues de confirmar y llama esto con ese
    token, no con datos sueltos. Aqui solo se crea la fila LOCAL que sabe
    el perfil y las bodegas asignadas, cosas que Cognito no conoce. El
    nombre de usuario sale del token ya verificado, nunca del cuerpo de
    la peticion - y el perfil queda SIEMPRE "auxiliar": nadie puede
    autoasignarse el perfil de auditor solo registrandose, ese ascenso
    lo hace un administrador despues desde Ajustes.

    La cuenta queda ACTIVA de inmediato: quien confirmo el codigo que
    Cognito le mando al correo ya puede entrar, sin esperar a que un
    administrador la habilite. Se probo la variante con aprobacion previa
    y se descarto por decision de producto - agregaba una espera entre
    registrarse y poder trabajar que no compensaba, dado que el perfil
    siempre nace como auxiliar y sus permisos estan limitados a las
    bodegas que un auditor le asigne (ver AsignacionBodega). Si alguna vez
    hay que bloquear a alguien, editar_usuario ya permite desactivarlo."""
    from seguridad import _reclamos_cognito
    reclamos = _reclamos_cognito(token) if token else None
    if reclamos is None:
        raise HTTPException(401, "Sesion de Cognito invalida o vencida.")
    nombre = (reclamos.get("username") or "").strip().lower()
    if not nombre:
        raise HTTPException(400, "No se pudo identificar el usuario de Cognito.")
    with Sesion() as s:
        if s.query(Usuario).filter_by(nombre=nombre).first():
            # ya existe (ej. reintento de red tras un primer registro que
            # si alcanzo a crear la fila) - no es un error, solo confirma.
            return {"ok": True, "ya_existia": True}
        nuevo = Usuario(nombre=nombre, perfil="auxiliar",
                        correo=(datos.correo or "").strip(),
                        codigo=(datos.codigo or "").strip().upper())
        s.add(nuevo)
        s.commit()
        s.refresh(nuevo)
        if not nuevo.codigo:
            nuevo.codigo = f"CS-{48000 + nuevo.id}"
            s.commit()
    registrar(nuevo, "USUARIO", f"{nombre} se registro por su cuenta", "ok")
    return {"ok": True, "ya_existia": False}


# ─────────────────────── el agente ───────────────────────
class TurnoIn(BaseModel):
    texto: str
    sesion_id: int = 1
    # respaldo de resiliencia: si el backend se reinicio a mitad de una
    # pregunta "¿cual de los dos?", el frontend ya sabe cuales opciones
    # estaban pendientes y se las recuerda - ver Pedido.jsx/Conteo.jsx.
    opciones_pendientes: list[dict] | None = None
    opciones_para: str | None = None
    # el mismo respaldo mas la bodega abierta: sin esto, un reinicio del
    # backend deja el frontend mostrando "en conteo" mientras el servidor
    # ya no sabe cual bodega es - el agente termina diciendo "no hay
    # ninguna activa" con la bodega bien visible en la pantalla.
    bodega_id_respaldo: int | None = None
    bodega_nombre_respaldo: str | None = None
    # lo mismo para Pedidos: el plato y las porciones casi siempre se dictan
    # en frases separadas ("arroz con pollo" y despues "para cuatro"); sin
    # este respaldo, un reinicio del backend a mitad de esas dos frases deja
    # al agente sin memoria del plato aunque la pantalla lo siga mostrando.
    preparacion_respaldo: str | None = None
    porciones_respaldo: int | None = None


@app.post("/api/agente/turno")
async def turno(t: TurnoIn, u: Usuario = Depends(usuario_actual)):
    # procesar_turno() es sincrono y llama a Gemini (pensar()), que puede
    # tardar varios segundos - llamarlo directo aqui (una ruta async def)
    # bloqueaba TODO el event loop mientras tanto: cualquier otra peticion,
    # de cualquier otra persona, a cualquier endpoint (hasta /api/salud) se
    # quedaba esperando. run_in_threadpool lo saca del hilo principal para
    # que el resto de la aplicacion siga respondiendo mientras Gemini piensa.
    r = await run_in_threadpool(procesar_turno, t.texto, t.sesion_id, u,
                                opciones_respaldo=t.opciones_pendientes,
                                opciones_para_respaldo=t.opciones_para,
                                bodega_id_respaldo=t.bodega_id_respaldo,
                                bodega_nombre_respaldo=t.bodega_nombre_respaldo,
                                preparacion_respaldo=t.preparacion_respaldo,
                                porciones_respaldo=t.porciones_respaldo)
    if r.get("bodega"):
        await difundir_estado()
    return r


class PreguntarAsistenteIn(BaseModel):
    texto: str
    vista: str


# claves = lo mismo que usa ir(destino) en App.jsx; deben calzar exacto,
# si no la navegacion por voz apunta a una vista que no existe.
_DESTINOS_ASISTENTE = {
    "inicio": "Inicio", "pedido": "Pedidos", "conteo": "Conteo",
    "legalizacion": "Legalización", "bodegas": "Bodegas",
    "auditoria": "Auditoría", "reportes": "Reportes", "panel": "Panel",
    "ajustes": "Ajustes", "ayuda": "Ayuda", "perfil": "Mi perfil",
}
_SOLO_AUDITOR_ASISTENTE = {"auditoria", "reportes", "panel", "ajustes"}

# pantallas con pestañas propias: para no obligar a la persona a llegar y
# después dar clic en la pestaña que quería, si la pide de una vez
# ("llévame al análisis de consumo") el agente navega directo a ella. La
# clave interna debe ser la misma que usa cada vista en su useState(tab).
_PESTANAS_ASISTENTE = {
    "reportes": {"consolidado": "Consolidado de la toma", "analisis": "Análisis de consumo"},
    "ajustes": {"config": "Configuración", "usuarios": "Gestión de usuarios",
               "recetas": "Recetas", "traza": "Registro de trazabilidad"},
    "panel": {"resumen": "Resumen ejecutivo", "alertas": "Bodegas y alertas"},
    "auditoria": {"recuento": "Recuento ciego y cierre", "aprobaciones": "Aprobaciones",
                 "pedidos": "Pedidos pendientes", "alertas": "Bandeja de alertas"},
}

_FAQ_ASISTENTE = [
    ("¿Cómo corrijo un conteo ya confirmado?",
     "Diga «corregir» y luego el valor correcto; el valor anterior se conserva."),
    ("El agente no entiende un producto",
     "Dígalo como aparece en la etiqueta; si no existe se puede crear, queda pendiente."),
    ("¿Qué hago si sale una alerta?",
     "Recuente; si el número es correcto, confirme: queda marcado para el administrador."),
    ("Se cayó el internet en plena bodega",
     "Siga contando: el intérprete local mantiene el flujo y sincroniza al volver la señal."),
    ("¿Puedo contar dos bodegas a la vez?",
     "No en el mismo dispositivo; el candado de sesión evita conteos duplicados."),
]


def _datos_panel_narrados() -> dict:
    """Los mismos datos de /api/panel/resumen y /api/panel/alertas, ya
    convertidos a frases listas para hablar - los usan tanto el contexto
    completo que recibe Gemini como las respuestas determinísticas de
    _responder_panel_por_voz, para no calcular el texto dos veces."""
    r = analitica.resumen_ejecutivo()
    a = analitica.resumen_alertas_panel()
    dif_bod = r["diferencia_por_bodega"]
    texto_dif = ("sin diferencias registradas todavía" if not dif_bod else
                 "; ".join(f"{x['bodega'].title()}: {x['diferencia']}" for x in dif_bod[:6]))
    stock = r["stock_por_unidad"]
    texto_stock = ("sin datos de stock todavía" if not stock else
                   ", ".join(f"{x['unidad']} {x['pct']}% ({x['cantidad']})" for x in stock))
    hist = r["historial_exactitud"]
    if len(hist) < 2:
        texto_hist = "todavía no hay suficientes cierres para ver una tendencia"
    else:
        tendencia = "mejorando" if hist[-1]["exactitud"] >= hist[0]["exactitud"] else "bajando"
        texto_hist = (f"{len(hist)} tomas registradas, la más reciente en "
                      f"{hist[-1]['bodega'].title()} con {hist[-1]['exactitud']}%, "
                      f"tendencia {tendencia}")
    etiquetas_estado = {"cerrada": "cerradas", "en_conteo": "en conteo",
                        "en_auditoria": "en auditoría", "pendiente": "pendientes"}
    texto_estado = (", ".join(f"{n} {etiquetas_estado.get(e, e)}"
                              for e, n in a["estado_bodegas"].items())
                    or "sin bodegas registradas")
    alertas_tipo = a["alertas_por_tipo"]
    texto_alertas_tipo = ("sin alertas registradas todavía" if not alertas_tipo else
                          ", ".join(f"{x['tipo']}: {x['cantidad']}" for x in alertas_tipo))
    descuadres = a["descuadres_recurrentes"]
    texto_descuadres = ("sin descuadres repetidos todavía" if not descuadres else
                        "; ".join(f"{x['articulo'].title()} ({x['tipo']}, diferencia "
                                 f"{x['diferencia']} en {x['tomas']} tomas, acción sugerida: "
                                 f"{x['accion']})" for x in descuadres[:5]))
    return {"r": r, "a": a, "texto_dif": texto_dif, "texto_stock": texto_stock,
            "texto_hist": texto_hist, "texto_estado": texto_estado,
            "texto_alertas_tipo": texto_alertas_tipo, "texto_descuadres": texto_descuadres}


# Preguntas frecuentes del Panel gerencial, resueltas sin pasar por Gemini.
# Sin esto, una pregunta tan común como "¿cuántas bodegas están cerradas?"
# a veces terminaba navegando a la pantalla Bodegas en vez de contestar
# (confirmado en pruebas: al mencionar el nombre de otra pantalla, Gemini
# no siempre distingue preguntar de navegar) - las mismas frases que se
# ofrecen en el desplegable "Ver frases exactas" de Panel quedan así
# garantizadas.
_PANEL_PREGUNTAS = [
    (re.compile(r"\bprimera\s+pasada\b", re.IGNORECASE),
     lambda d: f"La exactitud primera pasada es del {d['r']['exactitud_primera_pasada']}%, "
               "promedio de cierres."),
    (re.compile(r"\breferencias?\b.*\bcontad\w*|\bcu[aá]nt\w*\s+referencias\b", re.IGNORECASE),
     lambda d: f"Se han contado {d['r']['referencias_contadas']} referencias en toda la "
               "operación."),
    (re.compile(r"\balertas?\b.*\bgestionad\w*", re.IGNORECASE),
     lambda d: f"Van {d['r']['alertas_gestionadas']} alertas gestionadas de "
               f"{d['r']['alertas_total']} en total."),
    (re.compile(r"\bc[oó]mo\s+(est[aá]n|van)\s+las\s+bodegas\b|\bestado\s+de\s+las\s+bodegas\b",
               re.IGNORECASE),
     lambda d: f"Estado de las bodegas: {d['texto_estado']}."),
    (re.compile(r"\bcu[aá]nt\w*\s+bodegas\b.*\bcerrad\w*|\bbodegas\s+cerradas\b", re.IGNORECASE),
     lambda d: f"Van {d['r']['bodegas_cerradas']} bodegas cerradas de {d['r']['bodegas_total']} "
               "en total, con doble firma digital."),
    (re.compile(r"\bqu[eé]\s+bodega\b.*\bdiferencia\b|\bdiferencia\s+absoluta\s+por\s+bodega\b",
               re.IGNORECASE),
     lambda d: f"Diferencia absoluta por bodega: {d['texto_dif']}."),
    (re.compile(r"\bstock\s+por\s+unidad\b|\bc[oó]mo\s+va\s+el\s+stock\b", re.IGNORECASE),
     lambda d: f"Stock por unidad de medida: {d['texto_stock']}."),
    (re.compile(r"\btendencia\s+de\s+exactitud\b|\bexactitud\s+por\s+toma\b", re.IGNORECASE),
     lambda d: f"Exactitud por toma de inventario: {d['texto_hist']}."),
    (re.compile(r"\bnegativos?\b.*\bcorregid\w*|\bcu[aá]nt\w*\s+negativos\b", re.IGNORECASE),
     lambda d: (f"Saldos negativos en el sistema: {d['a']['negativos_actuales']} artículos. "
                "La corrección se hace en My Inventory, no en CuentaVoz."
                if d['a']['negativos_iniciales'] == d['a']['negativos_actuales'] else
                f"Saldos negativos: {d['a']['negativos_iniciales']} al inicio de este período, "
                f"{d['a']['negativos_actuales']} ahora.")),
    (re.compile(r"\btiempo\s+promedio\s+de\s+conteo\b", re.IGNORECASE),
     lambda d: f"El tiempo promedio de conteo por bodega es de "
               f"{d['a']['tiempo_promedio_min']} minutos."),
    (re.compile(r"\balias\s+aprendid\w*|\bcu[aá]nt\w*\s+alias\b", re.IGNORECASE),
     lambda d: f"El agente tiene {d['a']['alias_aprendidos']} alias aprendidos."),
    (re.compile(r"\balertas\s+por\s+tipo\b", re.IGNORECASE),
     lambda d: f"Alertas por tipo: {d['texto_alertas_tipo']}."),
    (re.compile(r"\bdescuadre\w*\s+(principal|recurrent\w*)\b|\bcausa\s+ra[ií]z\b",
               re.IGNORECASE),
     lambda d: f"Descuadres recurrentes: {d['texto_descuadres']}."),
]


def _responder_panel_por_voz(texto: str, u: Usuario) -> dict | None:
    if u.perfil != "auditor":
        return None
    for patron, respuesta in _PANEL_PREGUNTAS:
        if patron.search(texto):
            return {"respuesta_hablada": respuesta(_datos_panel_narrados()),
                    "accion": None, "destino": None, "pestana": None}
    return None


def _formato_acceso_hablado(fecha_dt) -> str | None:
    """Mismo criterio que formatoAcceso() en MiPerfil.jsx (hoy HH:MM vs
    DD/MM HH:MM) - para que lo que diga el agente coincida con lo que la
    pantalla ya muestra escrito."""
    if not fecha_dt:
        return None
    if fecha_dt.date() == ahora().date():
        return f"hoy a las {fecha_dt.strftime('%H:%M')}"
    return f"el {fecha_dt.strftime('%d/%m')} a las {fecha_dt.strftime('%H:%M')}"


def _datos_perfil_narrados(u: Usuario) -> dict:
    from agente.cerebro import VOCES, VOZ_DEFECTO
    with Sesion() as s:
        usr = s.get(Usuario, u.id)
        asigs = s.query(AsignacionBodega).filter_by(usuario_id=u.id).all()
        nombres_bodegas = [b.nombre_oficial.title() for b in
                           (s.get(Bodega, a.bodega_id) for a in asigs) if b]
        dias_pin = (ahora() - (usr.pin_actualizado or ahora())).days
        voz = usr.idioma_voz if usr.idioma_voz in VOCES else VOZ_DEFECTO
        return {
            "ultimo_acceso_hablado": _formato_acceso_hablado(usr.ultimo_acceso),
            "pin_vence_en_dias": max(90 - dias_pin, 0),
            "n_bodegas": len(nombres_bodegas),
            "texto_bodegas": "; ".join(nombres_bodegas),
            "perfil": usr.perfil,
            "velocidad_voz": usr.velocidad_voz,
            "confirmacion_hablada": bool(usr.confirmacion_hablada),
            "voz_nombre": VOCES[voz]["nombre"],
            "voz_etiqueta": VOCES[voz]["etiqueta"],
        }


_PERFIL_PREGUNTAS = [
    (re.compile(r"[uú]ltimo\s+acceso|cu[aá]ndo\s+(entr[eé]|ingres[eé])", re.IGNORECASE),
     lambda d: f"Su último acceso fue {d['ultimo_acceso_hablado']}." if d["ultimo_acceso_hablado"]
               else "Todavía no hay un acceso anterior registrado."),
    (re.compile(r"\bpin\b.*\bvence|vence\b.*\bpin\b|cu[aá]nt\w*\s+d[ií]as.*\bpin\b", re.IGNORECASE),
     lambda d: f"Su PIN vence en {d['pin_vence_en_dias']} días."),
    (re.compile(r"bodegas?\s+(tengo|asignad\w*)|cu[aá]nt\w*\s+bodegas", re.IGNORECASE),
     lambda d: (f"Tiene {d['n_bodegas']} bodegas asignadas: {d['texto_bodegas']}."
                if d["n_bodegas"] else "Todavía no tiene bodegas asignadas.")),
    (re.compile(r"mi\s+perfil\b|qu[eé]\s+perfil|soy\s+(auxiliar|admin\w*)", re.IGNORECASE),
     lambda d: f"Su perfil es {'administrador de bodega' if d['perfil'] == 'auditor' else 'auxiliar de inventarios'}."),
    (re.compile(r"qu[eé]\s+voz\s+(tengo|est[aá]|uso)|voz\s+actual", re.IGNORECASE),
     lambda d: f"Está usando la voz {d['voz_nombre']}: {d['voz_etiqueta'].lower()}."),
]


def _responder_perfil_por_voz(texto: str, u: Usuario) -> dict | None:
    for patron, respuesta in _PERFIL_PREGUNTAS:
        if patron.search(texto):
            return {"respuesta_hablada": respuesta(_datos_perfil_narrados(u)),
                    "accion": None, "destino": None, "pestana": None}
    return None


_VOCES_HABLADAS = ("kore", "aoede", "puck", "charon")
_VERBO_CAMBIAR_VOZ = re.compile(
    r"\b(cambia\w*|usa\w*|pon\w*|quiero|eli[jg]\w*|selecciona\w*)\b", re.IGNORECASE)


def _cambiar_voz_por_voz(texto: str, u: Usuario) -> dict | None:
    """"Cambia mi voz a puck" / "usa la voz aoede" - exige el nombre EXACTO
    de una de las cuatro voces (no un genero o descripcion), para no
    competir con "¿qué voz tengo?" ni con "prueba la voz" (probarVoz solo
    demuestra la que ya está elegida, no cambia nada)."""
    if not _VERBO_CAMBIAR_VOZ.search(texto):
        return None
    clave = next((k for k in _VOCES_HABLADAS if re.search(rf"\b{k}\b", texto, re.IGNORECASE)), None)
    if not clave:
        return None
    with Sesion() as s:
        usr = s.get(Usuario, u.id)
        usr.idioma_voz = clave
        s.commit()
    from agente.cerebro import VOCES
    registrar(u, "PERFIL", f"{u.nombre} cambió su voz a {VOCES[clave]['nombre']} por voz", "ok")
    return {"respuesta_hablada": f"Listo, ahora hablo con la voz {VOCES[clave]['nombre']}: "
                                 f"{VOCES[clave]['etiqueta'].lower()}.",
            "accion": "actualizar", "destino": None, "pestana": None, "idioma_voz": clave}


_VELOCIDAD_LENTA = re.compile(r"\blenta\b|m[aá]s\s+despacio|m[aá]s\s+lento", re.IGNORECASE)
_VELOCIDAD_RAPIDA = re.compile(r"\br[aá]pida\b|m[aá]s\s+r[aá]pido", re.IGNORECASE)
_VELOCIDAD_NORMAL = re.compile(r"velocidad\s+normal|voz\s+normal", re.IGNORECASE)


def _cambiar_velocidad_por_voz(texto: str, u: Usuario) -> dict | None:
    if _VELOCIDAD_LENTA.search(texto):
        nueva = "lenta"
    elif _VELOCIDAD_RAPIDA.search(texto):
        nueva = "rapida"
    elif _VELOCIDAD_NORMAL.search(texto):
        nueva = "normal"
    else:
        return None
    with Sesion() as s:
        usr = s.get(Usuario, u.id)
        usr.velocidad_voz = nueva
        s.commit()
    registrar(u, "PERFIL", f"{u.nombre} cambió la velocidad de voz a {nueva} por voz", "ok")
    return {"respuesta_hablada": f"Listo, la velocidad queda en {nueva}.",
            "accion": "actualizar", "destino": None, "pestana": None, "velocidad_voz": nueva}


_CONFIRMACION_HABLADA_FRASE = re.compile(r"confirmaci[oó]n\s+hablada", re.IGNORECASE)


def _cambiar_confirmacion_hablada_por_voz(texto: str, u: Usuario) -> dict | None:
    if not _CONFIRMACION_HABLADA_FRASE.search(texto):
        return None
    if _ACTIVAR.search(texto):
        nuevo = True
    elif _DESACTIVAR.search(texto):
        nuevo = False
    else:
        return None
    with Sesion() as s:
        usr = s.get(Usuario, u.id)
        usr.confirmacion_hablada = 1 if nuevo else 0
        s.commit()
    estado = "activada" if nuevo else "desactivada"
    registrar(u, "PERFIL", f"{u.nombre} dejó la confirmación hablada {estado} por voz", "ok")
    return {"respuesta_hablada": f"Listo, la confirmación hablada quedó {estado}.",
            "accion": "actualizar", "destino": None, "pestana": None,
            "confirmacion_hablada": nuevo}


def _contexto_asistente(vista: str, u: Usuario) -> str:
    """Un resumen honesto de lo que hay AHORA en esa pantalla, para que el
    agente conteste con datos reales y no invente nada. Reusa las mismas
    funciones que ya alimentan cada pantalla, no vuelve a calcular nada."""
    if vista == "inicio":
        with Sesion() as s:
            n_bodegas = s.query(AsignacionBodega).filter_by(usuario_id=u.id).count()
            alertas = s.query(Alerta).filter_by(resuelta=0).count()
            historial = s.query(HistorialCierre).all()
            exact = (round(sum(h.exactitud for h in historial) / len(historial), 1)
                     if historial else 100.0)
        return (f"Pantalla: Inicio, de {u.nombre} ({u.perfil}). "
                f"Bodegas asignadas a esta persona: {n_bodegas}. "
                f"Alertas por revisar en toda la operación: {alertas}. "
                f"Exactitud del mes: {exact}%.")
    if vista == "ajustes":
        a = ver_ajustes(u)
        # El permiso real de cambiar el modo sin conexión por voz ya se
        # resuelve antes de llegar aquí (_cambiar_modo_sin_conexion, que
        # exige perfil auditor) - este texto solo llega a Gemini cuando
        # esa orden exacta no aplicó (una pregunta suelta, o quien
        # pregunta no es administrador). Sin condicionarlo al perfil,
        # Gemini le decía a CUALQUIERA "ya lo activé" aunque el cambio de
        # verdad solo lo hace un administrador - la misma deshonestidad
        # que la Regla 6 ya evita en otras respuestas.
        permiso_offline = (
            "El modo sin conexión sí se puede cambiar por voz, pero solo por un "
            "administrador: decir «activa/desactiva el modo sin conexión» lo aplica de "
            "una, sin tocar el interruptor. En Gestión de usuarios, un administrador "
            "también puede decir «activa/desactiva a <nombre>» para cambiar el estado de "
            "otra persona, «crea un usuario llamado <nombre> perfil <auxiliar o "
            "auditor>» para crear una cuenta nueva (con PIN temporal), «cambia el "
            "perfil de <nombre> a auxiliar/administrador» para lo mismo que el botón "
            "«Editar» (el correo no se cambia por voz), «asígnale/quítale la bodega "
            "<bodega> a <nombre>» para lo mismo que el botón «Asignar bodegas» pero "
            "sumando o quitando solo esa bodega, no reemplazando toda la lista, y "
            "«¿quién tiene la bodega <bodega>?» o «¿cuántas bodegas sin asignar hay?» "
            "para contestar una pregunta puntual sin abrir nada, y «muéstrame/oculta "
            "la asignación por bodega» para abrir o cerrar la tabla completa - lo "
            "mismo que el botón «Ver/Ocultar asignación por bodega». En Recetas, un "
            "administrador también puede decir «crea una receta llamada "
            "<nombre>, rendimiento <N> porciones, con <cantidad> de <ingrediente>» "
            "(crea la receta con ese primer ingrediente ya resuelto contra el "
            "catálogo), «agrega <cantidad> de <ingrediente> a la receta <nombre>» "
            "(para sumarle más ingredientes después), «quita el ingrediente "
            "<ingrediente> de la receta <nombre>», «cambia el rendimiento de la "
            "receta <nombre> a <N> porciones», «agrega la preparación a la receta "
            "<nombre>: <pasos>» (reemplaza los pasos de cocina completos, tal cual "
            "se dicten, con los dos puntos como separador del nombre), y «elimina la "
            "receta <nombre>». "
            "En Registro de trazabilidad, «exporta el registro de trazabilidad» "
            "descarga el archivo con los filtros de fecha/persona/acción que ya "
            "estén puestos en la pantalla en ese momento (no los que diga la "
            "orden), «acciones por persona» resume cuántas hizo cada quien "
            "(hoy por defecto; «esta semana»/«este mes»/«en total» cambian el "
            "periodo), y «¿cuántas acciones tiene <nombre>?» contesta solo por esa "
            "persona. "
            "Todo esto SOLO funciona si la orden usa exactamente esas formas («crea un "
            "usuario llamado...», «cambia el perfil de... a...», «asígnale/quítale la "
            "bodega... a...», «crea una receta llamada..., rendimiento... porciones, "
            "con... de...», «agrega... a la receta...», «quita el ingrediente... de "
            "la receta...», «cambia el rendimiento de la receta... a...», «agrega la "
            "preparación a la receta...: ...», «elimina la receta...», «exporta el "
            "registro de trazabilidad», «acciones por persona», «cuántas acciones "
            "tiene...») - si "
            "el mensaje llega hasta usted es porque esa frase no se dijo así, el "
            "nombre de la persona/bodega no coincidió con ninguna existente, o el "
            "ingrediente no se encontró en el catálogo, así que no invente que ya "
            "creó, cambió, asignó, agregó o eliminó nada: pida que lo repitan con ese "
            "formato exacto y el nombre completo tal como aparece en la pantalla."
            if u.perfil == "auditor" else
            "El modo sin conexión, el estado de otras personas, crear/editar usuarios, "
            "asignar bodegas y crear/editar/eliminar recetas solo los puede hacer un "
            "administrador - esta persona no lo es, así que si lo pide, dígalo con "
            "honestidad en vez de decir que ya quedó hecho.")
        return (f"Pantalla: Ajustes. Sección Validación de datos: umbral de anomalía "
                f"{a['umbral']}%; bloquear cantidades negativas activado (regla fija, no "
                f"se puede desactivar); exigir confirmación en alertas activado (regla "
                f"fija); permitir crear productos pendientes activado (regla fija). "
                f"Sección Conexión y sincronización: modo sin conexión "
                f"{'activado' if a['offline'] else 'desactivado'}; refresco del tablero "
                f"en tiempo real. "
                f"Sección Administración: usuarios activos {a['usuarios_activos']}; "
                f"aprobaciones pendientes {a['aprobaciones_pendientes']}. Sección Acerca "
                f"de CuentaVoz: versión {a['version']}, modelo del agente {a['modelo']}. "
                "El umbral solo lo puede CAMBIAR un administrador, y únicamente con los "
                "controles de la pantalla (número y botón «Guardar configuración») - eso "
                f"todavía no cambia por voz. {permiso_offline}")
    if vista == "panel" and u.perfil == "auditor":
        d = _datos_panel_narrados()
        r, a = d["r"], d["a"]
        return (
            "Pantalla: Panel gerencial, con dos pestañas: «Resumen ejecutivo» y «Bodegas y "
            "alertas» - decir el nombre de cualquiera de las dos (o «llévame a...») navega "
            "directo a ella. "
            f"Pestaña Resumen ejecutivo - tarjetas: exactitud primera pasada "
            f"{r['exactitud_primera_pasada']}%, referencias contadas "
            f"{r['referencias_contadas']}, alertas gestionadas {r['alertas_gestionadas']} de "
            f"{r['alertas_total']}, bodegas cerradas {r['bodegas_cerradas']} de "
            f"{r['bodegas_total']}. Gráfica «Diferencia absoluta por bodega»: {d['texto_dif']}. "
            f"Gráfica «Stock por unidad de medida»: {d['texto_stock']}. Gráfica «Exactitud por "
            f"toma de inventario»: {d['texto_hist']}. "
            f"Pestaña Bodegas y alertas - tarjetas: saldos negativos en el sistema "
            f"{a['negativos_actuales']} artículos (la corrección se hace en My Inventory, no "
            "en CuentaVoz - dentro de una sola toma este número normalmente no se mueve), "
            f"tiempo promedio de conteo por bodega {a['tiempo_promedio_min']} minutos, "
            f"alias aprendidos por el agente {a['alias_aprendidos']}. Tarjeta «Estado de las "
            f"bodegas»: {d['texto_estado']}. Tarjeta «Alertas por tipo»: {d['texto_alertas_tipo']}. "
            f"Tabla «Descuadres recurrentes»: {d['texto_descuadres']}.")
    if vista == "reportes" and u.perfil == "auditor":
        d = _datos_reportes_narrados(u)
        a = d["analisis"]
        return ("Pantalla: Reportes, con dos pestañas: «Consolidado de la toma» y «Análisis de "
                "consumo». Aquí se genera el consolidado para My "
                "Inventory, las diferencias por bodega, y el análisis de consumo "
                "de los últimos 30 días. Los tres SÍ se pueden generar por voz "
                "(«genera el consolidado», «exporta las diferencias», «exporta el "
                "análisis de consumo») - queda igual que si le hubiera dado clic "
                f"al botón. Archivos generados recientemente: {d['texto_recientes']}. "
                f"Pestaña Análisis de consumo, últimos {a['dias']} días: pedido total "
                f"{a['pedido_total']} kg en {a['servicios_periodo']} servicios, usado "
                f"realmente {a['usado_total']} kg ({a['aprovechamiento']}% de "
                f"aprovechamiento), ahorro potencial {a['ahorro_potencial']} kg al mes. "
                f"Insumos subutilizados: {d['texto_subutil']}. También se puede pedir "
                "«muéstrame el archivo de <consolidado o diferencias>» para ver su "
                "contenido, igual que darle clic a la tarjeta.")
    if vista == "auditoria" and u.perfil == "auditor":
        d = _datos_auditoria_narrados(u)
        ra = d["resumen_alertas"]
        nombres_aprob = ("; ".join(a["nombre"].title() for a in d["aprobaciones"])
                         if d["aprobaciones"] else "ninguna")
        nombres_pedidos = ("; ".join(f"{p['persona'].title()}: {p['plato']}" for p in d["pedidos"])
                           if d["pedidos"] else "ninguno")
        return (f"Pantalla: Auditoría, con cuatro pestañas: «Recuento ciego y cierre», "
                f"«Aprobaciones», «Pedidos pendientes» y «Bandeja de alertas» - decir el "
                f"nombre de cualquiera (o «llévame a...») navega directo a ella. "
                f"Pestaña Aprobaciones: {len(d['aprobaciones'])} pendientes "
                f"({nombres_aprob}) - «aprueba/rechaza <nombre>» resuelve una. "
                f"Pestaña Pedidos pendientes: {len(d['pedidos'])} pendientes "
                f"({nombres_pedidos}) - «aprueba/rechaza el pedido de <persona o plato>» "
                f"resuelve uno. Pestaña Bandeja de alertas: {ra['abiertas']} abiertas, "
                f"{ra['resueltas_hoy']} resueltas hoy, tiempo medio "
                f"{ra['tiempo_medio_min'] if ra['tiempo_medio_min'] is not None else '—'} "
                "minutos - «resuelve la alerta de <artículo o bodega>» resuelve una. "
                "Pestaña Recuento ciego y cierre: «audita <bodega>» o «abre <bodega>» "
                "selecciona esa bodega lista para recuento o cierre, igual que darle clic "
                "a «Abrir» en su tarjeta - desde ahí, dictar los productos SÍ es por voz "
                "con el micrófono normal de esa pantalla (igual que en Conteo). Pero "
                "«Iniciar recuento ciego», «Ver comparación», «Aceptar todas», «Cerrar con "
                "doble firma», firmar con PIN, y «Cerrar bodega definitivamente» "
                "son A PROPÓSITO solo manuales - nadie cierra una bodega con doble firma "
                "por accidente con la voz. Si el mensaje llegó hasta usted es porque "
                "«aprueba/rechaza <nombre>», «aprueba/rechaza el pedido de <...>», "
                "«resuelve la alerta de <...>» o «audita <bodega>» NO encontraron ese "
                "nombre exacto entre lo recién listado - esas acciones YA se resuelven "
                "antes de llegar aquí cuando el nombre coincide, así que usted NUNCA debe "
                "decir que ya aprobó, rechazó, resolvió o abrió algo (sería falso: no "
                "tiene esa capacidad desde aquí). Dígalo con honestidad y sugiera repetirlo "
                "con el nombre completo tal como aparece en la pantalla.")
    if vista == "ayuda":
        faq = "; ".join(f"{p} -> {r}" for p, r in _FAQ_ASISTENTE)
        return f"Pantalla: Ayuda. Preguntas frecuentes conocidas: {faq}."
    if vista == "perfil":
        d = _datos_perfil_narrados(u)
        return (
            f"Pantalla: Mi perfil, de {u.nombre} ({u.perfil}). Datos personales, seguridad "
            "de la cuenta y preferencias de voz. "
            f"Último acceso: {d['ultimo_acceso_hablado'] or 'sin registro'}. PIN vence en "
            f"{d['pin_vence_en_dias']} días. Bodegas asignadas: {d['n_bodegas']}"
            + (f" ({d['texto_bodegas']})" if d["texto_bodegas"] else "") + ". "
            f"Voz actual: {d['voz_nombre']} ({d['voz_etiqueta'].lower()}), velocidad "
            f"{d['velocidad_voz']}, confirmación hablada "
            f"{'activada' if d['confirmacion_hablada'] else 'desactivada'}. "
            "SÍ se puede cambiar por voz: la voz neuronal («cambia mi voz a puck/kore/aoede/"
            "charon»), la velocidad («habla más lento/rápido», «velocidad normal») y la "
            "confirmación hablada («activa/desactiva la confirmación hablada»). Cambiar el "
            "PIN, subir una foto, y editar nombre/correo/teléfono son A PROPÓSITO solo "
            "manuales, por seguridad - nunca diga que ya cambió el PIN por voz, eso sería "
            "falso.")
    if vista == "bodegas":
        with Sesion() as s:
            ids_permitidos = _ids_permitidos_para_buscar(s, u)
            q = s.query(Bodega)
            if ids_permitidos is not None:
                q = q.filter(Bodega.id.in_(ids_permitidos))
            bodegas = q.all()
            n_pendientes = sum(1 for b in bodegas if b.estado == "pendiente")
            n_en_conteo = sum(1 for b in bodegas if b.estado == "en_conteo")
        return (f"Pantalla: Bodegas. Aquí se busca el stock de un artículo en todo "
                f"el catálogo, y se ve el estado/historial de cada bodega (no se "
                f"cuenta desde aquí, eso es en Conteo). De las bodegas de esta "
                f"persona: {n_pendientes} pendientes, {n_en_conteo} en conteo. Si "
                f"piden abrir o seguir contando una bodega por nombre, se resuelve "
                f"aparte antes de este mensaje - esto solo se usa para explicar o "
                f"navegar a otra pantalla.")
    return f"Pantalla: {vista}."


_VERBOS_ABRIR_BODEGA = re.compile(
    r"\b(abr[ae]|abrir|contar|cuenta|siga|sigue|continu[ae]|continuar)\b",
    re.IGNORECASE)

_MODO_SIN_CONEXION = re.compile(r"sin conexi[oó]n", re.IGNORECASE)
_ACTIVAR = re.compile(
    r"\b(act[ií]v\w*|enc[ie][eé]nd\w*|prend\w*)\b", re.IGNORECASE)
_DESACTIVAR = re.compile(
    r"\b(desact[ií]v\w*|ap[aá]g\w*|qu[ií]t\w*)\b", re.IGNORECASE)


def _cambiar_modo_sin_conexion(texto: str, u: Usuario) -> dict | None:
    """Único ajuste que de verdad se puede cambiar por voz en esta
    pantalla (el resto - umbral, reglas fijas - sigue exigiendo los
    controles de la pantalla): solo un administrador, y solo si la
    orden nombra "sin conexión" junto con un verbo de activar/desactivar
    inequívoco. None si no aplica, para caer al agente general."""
    if u.perfil != "auditor" or not _MODO_SIN_CONEXION.search(texto):
        return None
    if _ACTIVAR.search(texto):
        nuevo = True
    elif _DESACTIVAR.search(texto):
        nuevo = False
    else:
        return None
    with Sesion() as s:
        existente = s.get(ConfigClave, "offline")
        valor = "1" if nuevo else "0"
        if existente:
            existente.valor = valor
        else:
            s.add(ConfigClave(clave="offline", valor=valor))
        s.commit()
    estado = "activado" if nuevo else "desactivado"
    registrar(u, "AJUSTE", f"{u.nombre} {estado} el modo sin conexión por voz", "ok")
    return {"respuesta_hablada": f"Listo, el modo sin conexión quedó {estado}.",
            "accion": "actualizar", "destino": None, "pestana": None}


def _normalizar_nombre(t: str) -> str:
    """Sin quitar la puntuación, una pausa natural al hablar ("Cebolla,
    cabezona blanca.") deja una coma que rompe la comparación por
    substring contra "CEBOLLA CABEZONA BLANCA" (sin coma) - confirmado
    con una captura real donde por eso no lograba resolver una
    ambigüedad pendiente aunque dijo el nombre correcto. Mismo arreglo
    que normalizar() ya tiene en servicios/conciliacion.py, por la
    misma razón (el reconocimiento de voz también suele cerrar la
    frase con un punto que nadie dijo)."""
    t = str(t).lower().strip()
    t = re.sub(r"[.,;:!¿?¡]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return "".join(c for c in unicodedata.normalize("NFD", t)
                   if unicodedata.category(c) != "Mn")


_COLA_RELLENO = re.compile(
    r"\s*,?\s*(?:por\s+favor|porfa\w*|gracias|si\s+puedes|si\s+es\s+posible)"
    r"\s*[.,!?¿]*\s*$", re.IGNORECASE)


def _quitar_relleno(texto: str) -> str:
    """Los comandos de una sola frase («crea un usuario llamado...»,
    «crea una receta llamada..., con... de...») quedan anclados al
    FINAL del texto para extraer nombre/cantidad/ingrediente con
    precisión - pero cualquier cortesía dicha al final ("...por favor",
    "...gracias", cosa que la gente realmente dice) caía fuera de ese
    ancla y el campo capturado se tragaba esas palabras de más (un
    usuario terminaba llamándose "juan perfil auxiliar por favor" en
    vez de "juan"). Se quita ANTES de intentar cualquier comando, en un
    bucle por si hay más de una coletilla seguida ("por favor, gracias")."""
    anterior = None
    t = texto
    while anterior != t:
        anterior = t
        t = _COLA_RELLENO.sub("", t)
    return t


def _cambiar_estado_usuario(texto: str, u: Usuario) -> dict | None:
    """"Activa/desactiva a <nombre>" desde Gestión de usuarios - mismo
    patrón determinístico que el modo sin conexión (sin pasar por
    Gemini, así no depende de su cuota ni arriesga un cambio real por
    una mala interpretación del modelo). Reusa las mismas reglas que ya
    protegen el PUT /api/usuarios/{id}: nadie se desactiva a sí mismo
    por voz, y solo un administrador puede tocar a otra persona.
    "Quita" es sinónimo de desactivar aquí, pero "quítale la BODEGA X a
    Luis" no debe desactivar a Luis por accidente solo porque comparte
    el verbo - de ahí la exclusión explícita cuando se menciona una
    bodega, que es harina de otro costal (_asignar_bodega_por_voz)."""
    if (u.perfil != "auditor" or _MODO_SIN_CONEXION.search(texto)
            or re.search(r"\bbodega\b", texto, re.IGNORECASE)):
        return None
    if _ACTIVAR.search(texto):
        nuevo = True
    elif _DESACTIVAR.search(texto):
        nuevo = False
    else:
        return None
    t = _normalizar_nombre(texto)
    with Sesion() as s:
        candidatos = s.query(Usuario).filter(Usuario.id != u.id).all()
        encontrado = next(
            (c for c in candidatos
             if re.search(rf"\b{re.escape(_normalizar_nombre(c.nombre))}\b", t)),
            None)
        if not encontrado:
            return None
        if bool(encontrado.activo) == nuevo:
            estado = "activo" if nuevo else "inactivo"
            return {"respuesta_hablada": f"{encontrado.nombre.capitalize()} ya estaba {estado}.",
                    "accion": "actualizar", "destino": None, "pestana": None}
        encontrado.activo = int(nuevo)
        nombre = encontrado.nombre
        s.commit()
    if not nuevo:
        try:
            _cliente_cognito().admin_user_global_sign_out(
                UserPoolId=COGNITO_USER_POOL_ID, Username=nombre)
        except Exception as e:
            print(f"[cognito] no se pudo cerrar la sesion de {nombre}: {e}")
    estado = "activado" if nuevo else "desactivado"
    registrar(u, "USUARIO", f"{nombre} {estado} por voz", "ok")
    return {"respuesta_hablada": f"Listo, {nombre.capitalize()} quedó {estado}.",
            "accion": "actualizar", "destino": None, "pestana": None}


# Cuando alguien encadena dos órdenes en una sola frase ("...con 2 kg
# de papa, agrega 300 g de cebolla a la receta sopa" - confirmado con
# una captura real), el último grupo capturado (.+? anclado al final
# con $) se tragaba TODO lo que seguía, incluida la segunda orden
# completa, como si fuera parte del dato ("no encontré «papa, agrega
# 300 g de cebolla a la receta sopa» en el catálogo"). Este sufijo se
# detiene apenas aparece una coma seguida de otro verbo reconocido, y
# descarta el resto - la primera orden se cumple bien, y la segunda
# queda pendiente de decirse aparte.
_CORTE_ORDEN_ENCADENADA = (
    r"(?:,\s*(?:cre[ae]|agr[eé]ga|a[ñn]ad|elimin|borr|cambia|as[ií]gn|qu[ií]t|"
    r"muestra|ense[ñn]a|oculta|act[ií]v|desact[ií]v)\w*.*)?")
_CREAR_USUARIO = re.compile(
    r"\b(?:cre[ae]\w*\s+)?(?:un\s+|una\s+)?(?:nuev[oa]\s+)?usuario\s+llamad[oa]\s+(?P<nombre>.+?)"
    r"(?:\s+(?:de\s+|con\s+)?perfil\s+(?P<perfil>auxiliar|auditor|administrador))?"
    r"\s*" + _CORTE_ORDEN_ENCADENADA + r"[.!]?\s*$", re.IGNORECASE)
_INTENCION_CREAR_USUARIO = re.compile(
    r"\b(cre[ae]\w*|necesito|quiero)\b.*\busuarios?\b|\busuario\s+llamad[oa]\b",
    re.IGNORECASE)


def _crear_usuario_por_voz(texto: str, u: Usuario) -> dict | None:
    """"Crea un usuario llamado <nombre> perfil <auxiliar/auditor>" -
    determinístico, sin pasar por Gemini. A diferencia de
    activar/desactivar (que busca un nombre YA existente), aquí no hay
    nada contra qué validar el nombre, así que se exige un formato de
    frase concreto en vez de adivinar de cualquier forma - más fácil de
    aprender a decir que arriesgar un nombre mal extraído. Sin perfil
    dicho, queda auxiliar (el caso más común y el de menor alcance).

    Decir solo "crea un usuario" (sin nombre) coincidía por casualidad
    con la navegación a la pestaña Gestión de usuarios (por la palabra
    "usuario") - si ya estaba en esa pestaña, no pasaba nada visible y
    parecía que el agente no hacía nada. Ahora, si se nota la intención
    de crear pero falta el nombre, se explica el formato exacto en vez
    de caer en la navegación por casualidad."""
    if u.perfil != "auditor":
        return None
    m = _CREAR_USUARIO.search(texto.strip())
    if not m:
        if (_INTENCION_CREAR_USUARIO.search(texto)
                and not _ES_PREGUNTA_PESTANA.search(texto)):
            return {"respuesta_hablada": "Para crear un usuario diga el nombre completo así: "
                                         "«crea un usuario llamado» y el nombre, «perfil» y "
                                         "auxiliar o administrador.",
                    "accion": None, "destino": None, "pestana": None}
        return None
    nombre = re.sub(r"[.,;:!¿?¡]+$", "", m.group("nombre")).strip().lower()
    if not nombre:
        return None
    perfil_dicho = (m.group("perfil") or "").lower()
    perfil = "auditor" if perfil_dicho in ("auditor", "administrador") else "auxiliar"
    with Sesion() as s:
        if s.query(Usuario).filter_by(nombre=nombre).first():
            return {"respuesta_hablada": f"Ya existe un usuario llamado {nombre.capitalize()}.",
                    "accion": None, "destino": None, "pestana": None}
        pin_generado = secrets.token_urlsafe(6) + "1Aa"   # cumple la politica de Cognito
        # Cognito exige un correo real para crear la cuenta (no lo pide la
        # frase por voz) - se usa un correo institucional predecible; el
        # administrador lo puede corregir despues desde Ajustes si no es
        # el correcto. La cuenta en si SI queda usable de una: el PIN
        # dictado aqui es real, no un marcador de posicion.
        correo = f"{nombre.replace(' ', '.')}@colsubsidio.com"
        nuevo = Usuario(nombre=nombre, perfil=perfil, correo=correo)
        s.add(nuevo)
        s.commit()
        s.refresh(nuevo)
        nuevo.codigo = f"CS-{48000 + nuevo.id}"
        s.commit()
    if not _crear_usuario_cognito(nombre, correo, pin_generado):
        # la fila local ya quedo creada (igual que en POST /api/usuarios) -
        # se avisa por voz en vez de anunciar un PIN que en realidad no
        # sirve para entrar.
        registrar(u, "USUARIO", f"Usuario {nombre} creado ({perfil}) por voz, "
                                f"pero fallo en Cognito", "alerta")
        return {"respuesta_hablada": f"Creé a {nombre.capitalize()} en el sistema, pero no "
                                     "pude generar su acceso. Créelo de nuevo desde Gestión "
                                     "de usuarios.",
                "accion": "actualizar", "destino": None, "pestana": None}
    registrar(u, "USUARIO", f"Usuario {nombre} creado ({perfil}) por voz", "ok")
    return {"respuesta_hablada": f"Listo, creé a {nombre.capitalize()} como {perfil}. "
                                 f"Su PIN temporal es {pin_generado} - dígaselo para que "
                                 "lo cambie en Mi perfil.",
            "accion": "actualizar", "destino": None, "pestana": None}


_VERBOS_GENERAR_REPORTE = re.compile(
    r"\b(gener[ae]|generar|exporta|exportar|crea|crear|descarga|descargar|saca|sacar)\b",
    re.IGNORECASE)
_REP_DIFERENCIAS = re.compile(r"diferencia", re.IGNORECASE)
_REP_ANALISIS = re.compile(r"an[aá]lisis|consumo", re.IGNORECASE)
_REP_CONSOLIDADO = re.compile(r"consolidado", re.IGNORECASE)
_REP_TABLERO = re.compile(r"tablero", re.IGNORECASE)
_REP_DETALLE_BODEGA = re.compile(r"detalle\s+d?el?\s+(la\s+)?bodega|detalle\s+de\s+almac[eé]n", re.IGNORECASE)
_REP_TRAZA_ARCHIVO = re.compile(r"trazabilidad", re.IGNORECASE)


def _generar_reporte_por_voz(texto: str, u: Usuario) -> dict | None:
    """"Genera el consolidado" / "exporta las diferencias" / "exporta el
    análisis de consumo" desde Reportes - mismo patrón determinístico
    que Ajustes (sin pasar por Gemini): llama la MISMA función que ya
    usa el botón correspondiente, así el resultado es idéntico al de
    darle clic, solo que solo un administrador puede pedirlo por voz."""
    if u.perfil != "auditor" or not _VERBOS_GENERAR_REPORTE.search(texto):
        return None
    if _REP_DIFERENCIAS.search(texto):
        d = reporte_diferencias(formato="xlsx", u=u)
        # archivo/titulo_archivo (ademas de "actualizar") - para que el
        # panel de vista previa muestre este archivo de una, igual que ya
        # pasa al darle clic al boton "Generar diferencias" (que llama a
        # previsualizar() apenas termina). Sin esto, pedirlo por voz lo
        # generaba pero la vista previa se quedaba vacia hasta un clic
        # manual en la tarjeta.
        return {"respuesta_hablada": f"Listo, generé las diferencias: {d['filas']} filas en "
                                     f"{d['bodegas_con_descuadre']} bodegas con descuadre.",
                "accion": "actualizar", "destino": None, "pestana": "consolidado",
                "archivo": d["archivo"], "titulo_archivo": "Diferencias por bodega"}
    if _REP_ANALISIS.search(texto):
        # a diferencia del consolidado/diferencias (que solo generan y
        # dejan una vista previa - descargar es un clic aparte, igual por
        # voz que a mano), el botón "Exportar análisis" SÍ descarga de
        # una vez: sin "descargar_reporte" aquí, pedirlo por voz creaba
        # el archivo en el servidor pero nunca llegaba al dispositivo -
        # la persona no notaba nada distinto de antes de pedirlo.
        d = exportar_analisis(formato="xlsx", dias=30, u=u)
        return {"respuesta_hablada": "Listo, exporté el análisis de consumo de los últimos 30 días.",
                "accion": "descargar_reporte", "destino": None, "pestana": "analisis",
                "archivo": d["archivo"]}
    if _REP_CONSOLIDADO.search(texto):
        d = reporte(formato="xlsx", u=u)
        return {"respuesta_hablada": f"Listo, generé el consolidado: {d['filas']} filas.",
                "accion": "actualizar", "destino": None, "pestana": "consolidado",
                "archivo": d["archivo"], "titulo_archivo": "Consolidado para My Inventory"}
    return None


def _datos_reportes_narrados(u: Usuario) -> dict:
    """Los archivos recientes (misma fuente que la lista de Reportes) y el
    análisis de consumo de los últimos 30 días, ya en frases listas para
    hablar - los usan tanto el contexto completo que recibe Gemini como
    las respuestas determinísticas de _responder_reportes_por_voz."""
    recientes = reportes_recientes(u=u)
    analisis = api_analisis(dias=30, u=u)

    def _fila(a):
        extra = f", {a['filas']} filas" if a["filas"] is not None else ""
        return f"{a['titulo']} ({a['formato']}, hoy {a['hora']}{extra})"

    texto_recientes = ("todavía no se ha generado ningún archivo" if not recientes else
                       "; ".join(_fila(x) for x in recientes[:5]))
    ultimo_consolidado = next((x for x in recientes if x["titulo"] == "Consolidado para My Inventory"), None)
    ultimas_diferencias = next((x for x in recientes if x["titulo"] == "Diferencias por bodega"), None)
    subutil = analisis["subutilizados"]
    texto_subutil = ("sin insumos subutilizados en el período" if not subutil else
                     "; ".join(f"{s['nombre'].title()}: sobran {s['sobra']} kg "
                              f"({s['sobrepedido_pct']}% de sobrepedido, en {s['veces']} servicios)"
                              for s in subutil[:5]))
    return {"recientes": recientes, "analisis": analisis, "texto_recientes": texto_recientes,
            "ultimo_consolidado": ultimo_consolidado, "ultimas_diferencias": ultimas_diferencias,
            "texto_subutil": texto_subutil}


_REPORTES_PREGUNTAS = [
    (re.compile(r"\bcu[aá]nt\w*\s+filas\b.*\b[uú]ltimo\s+consolidado\b|"
               r"\bfilas\s+tiene\s+el\s+consolidado\b", re.IGNORECASE),
     lambda d: (f"El último consolidado tiene {d['ultimo_consolidado']['filas']} filas, "
               f"generado hoy {d['ultimo_consolidado']['hora']}."
               if d["ultimo_consolidado"] else "Todavía no se ha generado ningún consolidado.")),
    (re.compile(r"\bcu[aá]nt\w*\s+(filas|bodegas)\b.*\bdiferencias\b|"
               r"\bbodegas\s+tienen\s+descuadre\b", re.IGNORECASE),
     lambda d: (f"Las últimas diferencias exportadas tienen {d['ultimas_diferencias']['filas']} "
               f"filas, generadas hoy {d['ultimas_diferencias']['hora']}."
               if d["ultimas_diferencias"] else "Todavía no se han exportado diferencias por bodega.")),
    (re.compile(r"\bqu[eé]\s+archivos\b.*\bgenerad\w*|\barchivos\s+(recientes|generados)\b",
               re.IGNORECASE),
     lambda d: f"Archivos recientes: {d['texto_recientes']}."),
    (re.compile(r"\bcu[aá]nto\b.*\bpidi[oó]\b|\bpedido\s+total\b|\bpedido\s+en\s+el\s+per[ií]odo\b",
               re.IGNORECASE),
     lambda d: f"En el período se pidieron {d['analisis']['pedido_total']} kilogramos, en "
               f"{d['analisis']['servicios_periodo']} servicios."),
    (re.compile(r"\bcu[aá]nto\b.*\bus[oó]\b|\baprovechamiento\b|\busado\s+realmente\b",
               re.IGNORECASE),
     lambda d: f"Se usaron realmente {d['analisis']['usado_total']} kilogramos, el "
               f"{d['analisis']['aprovechamiento']}% de lo pedido."),
    (re.compile(r"\bahorro\s+potencial\b", re.IGNORECASE),
     lambda d: f"El ahorro potencial es de {d['analisis']['ahorro_potencial']} kilogramos al "
               "mes si se ajustan las recetas."),
    (re.compile(r"\bcu[aá]nt\w*\s+insumos\s+(est[aá]n\s+)?subutilizad\w*|\binsumos\s+subutilizados\b",
               re.IGNORECASE),
     lambda d: f"Hay {len(d['analisis']['subutilizados'])} insumos subutilizados: "
               f"{d['texto_subutil']}."),
    (re.compile(r"\b(m[aá]s|mayor)\s+sobrepedido\b|\brecomendaci[oó]n\s+(del\s+)?agente\b",
               re.IGNORECASE),
     lambda d: (f"El insumo con más sobrepedido es "
               f"{d['analisis']['subutilizados'][0]['nombre'].title()}: sobra en "
               f"{d['analisis']['subutilizados'][0]['veces']} servicios, "
               f"{d['analisis']['subutilizados'][0]['sobrepedido_pct']}% más de lo que se usa."
               if d["analisis"]["subutilizados"] else
               "No hay insumos subutilizados en el período.")),
]


def _responder_reportes_por_voz(texto: str, u: Usuario) -> dict | None:
    """Preguntas frecuentes de Reportes (ambas pestañas), resueltas sin
    pasar por Gemini - mismo motivo que _responder_panel_por_voz: estas
    frases ya se ofrecen como garantizadas en el desplegable de ejemplos."""
    if u.perfil != "auditor":
        return None
    for patron, respuesta in _REPORTES_PREGUNTAS:
        if patron.search(texto):
            return {"respuesta_hablada": respuesta(_datos_reportes_narrados(u)),
                    "accion": None, "destino": None, "pestana": None}
    return None


_VER_ARCHIVO_VERBO = re.compile(
    r"\b(mu[eé]stra\w*|ense[ñn]a\w*|[aá]bre\w*)\b", re.IGNORECASE)
_VER_ARCHIVO_PALABRA = re.compile(r"\barchivo\b", re.IGNORECASE)


def _previsualizar_reporte_por_voz(texto: str, u: Usuario) -> dict | None:
    """"Muéstrame el detalle de bodega" / "ábreme el archivo de diferencias" -
    lo mismo que darle clic a una tarjeta de "Archivos generados", sin
    tocar la pantalla.

    Diferencias, tablero, detalle de bodega y trazabilidad NO son el
    nombre de ninguna pestaña de esta pantalla, así que decir su nombre
    con un verbo de "mostrar" no compite con nada más - se abren directo,
    sin exigir la palabra "archivo". Consolidado y análisis SÍ son
    pestañas reales («muéstrame el consolidado» ya significa cambiar de
    pestaña, ver _navegar_pestana_por_voz), así que para esos dos la
    palabra "archivo" sigue siendo obligatoria para desambiguar - sin
    ella, decir solo el nombre de la pestaña dejaría de poder cambiarla.
    Antes la palabra "archivo" era obligatoria para los seis tipos por
    igual, así que pedir "muéstrame el detalle de bodega" (la frase más
    natural, sin decir "archivo") no abría nada y caía al agente
    general, que solo podía describir el archivo en palabras y mandar a
    dar clic a mano - no a abrirlo de verdad.

    Cubre los cinco tipos que puede mostrar la lista (antes solo distinguía
    diferencias y consolidado; el resto - tablero, detalle de bodega,
    análisis, trazabilidad - siempre caía al último archivo generado, que
    con frecuencia NO era el que se pedía)."""
    if u.perfil != "auditor" or not _VER_ARCHIVO_VERBO.search(texto):
        return None
    recientes = reportes_recientes(u=u)
    if not recientes:
        return {"respuesta_hablada": "Todavía no se ha generado ningún archivo.",
                "accion": None, "destino": None, "pestana": "consolidado"}
    tiene_archivo = bool(_VER_ARCHIVO_PALABRA.search(texto))
    if _REP_DIFERENCIAS.search(texto):
        elegido = next((x for x in recientes if x["titulo"] == "Diferencias por bodega"), None)
    elif _REP_TABLERO.search(texto):
        elegido = next((x for x in recientes if x["titulo"] == "Estado del tablero"), None)
    elif _REP_DETALLE_BODEGA.search(texto):
        elegido = next((x for x in recientes if x["titulo"] == "Detalle de bodega"), None)
    elif _REP_TRAZA_ARCHIVO.search(texto):
        elegido = next((x for x in recientes if x["titulo"] == "Registro de trazabilidad"), None)
    elif _REP_ANALISIS.search(texto) and tiene_archivo:
        elegido = next((x for x in recientes if x["titulo"] == "Análisis de consumo"), None)
    elif _REP_CONSOLIDADO.search(texto) and tiene_archivo:
        elegido = next((x for x in recientes if x["titulo"] == "Consolidado para My Inventory"), None)
    elif tiene_archivo:
        elegido = recientes[0]
    else:
        return None
    if not elegido:
        return {"respuesta_hablada": "No encontré ese archivo entre los generados recientemente.",
                "accion": None, "destino": None, "pestana": "consolidado"}
    detalle_filas = f", {elegido['filas']} filas" if elegido["filas"] is not None else ""
    return {"respuesta_hablada": f"Aquí está: {elegido['titulo']}{detalle_filas}. "
                                 "¿Desea descargarlo?",
            "accion": "previsualizar_reporte", "destino": None, "pestana": "consolidado",
            "archivo": elegido["archivo"], "titulo_archivo": elegido["titulo"]}


# Palabras que identifican cada pestaña, para navegar entre ellas sin
# pasar por Gemini - la cuota de Gemini ha fallado justo en este tipo de
# orden ("llévame a gestión de usuarios"), dejando la pestaña sin
# cambiar aunque la respuesta hablada dijera lo contrario.
_PALABRAS_PESTANA = {
    "ajustes": {
        "config": re.compile(r"configuraci[oó]n", re.IGNORECASE),
        "usuarios": re.compile(r"usuarios?", re.IGNORECASE),
        "recetas": re.compile(r"recetas?", re.IGNORECASE),
        "traza": re.compile(r"trazabilidad", re.IGNORECASE),
    },
    "reportes": {
        "consolidado": re.compile(r"consolidado", re.IGNORECASE),
        "analisis": re.compile(r"an[aá]lisis|consumo", re.IGNORECASE),
    },
    "panel": {
        "resumen": re.compile(r"resumen", re.IGNORECASE),
        "alertas": re.compile(r"\balertas\b", re.IGNORECASE),
    },
    "auditoria": {
        "recuento": re.compile(r"recuento|recont[ae]o|\bcierre\b", re.IGNORECASE),
        "aprobaciones": re.compile(r"aprobaciones", re.IGNORECASE),
        "pedidos": re.compile(r"pedidos", re.IGNORECASE),
        "alertas": re.compile(r"\balertas\b", re.IGNORECASE),
    },
}
_VERBOS_IR_PESTANA = re.compile(
    r"\b(ir|ll[eé]va(me)?|vamos|ve|mu[eé]stra(me)?|[aá]bre(me)?|ens[eé][ñn]a(me)?)\b",
    re.IGNORECASE)
_ES_PREGUNTA_PESTANA = re.compile(r"[¿?]|\bcu[aá]nt|\bqu[eé]\b|\bcu[aá]l|\bpor qu[eé]", re.IGNORECASE)


def _navegar_pestana_por_voz(vista: str, texto: str) -> dict | None:
    """"Llévame a gestión de usuarios" (o cualquier pestaña de Ajustes,
    Reportes o Panel) - determinístico, sin pasar por Gemini, para que
    la navegación entre pestañas no dependa de su cuota. También navega
    si lo dicho es prácticamente el nombre de la pestaña solo ("Gestión
    de usuarios.", sin decir "llévame a" - la persona lo dice tal como
    lo lee en la pantalla), siempre que sea corto y no suene a pregunta
    ("¿cuántos usuarios hay?" no debe navegar, solo responderse)."""
    palabras = _PALABRAS_PESTANA.get(vista)
    if not palabras:
        return None
    tiene_verbo = bool(_VERBOS_IR_PESTANA.search(texto))
    limpio = re.sub(r"[.,;:!¿?¡]+$", "", texto.strip())
    es_solo_el_nombre = (not _ES_PREGUNTA_PESTANA.search(texto)
                         and 0 < len(limpio.split()) <= 4)
    if not tiene_verbo and not es_solo_el_nombre:
        return None
    for clave, patron in palabras.items():
        if patron.search(texto):
            etiqueta = _PESTANAS_ASISTENTE[vista][clave]
            return {"respuesta_hablada": f"Listo, vamos a {etiqueta}.",
                    "accion": "navegar", "destino": vista, "pestana": clave}
    return None


# Los 4 "accesos rápidos" de Inicio ("Iniciar un conteo", "Ver el tablero",
# "Continuar auditoría"/"Hacer un pedido", "Generar reporte"/"Legalizar
# servicio") - las mismas tarjetas que ya se navegan con un clic.
_ACCESOS_INICIO = {
    "conteo": re.compile(r"\bconteo\b", re.IGNORECASE),
    "bodegas": re.compile(r"\btablero\b|\bbodegas\b", re.IGNORECASE),
    "auditoria": re.compile(r"auditor[ií]a", re.IGNORECASE),
    "pedido": re.compile(r"\bpedidos?\b", re.IGNORECASE),
    "reportes": re.compile(r"reporte", re.IGNORECASE),
    "legalizacion": re.compile(r"legaliza", re.IGNORECASE),
}
_VERBOS_ACCESO_INICIO = re.compile(
    r"\b(inicia|iniciar|continu[ae]|continuar|genera|generar|legaliza|legalizar|hacer|haga)\b",
    re.IGNORECASE)


def _acceso_rapido_inicio_por_voz(texto: str, u: Usuario) -> dict | None:
    """Decir el nombre de una tarjeta de "¿Qué desea hacer?" navega directo
    a ella - determinístico, sin pasar por Gemini: se confirmó con
    pruebas que a veces decidía contestar en vez de navegar aunque la
    frase mencionara el destino tal cual ("iniciar un conteo" se quedaba
    en Inicio). Mismo filtro que _navegar_pestana_por_voz para no
    robarle la frase a las preguntas de KPI de esta pantalla («¿cuántas
    bodegas tengo?» debe contestarse, no navegar a Bodegas)."""
    tiene_verbo = bool(_VERBOS_IR_PESTANA.search(texto)) or bool(_VERBOS_ACCESO_INICIO.search(texto))
    limpio = re.sub(r"[.,;:!¿?¡]+$", "", texto.strip())
    es_solo_el_nombre = (not _ES_PREGUNTA_PESTANA.search(texto)
                         and 0 < len(limpio.split()) <= 4)
    if not tiene_verbo and not es_solo_el_nombre:
        return None
    for destino, patron in _ACCESOS_INICIO.items():
        if not patron.search(texto):
            continue
        if destino in _SOLO_AUDITOR_ASISTENTE and u.perfil != "auditor":
            continue
        etiqueta = _DESTINOS_ASISTENTE[destino]
        return {"respuesta_hablada": f"Vamos a {etiqueta.lower()}.",
                "accion": "navegar", "destino": destino, "pestana": None}
    return None


_APROBAR_ITEM = re.compile(r"\bapru[eé]b\w*|\baprobar\b", re.IGNORECASE)
_RECHAZAR_ITEM = re.compile(r"\brech[aá]z\w*", re.IGNORECASE)


def _resolver_aprobacion_por_voz(texto: str, u: Usuario) -> dict | None:
    """"Aprueba/rechaza <nombre>" desde Auditoría (pestaña Aprobaciones) -
    mismo patrón determinístico que Ajustes/Reportes: busca el nombre
    completo entre las aprobaciones pendientes (como frase exacta, no
    palabra por palabra - "aprueba costilla de res" no debe aprobar
    cualquier cosa que contenga "res") y llama la MISMA función que ya
    usa el botón, solo administrador."""
    if u.perfil != "auditor":
        return None
    if _APROBAR_ITEM.search(texto):
        verbo = "aprobar"
    elif _RECHAZAR_ITEM.search(texto):
        verbo = "rechazar"
    else:
        return None
    t = _normalizar_nombre(texto)
    with Sesion() as s:
        pendientes = s.query(Aprobacion).filter_by(estado="pendiente").all()
        encontrada = next(
            (a for a in pendientes
             if re.search(rf"\b{re.escape(_normalizar_nombre(a.nombre))}\b", t)),
            None)
        if not encontrada:
            return None
        aid, nombre = encontrada.id, encontrada.nombre
    if verbo == "aprobar":
        aprobar(aprobacion_id=aid, u=u)
        return {"respuesta_hablada": f"Listo, aprobé {nombre.title()}. Ya entra al catálogo oficial.",
                "accion": "actualizar", "destino": None, "pestana": None}
    rechazar(aprobacion_id=aid, u=u)
    return {"respuesta_hablada": f"Listo, rechacé {nombre.title()}.",
            "accion": "actualizar", "destino": None, "pestana": None}


_APROBAR_RECHAZAR_PEDIDO = re.compile(
    r"\b(apru[eé]b\w*|rech[aá]z\w*)\b.*\bpedido\b|\bpedido\b.*\b(apru[eé]b\w*|rech[aá]z\w*)\b",
    re.IGNORECASE)


def _resolver_pedido_pendiente_por_voz(texto: str, u: Usuario) -> dict | None:
    """"Aprueba/rechaza el pedido de <persona o plato>" desde Auditoría
    (pestaña Pedidos pendientes) - mismo patrón que _resolver_aprobacion_por_voz,
    pero exige la palabra "pedido" para no competir con aprobar/rechazar
    un producto o bodega nueva, que es otra lista con los mismos verbos."""
    if u.perfil != "auditor" or not _APROBAR_RECHAZAR_PEDIDO.search(texto):
        return None
    if _APROBAR_ITEM.search(texto):
        aprobar_bool = True
    elif _RECHAZAR_ITEM.search(texto):
        aprobar_bool = False
    else:
        return None
    t = _normalizar_nombre(texto)
    pendientes = pedidos_pendientes(u=u)
    if not pendientes:
        return {"respuesta_hablada": "No hay pedidos pendientes de aprobación.",
                "accion": None, "destino": None, "pestana": "pedidos"}
    encontrado = next(
        (p for p in pendientes
         if (p["persona"] and p["persona"] != "—"
             and re.search(rf"\b{re.escape(_normalizar_nombre(p['persona']))}\b", t))
         or re.search(rf"\b{re.escape(_normalizar_nombre(p['plato']))}\b", t)),
        None)
    if not encontrado:
        return None
    resolver_pedido(numero_pedido=encontrado["numero_pedido"],
                    datos=ResolverPedidoIn(aprobar=aprobar_bool), u=u)
    verbo_pasado = "aprobé" if aprobar_bool else "rechacé"
    return {"respuesta_hablada": f"Listo, {verbo_pasado} el pedido de "
                                 f"{encontrado['persona'].title()}: {encontrado['plato']}.",
            "accion": "actualizar", "destino": None, "pestana": "pedidos"}


_RESOLVER_ALERTA = re.compile(r"\bresuelve\w*|\bresolver\b", re.IGNORECASE)


def _resolver_alerta_por_voz(texto: str, u: Usuario) -> dict | None:
    """"Resuelve la alerta de <artículo o bodega>" desde Auditoría
    (pestaña Bandeja de alertas) - mismo patrón determinístico, busca
    entre las alertas abiertas por el artículo o la bodega que mencionan."""
    if u.perfil != "auditor" or not _RESOLVER_ALERTA.search(texto):
        return None
    abiertas = ver_alertas(resueltas=0, u=u)
    if not abiertas:
        return {"respuesta_hablada": "No hay alertas abiertas.",
                "accion": None, "destino": None, "pestana": "alertas"}
    t = _normalizar_nombre(texto)
    encontrada = next(
        (a for a in abiertas
         if (a["articulo"] and re.search(rf"\b{re.escape(_normalizar_nombre(a['articulo']))}\b", t))
         or (a["bodega"] and re.search(rf"\b{re.escape(_normalizar_nombre(a['bodega']))}\b", t))),
        None)
    if not encontrada:
        return None
    resolver_alerta(alerta_id=encontrada["id"], u=u)
    detalle = encontrada["articulo"] or encontrada["bodega"] or encontrada["titulo"]
    return {"respuesta_hablada": f"Listo, resolví la alerta de {detalle.title()}.",
            "accion": "actualizar", "destino": None, "pestana": "alertas"}


_VERBOS_AUDITAR_BODEGA = re.compile(r"\b(abr[ae]|abrir|audit\w*)\b", re.IGNORECASE)


def _abrir_bodega_para_auditoria_por_voz(texto: str, u: Usuario) -> dict | None:
    """"Audita <bodega>" / "abre <bodega>" desde Auditoría (pestaña
    Recuento ciego y cierre) - selecciona esa bodega, lo mismo que darle
    clic a "Abrir" en su tarjeta. A propósito NO llega hasta firmar ni
    cerrar: eso sigue siendo manual, es la garantía de un cierre con
    doble firma que nadie dispara sin querer con la voz."""
    if u.perfil != "auditor" or not _VERBOS_AUDITAR_BODEGA.search(texto):
        return None
    from servicios.conciliacion import buscar_bodega
    with Sesion() as s:
        candidatas_ids = {b.id for b in s.query(Bodega)
                          .filter(Bodega.estado.in_(["en_auditoria", "cerrada"])).all()}
        if not candidatas_ids:
            return {"respuesta_hablada": "No hay ninguna bodega lista para recuento ciego o "
                                         "cierre en este momento.",
                    "accion": None, "destino": None, "pestana": "recuento"}
        bodega = buscar_bodega(s, texto, candidatas_ids)
    if not bodega:
        return None
    return {"respuesta_hablada": f"Vamos a auditar {bodega.nombre_oficial.title()}.",
            "accion": "navegar", "destino": "auditoria", "pestana": "recuento",
            "bodega_auditar": bodega.nombre_oficial}


def _datos_auditoria_narrados(u: Usuario) -> dict:
    return {"resumen_alertas": resumen_alertas(u=u), "pedidos": pedidos_pendientes(u=u),
            "aprobaciones": listar_aprobaciones(estado="pendiente", u=u)}


_AUDITORIA_PREGUNTAS = [
    (re.compile(r"\bcu[aá]nt\w*\s+alertas\b.*\babiertas\b|\balertas\s+abiertas\b", re.IGNORECASE),
     lambda d: f"Hay {d['resumen_alertas']['abiertas']} alertas abiertas."),
    (re.compile(r"\bcu[aá]nt\w*\b.*\bresolvieron\s+hoy\b|\bresueltas\s+hoy\b", re.IGNORECASE),
     lambda d: f"Se resolvieron {d['resumen_alertas']['resueltas_hoy']} alertas hoy."),
    (re.compile(r"\btiempo\s+medio\b", re.IGNORECASE),
     lambda d: (f"El tiempo medio de resolución es de "
               f"{d['resumen_alertas']['tiempo_medio_min']} minutos."
               if d["resumen_alertas"]["tiempo_medio_min"] is not None else
               "Todavía no se ha resuelto ninguna alerta hoy para calcular el tiempo medio.")),
    (re.compile(r"\bcu[aá]nt\w*\s+pedidos\b.*\bpendientes\b", re.IGNORECASE),
     lambda d: (f"Hay {len(d['pedidos'])} pedidos pendientes de aprobación."
               if d["pedidos"] else "No hay pedidos pendientes de aprobación.")),
    (re.compile(r"\bcu[aá]nt\w*\s+aprobaciones\b", re.IGNORECASE),
     lambda d: (f"Hay {len(d['aprobaciones'])} aprobaciones pendientes: " +
               "; ".join(a["nombre"].title() for a in d["aprobaciones"][:6]) + "."
               if d["aprobaciones"] else "No hay aprobaciones pendientes.")),
]


def _responder_auditoria_por_voz(texto: str, u: Usuario) -> dict | None:
    if u.perfil != "auditor":
        return None
    for patron, respuesta in _AUDITORIA_PREGUNTAS:
        if patron.search(texto):
            return {"respuesta_hablada": respuesta(_datos_auditoria_narrados(u)),
                    "accion": None, "destino": None, "pestana": None}
    return None


_UNIDADES_RECETA = r"kilos?|kg|litros?|lt|unidades?|und?|gramos?|gr"
# Cuando alguien encadena dos órdenes en una sola frase ("...con 2 kg
# de papa, agrega 300 g de cebolla a la receta sopa" - confirmado con
# una captura real), el último grupo capturado (.+? anclado al final
# con $) se tragaba TODO lo que seguía, incluida la segunda orden
# completa, como si fuera parte del dato ("no encontré «papa, agrega
# 300 g de cebolla a la receta sopa» en el catálogo"). Este sufijo se
# detiene apenas aparece una coma seguida de otro verbo reconocido, y
# descarta el resto - la primera orden se cumple bien, y la segunda
# queda pendiente de decirse aparte (tal como ya se explica: "puede
# agregarle más ingredientes diciendo «agrega...»").
# El verbo "crea/crear" es OPCIONAL: el reconocimiento de voz a veces
# recorta la primera palabra si la persona empieza a hablar apenas
# hace clic en el micrófono, antes de que el navegador esté listo -
# confirmado con una captura real ("Una receta llamada sopa,
# rendimiento, cuatro porciones." sin "crea" al inicio). El resto de
# la frase (receta llamada... rendimiento... con... de...) ya es lo
# bastante específico para no confundirse con una pregunta suelta.
_CREAR_RECETA = re.compile(
    r"\b(?:cre[ae]\w*\s+)?(?:una\s+)?(?:nuev[oa]\s+)?receta\s+llamad[ao]\s+(?P<nombre>.+?)"
    r"\s*[,y]*\s*(?:con\s+)?rendimiento\s+(?:de\s+)?(?P<rend>.+?)\s*porciones?"
    r"\s*[,y]*\s*con\s+(?P<cant>.+?)\s*"
    rf"(?:{_UNIDADES_RECETA})?\s*de\s+(?P<ing>.+?)\s*" + _CORTE_ORDEN_ENCADENADA + r"[.!]?\s*$",
    re.IGNORECASE)
_AGREGAR_INGREDIENTE = re.compile(
    r"\b(?:agr[eé]ga\w*|a[ñn]ad\w*)\s+(?P<cant>.+?)\s*"
    rf"(?:{_UNIDADES_RECETA})?\s*de\s+(?P<ing>.+?)"
    r"\s+a\s+la\s+receta\s+(?P<receta>.+?)\s*" + _CORTE_ORDEN_ENCADENADA + r"[.!]?\s*$",
    re.IGNORECASE)
_ELIMINAR_RECETA = re.compile(
    r"\b(elimin\w*|borr\w*)\s+(?:la\s+)?receta\s+(?P<receta>.+?)\s*"
    + _CORTE_ORDEN_ENCADENADA + r"[.!]?\s*$",
    re.IGNORECASE)


# Memoria viva de una sola pregunta pendiente por persona: "crea una
# receta... con papa" -> ambiguo -> la persona contesta solo "papa
# criolla" en el siguiente turno, y eso completa la orden original en
# vez de tener que repetirla entera. Mismo patron que ESTADOS en
# agente/orquestador.py (memoria en RAM, se pierde si el servidor se
# reinicia - aceptable aqui: en el peor caso, toca repetir la orden
# completa, que es lo que ya se pedia antes de esto). Expira sola
# despues de _VENCIMIENTO_AMBIGUEDAD segundos para no quedar pegada a
# una respuesta que en realidad era para otra cosa, dicha mucho despues.
_PENDIENTE_AMBIGUEDAD: dict[int, dict] = {}
_VENCIMIENTO_AMBIGUEDAD = 90


def _elegir_ingrediente_sin_ambiguedad(dicho: str) -> dict | None:
    """buscar_articulo() puntúa por cobertura de palabras: una consulta
    de una sola palabra genérica ("papa") saca 100% de cobertura contra
    CUALQUIER artículo que la contenga, sin importar cuánto más tenga
    ese nombre alrededor - confirmado con una captura real donde "papa"
    empataba a 100 de confianza con "EMPANADA DE PAPA Y CARNE X50 GR",
    "PAPA A LA FRANCESA" y "PAPA CABELLO DE ANGEL" por igual, y se
    quedaba con el primero de la lista sin ningún criterio real. Igual
    que buscar_bodega ya hace con bodegas ambiguas: mejor decir "sea
    más específico" que adivinar mal en silencio y crear una receta con
    el ingrediente equivocado."""
    from servicios.conciliacion import buscar_articulo, normalizar
    # limite alto: buscar_articulo por defecto solo devuelve los 3
    # mejores, y con un empate a 100 (el caso ambiguo que nos interesa
    # aquí) esos 3 son un subconjunto ARBITRARIO del catálogo real -
    # confirmado con una captura real donde salían "Empanada De Papa Y
    # Carne" y "Papa A La Francesa" en vez de las papas de verdad
    # (Criolla, Sabanera, Pastusa) que sí existen en el catálogo. Con
    # más candidatos a la vista, se puede priorizar los nombres más
    # simples (probablemente el ingrediente crudo) al armar la lista.
    candidatos = buscar_articulo(dicho, limite=20)
    if not candidatos or candidatos[0]["confianza"] < 60:
        return {"error": f"No encontré «{dicho}» en el catálogo. Dígalo como aparece "
                         "en la etiqueta."}
    tope = candidatos[0]["confianza"]
    empatados = [c for c in candidatos if c["confianza"] == tope]
    if len(empatados) > 1:
        # Un empate NO es ambiguo si uno de ellos es el nombre EXACTO
        # dicho ("papa criolla" == "PAPA CRIOLLA") - eso gana solo,
        # aunque "PAPA CRIOLLA PRECOCIDA" haya empatado en puntaje.
        clave = normalizar(dicho)
        exacto = next((c for c in empatados if normalizar(c["nombre"]) == clave), None)
        if exacto:
            return {"articulo": exacto}
        # De los empatados, primero los nombres más cortos: un
        # ingrediente crudo ("PAPA CRIOLLA") es más probable que sea lo
        # que la persona quiso decir que un producto elaborado con
        # media frase de más ("EMPANADA DE PAPA Y CARNE X50 GR").
        empatados.sort(key=lambda c: len(c["nombre"].split()))
        mostrados = empatados[:5]
        opciones = ", ".join(c["nombre"].title() for c in mostrados)
        return {"error": f"«{dicho}» es ambiguo, encontré varios parecidos: {opciones}. "
                         "Dígalo más específico, como aparece completo en la etiqueta.",
                "opciones": mostrados}
    return {"articulo": candidatos[0]}


def _buscar_receta_por_nombre(s, nombre_dicho: str):
    """Una coincidencia EXACTA siempre gana primero: con dos recetas
    "Sopa" y "Sopa de la casa", decir "Sopa de la casa" no debe caer en
    "Sopa" solo porque su nombre es substring - eso pasaba antes (se
    quedaba con la PRIMERA que calzara, sin importar el orden de
    especificidad) y edita/borraba la receta equivocada en silencio."""
    t = _normalizar_nombre(nombre_dicho)
    recetas = s.query(Receta).all()
    exacta = next((r for r in recetas if _normalizar_nombre(r.nombre) == t), None)
    if exacta:
        return exacta
    return next(
        (r for r in recetas if re.search(rf"\b{re.escape(_normalizar_nombre(r.nombre))}\b", t)
         or re.search(rf"\b{re.escape(t)}\b", _normalizar_nombre(r.nombre))),
        None)


_INTENCION_CREAR_RECETA = re.compile(
    r"\b(cre[ae]\w*|necesito|quiero)\b.*\brecetas?\b|\breceta\s+llamad[ao]\b",
    re.IGNORECASE)


def _completar_crear_receta(nombre: str, rend: float, cant: float, articulo: dict,
                            u: Usuario) -> dict:
    with Sesion() as s:
        if s.query(Receta).filter(Receta.nombre.ilike(nombre)).first():
            return {"respuesta_hablada": f"Ya existe una receta llamada {nombre}.",
                    "accion": None, "destino": None, "pestana": None}
        r = Receta(nombre=nombre, rendimiento=int(rend), preparacion="")
        s.add(r)
        s.flush()
        s.add(RecetaIngrediente(receta_id=r.id, articulo_codigo=articulo["codigo"],
                                cantidad_por_porcion=float(cant)))
        s.commit()
    registrar(u, "RECETA", f"Receta creada: {nombre} (1 ingrediente) por voz", "ok")
    return {"respuesta_hablada": f"Listo, creé la receta {nombre} con {articulo['nombre'].title()}. "
                                 "Puede agregarle más ingredientes diciendo «agrega... a la "
                                 f"receta {nombre}», o editarla desde la pantalla.",
            "accion": "actualizar", "destino": None, "pestana": None}


def _crear_receta_por_voz(texto: str, u: Usuario) -> dict | None:
    """"Crea una receta llamada <nombre>, rendimiento <N> porciones, con
    <cantidad> de <ingrediente>" - determinístico, con el mismo criterio
    que crear usuario: un formato de frase concreto, en vez de adivinar
    de cualquier forma un nombre y una lista de ingredientes que no
    existen todavía contra qué validar. El ingrediente SÍ se busca
    contra el catálogo real (misma función que usa Conteo/Pedido) - si
    no lo encuentra con confianza suficiente, no crea nada a medias.
    Decir solo "crea una receta" (sin los demás datos) coincidía por
    casualidad con la navegación a la pestaña Recetas - mismo arreglo
    que crear usuario."""
    if u.perfil != "auditor":
        return None
    m = _CREAR_RECETA.search(texto.strip())
    if not m:
        if (_INTENCION_CREAR_RECETA.search(texto)
                and not _ES_PREGUNTA_PESTANA.search(texto)):
            return {"respuesta_hablada": "Para crear una receta diga: «crea una receta "
                                         "llamada» el nombre, «rendimiento» el número de "
                                         "porciones, «con» la cantidad «de» el primer "
                                         "ingrediente.",
                    "accion": None, "destino": None, "pestana": None}
        return None
    nombre = re.sub(r"[.,;:!¿?¡]+$", "", m.group("nombre")).strip()
    if not nombre:
        return None
    # El rendimiento y la cantidad se dicen casi siempre en palabras
    # ("cuatro porciones", no "4 porciones" - así habla la gente de
    # verdad), así que se interpretan con el mismo parser de números
    # que ya usa Conteo/Pedido, no un \d+ que solo entiende dígitos.
    rend = _numero_de_texto(m.group("rend"))
    cant = _numero_de_texto(m.group("cant"))
    if rend is None or cant is None:
        return {"respuesta_hablada": "No entendí el rendimiento o la cantidad. Dígalos en "
                                     "número, por ejemplo «cuatro porciones».",
                "accion": None, "destino": None, "pestana": None}
    elegido = _elegir_ingrediente_sin_ambiguedad(m.group("ing"))
    if "error" in elegido:
        if "opciones" in elegido:
            _PENDIENTE_AMBIGUEDAD[u.id] = {
                "tipo": "crear_receta", "nombre": nombre, "rend": rend, "cant": cant,
                "opciones": elegido["opciones"], "ts": ahora()}
        return {"respuesta_hablada": elegido["error"],
                "accion": None, "destino": None, "pestana": None}
    return _completar_crear_receta(nombre, rend, cant, elegido["articulo"], u)


_INTENCION_AGREGAR_INGREDIENTE = re.compile(
    r"\b(agr[eé]ga\w*|a[ñn]ad\w*)\b.*\breceta\b", re.IGNORECASE)


def _completar_agregar_ingrediente(cantidad_nueva: float, receta_dicha: str,
                                   articulo: dict, u: Usuario) -> dict | None:
    with Sesion() as s:
        r = _buscar_receta_por_nombre(s, receta_dicha)
        if not r:
            return None
        lineas = s.query(RecetaIngrediente).filter_by(receta_id=r.id).all()
        ya_tiene = next((li for li in lineas if li.articulo_codigo == articulo["codigo"]), None)
        if ya_tiene:
            ya_tiene.cantidad_por_porcion = cantidad_nueva
        else:
            s.add(RecetaIngrediente(receta_id=r.id, articulo_codigo=articulo["codigo"],
                                    cantidad_por_porcion=cantidad_nueva))
        s.commit()
        nombre_receta = r.nombre
    registrar(u, "RECETA", f"Receta editada: {nombre_receta} (ingrediente agregado por voz)", "ok")
    return {"respuesta_hablada": f"Listo, agregué {articulo['nombre'].title()} a la receta {nombre_receta}.",
            "accion": "actualizar", "destino": None, "pestana": None}


def _agregar_ingrediente_por_voz(texto: str, u: Usuario) -> dict | None:
    """"Agrégale <cantidad> de <ingrediente> a la receta <nombre>" -
    determinístico. Reusa la misma búsqueda de artículo que crear
    receta, y conserva los ingredientes que ya tenía (PUT reemplaza
    toda la lista, así que se lee la receta primero)."""
    if u.perfil != "auditor":
        return None
    m = _AGREGAR_INGREDIENTE.search(texto.strip())
    if not m:
        # "preparación" en la frase es de _agregar_preparacion_por_voz,
        # no de esta - sin la exclusión, "agrega la preparación a la
        # receta X: ..." caía aquí primero (comparte "agrega...receta")
        # y nunca le daba la oportunidad a la función correcta.
        if (_INTENCION_AGREGAR_INGREDIENTE.search(texto)
                and not re.search(r"preparaci[oó]n", texto, re.IGNORECASE)
                and not _ES_PREGUNTA_PESTANA.search(texto)):
            return {"respuesta_hablada": "Para agregar un ingrediente diga: «agrega» la "
                                         "cantidad «de» el ingrediente «a la receta» el "
                                         "nombre de la receta.",
                    "accion": None, "destino": None, "pestana": None}
        return None
    cantidad_nueva = _numero_de_texto(m.group("cant"))
    if cantidad_nueva is None:
        return {"respuesta_hablada": "No entendí la cantidad. Dígala en número, por "
                                     "ejemplo «trescientos gramos».",
                "accion": None, "destino": None, "pestana": None}
    elegido = _elegir_ingrediente_sin_ambiguedad(m.group("ing"))
    if "error" in elegido:
        if "opciones" in elegido:
            _PENDIENTE_AMBIGUEDAD[u.id] = {
                "tipo": "agregar_ingrediente", "cant": cantidad_nueva,
                "receta": m.group("receta"), "opciones": elegido["opciones"],
                "ts": ahora()}
        return {"respuesta_hablada": elegido["error"],
                "accion": None, "destino": None, "pestana": None}
    return _completar_agregar_ingrediente(cantidad_nueva, m.group("receta"),
                                          elegido["articulo"], u)


def _resolver_ambiguedad_pendiente(texto: str, u: Usuario) -> dict | None:
    """Si la última respuesta de esta persona fue "es ambiguo, encontré
    Papa Sabanera, Papa Criolla, Papa Pastusa..." y en este turno dice
    solo "papa pastusa" (sin repetir la orden completa), esto retoma la
    orden original con ese ingrediente ya resuelto. Se revisa AL FINAL
    de la cadena de comandos de Ajustes, después de que crear/agregar
    ya tuvieron su oportunidad de matchear la frase completa - así una
    orden repetida entera (en vez de solo el nombre corto) sigue
    tomando el camino normal, con sus datos frescos, no los guardados
    aquí de la vez anterior."""
    pendiente = _PENDIENTE_AMBIGUEDAD.get(u.id)
    if not pendiente:
        return None
    if (ahora() - pendiente["ts"]).total_seconds() > _VENCIMIENTO_AMBIGUEDAD:
        del _PENDIENTE_AMBIGUEDAD[u.id]
        return None
    t = _normalizar_nombre(texto)
    elegido = next(
        (c for c in pendiente["opciones"]
         if re.search(rf"\b{re.escape(_normalizar_nombre(c['nombre']))}\b", t)
         or re.search(rf"\b{re.escape(t)}\b", _normalizar_nombre(c["nombre"]))),
        None)
    if not elegido:
        return None
    del _PENDIENTE_AMBIGUEDAD[u.id]
    if pendiente["tipo"] == "crear_receta":
        return _completar_crear_receta(pendiente["nombre"], pendiente["rend"],
                                       pendiente["cant"], elegido, u)
    return _completar_agregar_ingrediente(pendiente["cant"], pendiente["receta"], elegido, u)


def _eliminar_receta_por_voz(texto: str, u: Usuario) -> dict | None:
    """"Elimina la receta <nombre>" - determinístico, busca por nombre
    completo entre las recetas existentes, igual que aprobaciones. NUNCA
    borra en el mismo turno que se pide: pregunta primero y solo borra si
    el siguiente turno confirma (ver _resolver_confirmacion_eliminar_receta)
    - es una acción irreversible (se lleva también los ingredientes) y un
    "elimina la receta X" mal escuchado, o una intención mal adivinada por
    Gemini, no debe bastar para borrarla sin confirmación explícita, igual
    que ya exige el botón equivalente en pantalla (window.confirm)."""
    if u.perfil != "auditor":
        return None
    m = _ELIMINAR_RECETA.search(texto.strip())
    if not m:
        return None
    with Sesion() as s:
        r = _buscar_receta_por_nombre(s, m.group("receta"))
        if not r:
            return None
        rid, nombre = r.id, r.nombre
    _PENDIENTE_AMBIGUEDAD[u.id] = {"tipo": "eliminar_receta", "receta_id": rid,
                                   "nombre": nombre, "ts": ahora()}
    return {"respuesta_hablada": f"¿Confirma que elimina la receta {nombre}? "
                                 "Esta acción no se puede deshacer.",
            "accion": None, "destino": None, "pestana": None}


def _resolver_confirmacion_eliminar_receta(texto: str, u: Usuario) -> dict | None:
    """El sí/no al "¿confirma que elimina la receta X?" de arriba. Se
    revisa ANTES que cualquier otra orden de esta pantalla: un "sí" o un
    "no" sueltos no deben caer en ningún otro reconocedor mientras esta
    confirmación sigue pendiente."""
    pendiente = _PENDIENTE_AMBIGUEDAD.get(u.id)
    if not pendiente or pendiente.get("tipo") != "eliminar_receta":
        return None
    if (ahora() - pendiente["ts"]).total_seconds() > _VENCIMIENTO_AMBIGUEDAD:
        del _PENDIENTE_AMBIGUEDAD[u.id]
        return None
    t = texto.lower()
    palabras = t.replace(",", " ").replace(".", " ").split()
    dice_si = (any(p in ("si", "sí", "claro", "listo", "dale", "correcto", "confirmo") for p in palabras)
               or "confirmo" in t or "así es" in t or "asi es" in t)
    dice_no = "no" in palabras or "mejor no" in t or "cancela" in t
    if not (dice_si or dice_no):
        return None
    del _PENDIENTE_AMBIGUEDAD[u.id]
    if dice_no:
        return {"respuesta_hablada": f"Entendido, no elimino la receta {pendiente['nombre']}.",
                "accion": None, "destino": None, "pestana": None}
    with Sesion() as s:
        r = s.get(Receta, pendiente["receta_id"])
        if r is None:
            return {"respuesta_hablada": "Esa receta ya no existe.",
                    "accion": None, "destino": None, "pestana": None}
        nombre = r.nombre
        s.query(RecetaIngrediente).filter_by(receta_id=r.id).delete()
        s.delete(r)
        s.commit()
    registrar(u, "RECETA", f"Receta eliminada: {nombre} por voz (confirmada)", "ok")
    return {"respuesta_hablada": f"Listo, eliminé la receta {nombre}.",
            "accion": "actualizar", "destino": None, "pestana": None}


_QUITAR_INGREDIENTE = re.compile(
    r"\b(?:qu[ií]ta\w*|elimin\w*|borr\w*)\s+(?:el\s+)?ingredient\w*\s+(?P<ing>.+?)"
    r"\s+de\s+la\s+receta\s+(?P<receta>.+?)\s*" + _CORTE_ORDEN_ENCADENADA + r"[.!]?\s*$",
    re.IGNORECASE)


def _quitar_ingrediente_por_voz(texto: str, u: Usuario) -> dict | None:
    """"Quita/elimina el ingrediente <ingrediente> de la receta <nombre>" -
    mismo botón «Editar» de Recetas, pero solo para sacar UN ingrediente
    (no reemplaza toda la lista). Busca el ingrediente entre los que YA
    tiene esa receta, no contra todo el catálogo - así "quita la
    cebolla" no confunde una cebolla que ni siquiera está en esa
    receta. Nunca deja una receta sin ingredientes (la misma regla que
    ya exige el botón)."""
    if u.perfil != "auditor":
        return None
    m = _QUITAR_INGREDIENTE.search(texto.strip())
    if not m:
        return None
    with Sesion() as s:
        r = _buscar_receta_por_nombre(s, m.group("receta"))
        if not r:
            return None
        lineas = s.query(RecetaIngrediente).filter_by(receta_id=r.id).all()
        t_ing = _normalizar_nombre(m.group("ing"))
        objetivo = None
        nombre_articulo = None
        for li in lineas:
            art = s.get(Articulo, li.articulo_codigo)
            if not art:
                continue
            nombre_art = _normalizar_nombre(art.nombre_oficial)
            if (re.search(rf"\b{re.escape(nombre_art)}\b", t_ing)
                    or re.search(rf"\b{re.escape(t_ing)}\b", nombre_art)):
                objetivo, nombre_articulo = li, art.nombre_oficial
                break
        if not objetivo:
            return {"respuesta_hablada": f"{r.nombre.title()} no tiene un ingrediente llamado "
                                         f"«{m.group('ing')}».",
                    "accion": None, "destino": None, "pestana": None}
        if len(lineas) <= 1:
            return {"respuesta_hablada": f"No puedo quitar {nombre_articulo.title()}: "
                                         f"{r.nombre.title()} se quedaría sin ingredientes.",
                    "accion": None, "destino": None, "pestana": None}
        s.delete(objetivo)
        nombre_receta = r.nombre
        s.commit()
    registrar(u, "RECETA", f"Receta editada: {nombre_receta} ({nombre_articulo} quitado por voz)", "ok")
    return {"respuesta_hablada": f"Listo, quité {nombre_articulo.title()} de la receta {nombre_receta}.",
            "accion": "actualizar", "destino": None, "pestana": None}


_CAMBIAR_RENDIMIENTO = re.compile(
    r"\bcambia\w*\s+el\s+rendimient\w*\s+de\s+la\s+receta\s+(?P<receta>.+?)"
    r"\s+a\s+(?P<rend>.+?)\s*porcion\w*\s*" + _CORTE_ORDEN_ENCADENADA + r"[.!]?\s*$",
    re.IGNORECASE)


def _cambiar_rendimiento_por_voz(texto: str, u: Usuario) -> dict | None:
    """"Cambia el rendimiento de la receta <nombre> a <N> porciones" -
    otro campo editable del botón «Editar» de Recetas (además de los
    ingredientes, que se agregan/quitan aparte, y la preparación, que
    se dicta con _agregar_preparacion_por_voz)."""
    if u.perfil != "auditor":
        return None
    m = _CAMBIAR_RENDIMIENTO.search(texto.strip())
    if not m:
        return None
    nuevo = _numero_de_texto(m.group("rend"))
    if nuevo is None:
        return {"respuesta_hablada": "No entendí el rendimiento. Dígalo en número, por "
                                     "ejemplo «seis porciones».",
                "accion": None, "destino": None, "pestana": None}
    nuevo = int(nuevo)
    with Sesion() as s:
        r = _buscar_receta_por_nombre(s, m.group("receta"))
        if not r:
            return None
        if r.rendimiento == nuevo:
            return {"respuesta_hablada": f"{r.nombre.title()} ya rendía {nuevo} porciones.",
                    "accion": "actualizar", "destino": None, "pestana": None}
        r.rendimiento = nuevo
        nombre = r.nombre
        s.commit()
    registrar(u, "RECETA", f"Receta editada: {nombre} (rendimiento -> {nuevo} por voz)", "ok")
    return {"respuesta_hablada": f"Listo, {nombre.title()} ahora rinde {nuevo} porciones.",
            "accion": "actualizar", "destino": None, "pestana": None}


_AGREGAR_PREPARACION = re.compile(
    r"\b(?:agr[eé]ga\w*|cambia\w*|pon\w*|dicta\w*|escrib\w*)\s+(?:la\s+)?preparaci[oó]n"
    r"\s+(?:de\s+|a\s+)?(?:la\s+receta\s+)?(?P<receta>.+?)\s*[:,]\s*(?P<pasos>.+?)\s*$",
    re.IGNORECASE)
_INTENCION_AGREGAR_PREPARACION = re.compile(
    r"\b(?:agr[eé]ga\w*|cambia\w*|pon\w*|dicta\w*|escrib\w*)\b.*\bpreparaci[oó]n\b",
    re.IGNORECASE)


def _agregar_preparacion_por_voz(texto: str, u: Usuario) -> dict | None:
    """"Agrega la preparación a la receta <nombre>: <pasos>" - a
    diferencia de nombre/ingrediente/rendimiento (frases cortas), aquí
    todo lo que sigue a los dos puntos ES el dato, tal cual, sin cortar
    en la primera coma o punto (los pasos de cocina naturalmente tienen
    varias oraciones: "primero pele las papas. Luego sofría...") - por
    eso esta es la ÚNICA función de Recetas que NO usa
    _CORTE_ORDEN_ENCADENADA. Reemplaza la preparación completa (como el
    textarea del botón «Editar»), no la suma a lo que ya había."""
    if u.perfil != "auditor":
        return None
    m = _AGREGAR_PREPARACION.search(texto.strip())
    if not m:
        if (_INTENCION_AGREGAR_PREPARACION.search(texto)
                and not _ES_PREGUNTA_PESTANA.search(texto)):
            return {"respuesta_hablada": "Para dictar la preparación diga: «agrega la "
                                         "preparación a la receta» el nombre, dos puntos, y "
                                         "los pasos - por ejemplo «agrega la preparación a "
                                         "la receta Sopa: pele las papas, sofría la cebolla, "
                                         "y cocine todo junto veinte minutos».",
                    "accion": None, "destino": None, "pestana": None}
        return None
    pasos = re.sub(r"[.,;:!¿?¡]+$", "", m.group("pasos")).strip()
    if not pasos:
        return None
    with Sesion() as s:
        r = _buscar_receta_por_nombre(s, m.group("receta"))
        if not r:
            return None
        r.preparacion = pasos
        nombre = r.nombre
        s.commit()
    registrar(u, "RECETA", f"Receta editada: {nombre} (preparación dictada por voz)", "ok")
    return {"respuesta_hablada": f"Listo, guardé la preparación de la receta {nombre}.",
            "accion": "actualizar", "destino": None, "pestana": None}


def _cambiar_perfil_por_voz(texto: str, u: Usuario) -> dict | None:
    """"Cambia el perfil de <nombre> a auxiliar/administrador" - mismo
    botón «Editar» de Gestión de usuarios, solo el campo perfil (el
    correo no se toca por voz: un correo mal transcrito rompería el
    contacto sin que se note). Llama la MISMA función que usa el botón
    (editar_usuario), así que hereda su regla de no poder cambiarse el
    propio rol - excluida además desde la búsqueda del nombre."""
    if u.perfil != "auditor" or not re.search(r"\bperfil\b", texto, re.IGNORECASE):
        return None
    m = re.search(r"\b(auxiliar|auditor|administrador)\b", texto, re.IGNORECASE)
    if not m:
        if not _ES_PREGUNTA_PESTANA.search(texto):
            return {"respuesta_hablada": "Diga a qué perfil: «cambia el perfil de» el "
                                         "nombre «a» auxiliar o administrador.",
                    "accion": None, "destino": None, "pestana": None}
        return None
    perfil_nuevo = "auditor" if m.group(1).lower() in ("auditor", "administrador") else "auxiliar"
    t = _normalizar_nombre(texto)
    with Sesion() as s:
        candidatos = s.query(Usuario).filter(Usuario.id != u.id).all()
        encontrado = next(
            (c for c in candidatos
             if re.search(rf"\b{re.escape(_normalizar_nombre(c.nombre))}\b", t)),
            None)
        if not encontrado:
            return {"respuesta_hablada": "No encontré a esa persona. Diga el nombre completo "
                                         "tal como aparece en la lista.",
                    "accion": None, "destino": None, "pestana": None}
        etiqueta = "administrador" if perfil_nuevo == "auditor" else "auxiliar"
        if encontrado.perfil == perfil_nuevo:
            return {"respuesta_hablada": f"{encontrado.nombre.capitalize()} ya era {etiqueta}.",
                    "accion": "actualizar", "destino": None, "pestana": None}
        eid, nombre = encontrado.id, encontrado.nombre
    editar_usuario(usuario_id=eid, datos=EditarUsuarioIn(perfil=perfil_nuevo), u=u)
    return {"respuesta_hablada": f"Listo, {nombre.capitalize()} ahora es {etiqueta}.",
            "accion": "actualizar", "destino": None, "pestana": None}


_ASIGNAR_BODEGA = re.compile(
    r"\bas[ií]gn\w*\s+(?:le\s+)?(?:la\s+)?bodega\s+(?P<bodega>.+?)\s+a\s+(?P<nombre>.+?)"
    r"\s*" + _CORTE_ORDEN_ENCADENADA + r"[.!]?\s*$", re.IGNORECASE)
_QUITAR_BODEGA = re.compile(
    r"\bqu[ií]t\w*\s+(?:le\s+)?(?:la\s+)?bodega\s+(?P<bodega>.+?)\s+a\s+(?P<nombre>.+?)"
    r"\s*" + _CORTE_ORDEN_ENCADENADA + r"[.!]?\s*$", re.IGNORECASE)


def _asignar_bodega_por_voz(texto: str, u: Usuario) -> dict | None:
    """"Asígnale/quítale la bodega <bodega> a <nombre>" - mismo botón
    «Asignar bodegas», pero sumando o quitando SOLO la bodega dicha en
    vez de reemplazar toda la lista (que es lo que hace el botón, que
    parte de las bodegas ya marcadas): así una orden de voz nunca borra
    por accidente asignaciones hechas por otro medio. El nombre de la
    bodega se busca con el mismo buscador que «abra <bodega>» en
    Conteo, así que entiende apodos parciales igual ("kiosco taquilla"
    encuentra "KIOSCO TAQUILLA AYB")."""
    if u.perfil != "auditor":
        return None
    m = _ASIGNAR_BODEGA.search(texto.strip())
    quitar = False
    if not m:
        m = _QUITAR_BODEGA.search(texto.strip())
        quitar = True
    if not m:
        # OJO: el verbo debe terminar justo en "a/ale/ar" (con \b después)
        # para no confundirse con el SUSTANTIVO "asignación" - sin ese
        # límite, "muéstrame la asignación por bodega" (que es la orden
        # de abrir el panel, no de asignar nada) caía aquí por error,
        # porque "asign" es raíz común de las dos palabras.
        if (re.search(r"\bbodega\b", texto, re.IGNORECASE)
                and re.search(r"\bas[ií]gn(?:a(?:le)?|ar)\b|\bqu[ií]t(?:a(?:le)?|ar)\b",
                              texto, re.IGNORECASE)
                and not _ES_PREGUNTA_PESTANA.search(texto)):
            return {"respuesta_hablada": "Diga: «asígnale/quítale la bodega» el nombre de "
                                         "la bodega «a» el nombre de la persona.",
                    "accion": None, "destino": None, "pestana": None}
        return None
    from servicios.conciliacion import buscar_bodega
    t_nombre = _normalizar_nombre(m.group("nombre"))
    with Sesion() as s:
        bodega = buscar_bodega(s, m.group("bodega"), None)
        if not bodega:
            return {"respuesta_hablada": f"No encontré una bodega llamada «{m.group('bodega')}».",
                    "accion": None, "destino": None, "pestana": None}
        candidatos = s.query(Usuario).filter(Usuario.id != u.id).all()
        persona = next(
            (c for c in candidatos
             if re.search(rf"\b{re.escape(_normalizar_nombre(c.nombre))}\b", t_nombre)),
            None)
        if not persona:
            return {"respuesta_hablada": "No encontré a esa persona. Diga el nombre completo "
                                         "tal como aparece en la lista.",
                    "accion": None, "destino": None, "pestana": None}
        actuales = {a.bodega_id for a in
                   s.query(AsignacionBodega).filter_by(usuario_id=persona.id).all()}
        ya_tenia = bodega.id in actuales
        if quitar and not ya_tenia:
            return {"respuesta_hablada": f"{persona.nombre.capitalize()} no tenía asignada "
                                         f"{bodega.nombre_oficial.title()}.",
                    "accion": "actualizar", "destino": None, "pestana": None}
        if not quitar and ya_tenia:
            return {"respuesta_hablada": f"{persona.nombre.capitalize()} ya tenía asignada "
                                         f"{bodega.nombre_oficial.title()}.",
                    "accion": "actualizar", "destino": None, "pestana": None}
        if quitar:
            actuales.discard(bodega.id)
        else:
            actuales.add(bodega.id)
        pid, pnombre, bnombre = persona.id, persona.nombre, bodega.nombre_oficial
        nuevos_ids = list(actuales)
    asignar_bodegas(usuario_id=pid, body={"bodega_ids": nuevos_ids}, u=u)
    verbo = "quité" if quitar else "asigné"
    return {"respuesta_hablada": f"Listo, le {verbo} {bnombre.title()} a {pnombre.capitalize()}.",
            "accion": "actualizar", "destino": None, "pestana": None}


_QUIEN_TIENE_BODEGA = re.compile(
    r"\bqui[eé]n\s+(?:tiene|es\s+responsable\s+de|maneja)\s+(?:la\s+)?bodega\s+"
    r"(?P<bodega>.+?)\s*[.!?¿]*\s*$", re.IGNORECASE)
_BODEGAS_SIN_ASIGNAR = re.compile(r"\bbodegas?\b.*\bsin\s+asignar\b", re.IGNORECASE)


def _consultar_asignacion_bodega_por_voz(texto: str, u: Usuario) -> dict | None:
    """Lo mismo que el botón «Ver asignación por bodega», pero como
    pregunta hablada en vez de abrir la tabla completa de 54 filas:
    "¿quién tiene la bodega <bodega>?" contesta solo esa fila, y
    "¿cuántas bodegas sin asignar hay?" resume las que no tiene nadie -
    de solo lectura, así que no exige ninguna confirmación extra."""
    if u.perfil != "auditor":
        return None
    if _BODEGAS_SIN_ASIGNAR.search(texto):
        with Sesion() as s:
            asignadas = {a.bodega_id for a in s.query(AsignacionBodega).all()}
            sin = [b.nombre_oficial for b in s.query(Bodega).all() if b.id not in asignadas]
        if not sin:
            return {"respuesta_hablada": "Todas las bodegas tienen al menos una persona asignada.",
                    "accion": None, "destino": None, "pestana": None}
        listado = ", ".join(n.title() for n in sin[:8])
        extra = f" y {len(sin) - 8} más" if len(sin) > 8 else ""
        return {"respuesta_hablada": f"{len(sin)} bodegas sin asignar: {listado}{extra}.",
                "accion": None, "destino": None, "pestana": None}
    m = _QUIEN_TIENE_BODEGA.search(texto.strip())
    if not m:
        return None
    from servicios.conciliacion import buscar_bodega
    with Sesion() as s:
        bodega = buscar_bodega(s, m.group("bodega"), None)
        if not bodega:
            return {"respuesta_hablada": f"No encontré una bodega llamada «{m.group('bodega')}».",
                    "accion": None, "destino": None, "pestana": None}
        asignados = [s.get(Usuario, a.usuario_id) for a in
                    s.query(AsignacionBodega).filter_by(bodega_id=bodega.id).all()]
        nombres = [p.nombre.capitalize() for p in asignados if p]
        titulo = bodega.nombre_oficial.title()
    if not nombres:
        return {"respuesta_hablada": f"{titulo} no tiene a nadie asignado todavía.",
                "accion": None, "destino": None, "pestana": None}
    return {"respuesta_hablada": f"{titulo} está asignada a {', '.join(nombres)}.",
            "accion": None, "destino": None, "pestana": None}


_ABRIR_COBERTURA = re.compile(
    r"\b(mu[eé]stra\w*|ens[eé][ñn]a\w*|[aá]bre\w*|ver)\b.*\basignaci[oó]n\b.*\bbodega",
    re.IGNORECASE)
_CERRAR_COBERTURA = re.compile(
    r"\b(oc[uú]lta\w*|ci[eé]rra\w*|esc[oó]nde\w*)\b.*\basignaci[oó]n\b.*\bbodega",
    re.IGNORECASE)


def _alternar_cobertura_por_voz(texto: str, u: Usuario) -> dict | None:
    """El botón «Ver/Ocultar asignación por bodega» abre o cierra la
    tabla completa de 54 filas (quién tiene cada bodega) - a diferencia
    de _consultar_asignacion_bodega_por_voz (que contesta una pregunta
    puntual sin tocar la pantalla), esto es la orden de abrir/cerrar el
    panel mismo, igual que el clic al botón."""
    if u.perfil != "auditor":
        return None
    if _ABRIR_COBERTURA.search(texto):
        return {"respuesta_hablada": "Listo, ahí tiene la asignación por bodega.",
                "accion": "mostrar_cobertura", "destino": None, "pestana": None}
    if _CERRAR_COBERTURA.search(texto):
        return {"respuesta_hablada": "Listo, la oculto.",
                "accion": "ocultar_cobertura", "destino": None, "pestana": None}
    return None


_EXPORTAR_TRAZA = re.compile(
    r"\b(export\w*|descarg\w*|genera\w*)\b.*\b(traza|trazabilidad)\b", re.IGNORECASE)


def _exportar_trazabilidad_por_voz(texto: str, u: Usuario) -> dict | None:
    """El botón «Exportar» de Registro de trazabilidad exporta con los
    filtros (persona/acción/rango) que YA están marcados en pantalla -
    esos viven como estado de React en el frontend, no llegan en el
    texto de esta orden, así que no se puede armar el archivo aquí en
    el backend. En cambio, se avisa con la misma acción genérica que ya
    usa mostrar/ocultar cobertura, y el frontend llama a su propia
    función exportar() con los filtros que tenga puestos - igual que si
    hubiera dado clic al botón."""
    if u.perfil != "auditor":
        return None
    if not _EXPORTAR_TRAZA.search(texto):
        return None
    return {"respuesta_hablada": "Listo, exportando el registro de trazabilidad con los "
                                 "filtros que tiene puestos.",
            "accion": "exportar_trazabilidad", "destino": None, "pestana": None}


_ETIQUETA_RANGO_TRAZA = {"hoy": "hoy", "semana": "en la última semana",
                         "mes": "en el último mes", "": "en total"}


def _rango_dicho_traza(texto: str) -> str:
    t = texto.lower()
    if re.search(r"\bsemana\b", t):
        return "semana"
    if re.search(r"\bmes\b", t):
        return "mes"
    if re.search(r"\btodo\b|\bsiempre\b", t):
        return ""
    return "hoy"  # mismo valor por defecto con el que abre la pestaña


_ACCIONES_DE_PERSONA = re.compile(
    r"\bcu[aá]ntas\s+acciones\s+tiene\s+(?P<persona>.+?)\s*[.!?]*\s*$", re.IGNORECASE)
_ACCIONES_POR_PERSONA = re.compile(
    r"\bacciones\s+por\s+persona\b|\bcu[aá]ntas\s+acciones\s+tiene\s+cada\s+persona\b|"
    r"\bresumen\s+de\s+acciones\b", re.IGNORECASE)


def _acciones_por_persona_por_voz(texto: str, u: Usuario) -> dict | None:
    """Pedido explícito del usuario: "acciones por persona" contesta un
    resumen con cuántas hizo cada quien, y "¿cuántas acciones tiene
    <nombre>?" contesta solo por esa persona - los dos de solo lectura,
    sin abrir ni cambiar nada en pantalla, así que no hace falta
    confirmación. El periodo por defecto es "hoy" (igual que la
    pestaña al abrirse); decir "esta semana"/"este mes"/"en total"
    lo cambia."""
    if u.perfil != "auditor":
        return None
    m = _ACCIONES_DE_PERSONA.search(texto.strip())
    if m:
        rango = _rango_dicho_traza(texto)
        t_nombre = _normalizar_nombre(m.group("persona"))
        with Sesion() as s:
            candidatos = s.query(Usuario).all()
            persona_obj = next(
                (c for c in candidatos
                 if re.search(rf"\b{re.escape(_normalizar_nombre(c.nombre))}\b", t_nombre)),
                None)
            if not persona_obj:
                return None
            total = _filtro_traza(s, persona_obj.nombre, "", rango).count()
            nombre = persona_obj.nombre
        return {"respuesta_hablada": f"{nombre.capitalize()} tiene {total} acciones "
                                     f"{_ETIQUETA_RANGO_TRAZA[rango]}.",
                "accion": None, "destino": None, "pestana": None}
    if _ACCIONES_POR_PERSONA.search(texto):
        rango = _rango_dicho_traza(texto)
        with Sesion() as s:
            filas = _filtro_traza(s, "", "", rango).all()
        if not filas:
            return {"respuesta_hablada": f"No hay acciones registradas {_ETIQUETA_RANGO_TRAZA[rango]}.",
                    "accion": None, "destino": None, "pestana": None}
        conteos: dict[str, int] = {}
        for f in filas:
            conteos[f.persona] = conteos.get(f.persona, 0) + 1
        ordenado = sorted(conteos.items(), key=lambda par: -par[1])
        resumen = ", ".join(f"{p.capitalize()}: {n}" for p, n in ordenado[:8])
        extra = f", y {len(ordenado) - 8} personas más" if len(ordenado) > 8 else ""
        return {"respuesta_hablada": f"Acciones por persona {_ETIQUETA_RANGO_TRAZA[rango]}: "
                                     f"{resumen}{extra}.",
                "accion": None, "destino": None, "pestana": None}
    return None


def _resolver_asistente(vista: str, texto: str, u: Usuario) -> dict:
    """Lo que responde el agente liviano ante una pregunta suelta o una
    orden de navegar - usado tanto por /api/agente/asistente (Inicio,
    Ajustes, Ayuda, Reportes, Panel) como, cuando ni un artículo ni una
    bodega coinciden, por el buscador de Bodegas (ver consulta_articulo):
    un solo buscador que primero prueba si es un ingrediente, luego si
    es una bodega, y si no es ninguna de las dos, cae aquí."""
    texto = _quitar_relleno(texto)
    if vista == "inicio":
        acceso = _acceso_rapido_inicio_por_voz(texto, u)
        if acceso:
            return acceso
    # Desde Bodegas, "abra/siga contando <nombre>" es una orden concreta y
    # frecuente - se resuelve aparte, ANTES de Gemini, con la misma
    # búsqueda restringida que usa el resto de la app (nunca ofrece una
    # bodega ajena a lo asignado). El verbo es obligatorio: sin él, decir
    # el nombre de una bodega podría ser una PREGUNTA sobre ella ("¿cómo
    # va kiosco taquilla ayb?"), no una orden de ir a contarla.
    if vista == "bodegas" and _VERBOS_ABRIR_BODEGA.search(texto):
        from servicios.conciliacion import buscar_bodega
        with Sesion() as s:
            bodega = buscar_bodega(s, texto, _ids_permitidos_para_buscar(s, u))
        if bodega:
            return {"respuesta_hablada": f"Vamos a Conteo a abrir {bodega.nombre_oficial.title()}.",
                    "accion": "navegar", "destino": "conteo", "pestana": None,
                    "bodega": bodega.nombre_oficial}
    if vista == "ajustes":
        # el sí/no a "¿confirma que elimina la receta X?" tiene prioridad
        # sobre cualquier otra cosa: mientras esa confirmación siga
        # pendiente, un "sí" o un "no" sueltos son la respuesta a ESO, no
        # una orden nueva - revisarlo antes evita que caiga en otro
        # reconocedor de la cadena de abajo.
        confirmacion = _resolver_confirmacion_eliminar_receta(texto, u)
        if confirmacion:
            return confirmacion
        # identidad (no solo presencia) de lo que había pendiente ANTES
        # de este turno - crear_receta/agregar_ingrediente pueden dejar
        # una ambigüedad NUEVA en el mismo turno (cambio ya sale
        # "truthy" con el mensaje de "es ambiguo...") y esa no se debe
        # borrar; solo se limpia la que YA estaba ahí sin que nada de
        # este turno la haya tocado.
        pendiente_antes = _PENDIENTE_AMBIGUEDAD.get(u.id)
        cambio = (_cambiar_modo_sin_conexion(texto, u) or _cambiar_estado_usuario(texto, u)
                 or _crear_usuario_por_voz(texto, u) or _cambiar_perfil_por_voz(texto, u)
                 or _asignar_bodega_por_voz(texto, u) or _alternar_cobertura_por_voz(texto, u)
                 or _consultar_asignacion_bodega_por_voz(texto, u)
                 or _crear_receta_por_voz(texto, u)
                 or _agregar_ingrediente_por_voz(texto, u) or _quitar_ingrediente_por_voz(texto, u)
                 or _cambiar_rendimiento_por_voz(texto, u) or _agregar_preparacion_por_voz(texto, u)
                 or _eliminar_receta_por_voz(texto, u) or _exportar_trazabilidad_por_voz(texto, u)
                 or _acciones_por_persona_por_voz(texto, u))
        if cambio:
            # una orden distinta que sí coincidió significa que la
            # persona siguió para otra cosa - una pregunta ambigua sin
            # contestar de hace un rato no debe "resucitar" más tarde
            # por una frase corta que por casualidad se parezca a una
            # de esas opciones viejas.
            if _PENDIENTE_AMBIGUEDAD.get(u.id) is pendiente_antes:
                _PENDIENTE_AMBIGUEDAD.pop(u.id, None)
            return cambio
        resuelta_pendiente = _resolver_ambiguedad_pendiente(texto, u)
        if resuelta_pendiente:
            return resuelta_pendiente
    if vista == "reportes":
        generado = _generar_reporte_por_voz(texto, u)
        if generado:
            return generado
        previsualizado = _previsualizar_reporte_por_voz(texto, u)
        if previsualizado:
            return previsualizado
        respondida = _responder_reportes_por_voz(texto, u)
        if respondida:
            return respondida
    if vista == "auditoria":
        resuelta = _resolver_aprobacion_por_voz(texto, u)
        if resuelta:
            return resuelta
        resuelto_pedido = _resolver_pedido_pendiente_por_voz(texto, u)
        if resuelto_pedido:
            return resuelto_pedido
        resuelta_alerta = _resolver_alerta_por_voz(texto, u)
        if resuelta_alerta:
            return resuelta_alerta
        auditada = _abrir_bodega_para_auditoria_por_voz(texto, u)
        if auditada:
            return auditada
        respondida = _responder_auditoria_por_voz(texto, u)
        if respondida:
            return respondida
    if vista == "panel":
        respondida = _responder_panel_por_voz(texto, u)
        if respondida:
            return respondida
    if vista == "perfil":
        cambio = (_cambiar_voz_por_voz(texto, u) or _cambiar_velocidad_por_voz(texto, u)
                 or _cambiar_confirmacion_hablada_por_voz(texto, u))
        if cambio:
            return cambio
        respondida = _responder_perfil_por_voz(texto, u)
        if respondida:
            return respondida
    navegada = _navegar_pestana_por_voz(vista, texto)
    if navegada:
        return navegada
    destinos = dict(_DESTINOS_ASISTENTE)
    if u.perfil != "auditor":
        for k in _SOLO_AUDITOR_ASISTENTE:
            destinos.pop(k, None)
    # Sin esto, Gemini podia "sugerir" ir a la pantalla en la que la
    # persona YA esta (confirmado: ofrecio "llevarla a Gestion de
    # usuarios" estando ella ahi mismo) - una orden real de cambiar de
    # PESTAÑA dentro de la misma pantalla ya se resolvio antes, arriba
    # (_navegar_pestana_por_voz), asi que si el mensaje llega hasta aqui
    # nunca es eso.
    destinos.pop(vista, None)
    contexto = _contexto_asistente(vista, u)
    from agente.cerebro import pensar_asistente
    turno = pensar_asistente(contexto, texto, destinos, _PESTANAS_ASISTENTE)
    destino = turno.get("destino")
    if (turno.get("intencion") or "").lower() == "navegar" and destino in destinos:
        pestana = turno.get("pestana")
        pestanas_validas = _PESTANAS_ASISTENTE.get(destino, {})
        if pestana not in pestanas_validas:
            pestana = None
        return {"respuesta_hablada": turno.get("respuesta_hablada", ""),
                "accion": "navegar", "destino": destino, "pestana": pestana}
    return {"respuesta_hablada": turno.get("respuesta_hablada", ""),
            "accion": None, "destino": None, "pestana": None}


@app.post("/api/agente/asistente")
def api_asistente(p: PreguntarAsistenteIn, u: Usuario = Depends(usuario_actual)):
    """Version liviana del agente para pantallas que no cuentan ni piden
    (Inicio, Ajustes, Ayuda, Reportes, Panel): responde preguntas sobre lo
    que hay en esa pantalla y navega a otra si se lo piden. Sin el estado
    multi-turno de /api/agente/turno, que es especifico del conteo/pedido."""
    return _resolver_asistente(p.vista, p.texto, u)


@app.get("/api/sesiones/{sesion_id}/avance")
def ver_avance(sesion_id: int, bodega_id_respaldo: int | None = None,
              u: Usuario = Depends(usuario_actual)):
    est = ESTADOS.setdefault(sesion_id, {})
    # mismo respaldo que en /agente/turno: si el backend se reinicio, el
    # frontend todavia sabe en que bodega estaba y este numero deja de
    # verse roto ("avance: 4 de 0") en vez de exigir que se reabra.
    if bodega_id_respaldo and not est.get("bodega_id"):
        est["bodega_id"] = bodega_id_respaldo
    with Sesion() as s:
        hechas = s.query(Conteo).filter_by(sesion_id=sesion_id,
                                           estado="confirmado").count()
        alertas = s.query(Alerta).filter_by(resuelta=0).count()
        total = (s.query(StockSistema).filter_by(bodega_id=est.get("bodega_id")).count()
                 if est.get("bodega_id") else 0)
        ultimos = (s.query(Conteo).filter_by(sesion_id=sesion_id, estado="confirmado")
                   .order_by(Conteo.id.desc()).limit(5).all())
        detalle = []
        for c in ultimos:
            a = s.get(Articulo, c.articulo_codigo)
            detalle.append({"nombre": a.nombre_oficial if a else c.articulo_codigo,
                            "cantidad": c.cantidad, "unidad": c.unidad})
    return {"hechas": hechas, "total": total, "alertas": alertas,
            "bodega": est.get("bodega_nombre"), "ultimos": detalle}


def _limpiar_nombre_dictado(t: str) -> str:
    """El reconocimiento de voz del navegador cierra la frase con
    puntuación que nadie dijo ("Juguetería."). Ya se le quita para
    BUSCAR una bodega (servicios.conciliacion.normalizar); esto hace lo
    mismo pero para GUARDAR un nombre nuevo - sin tocar tildes ni
    mayúsculas, que sí importan en lo que queda escrito en el catálogo."""
    import re
    return re.sub(r"[.,;:!¿?¡]+\s*$", "", t.strip()).strip()


class CrearProductoIn(BaseModel):
    nombre: str
    unidad_medida: str
    cantidad_inicial: float
    sesion_id: int = 1


@app.post("/api/conteo/crear-producto")
def crear_producto_pendiente(p: CrearProductoIn, u: Usuario = Depends(usuario_actual)):
    """El conteo no se detiene: el producto entra pendiente y sigue contando.
    Si quien cuenta es el administrador, el producto se confirma de una -
    igual que en crear_bodega_pendiente, dejarlo pendiente significaria que
    solo el mismo administrador puede aprobarlo despues."""
    est = ESTADOS.get(p.sesion_id, {})
    bodega_id = est.get("bodega_id")
    if not bodega_id:
        raise HTTPException(409, "Abra una bodega antes de crear un producto.")
    if p.cantidad_inicial < 0:
        raise HTTPException(400, "La cantidad inicial no puede ser negativa.")
    nombre = _limpiar_nombre_dictado(p.nombre).upper()
    # el sufijo de hora sin el sufijo aleatorio solo tenia ~100 microsegundos
    # de resolucion real (se truncaba a 10 caracteres): dos personas creando
    # un producto casi al mismo tiempo podian generar el mismo codigo y
    # tumbar la peticion con un IntegrityError sin capturar.
    codigo = f"PEND-{ahora().strftime('%Y%m%d%H%M%S')}-{secrets.token_hex(3).upper()}"
    es_auditor = u.perfil == "auditor"
    with Sesion() as s:
        s.add(Articulo(codigo=codigo, nombre_oficial=nombre,
                       unidad_medida=p.unidad_medida))
        s.commit()
        conteo = Conteo(sesion_id=p.sesion_id, articulo_codigo=codigo,
                        cantidad=p.cantidad_inicial, unidad=p.unidad_medida,
                        estado="confirmado" if es_auditor else "pendiente_aprobacion")
        s.add(conteo)
        s.commit()
        s.refresh(conteo)
        if es_auditor:
            s.add(StockSistema(articulo_codigo=codigo, bodega_id=bodega_id, cantidad_sd=0))
        else:
            s.add(Aprobacion(tipo="producto", nombre=nombre,
                             unidad_medida=p.unidad_medida, cantidad_inicial=p.cantidad_inicial,
                             bodega_id=bodega_id, articulo_codigo=codigo,
                             conteo_id=conteo.id, creado_por_id=u.id))
        s.commit()
    if es_auditor:
        registrar(u, "CREACION", f"{nombre} creado")
        return {"ok": True, "codigo": codigo,
                "respuesta_hablada": "Creado y confirmado en el catálogo."}
    registrar(u, "CREACION", f"{nombre} creado, pendiente de aprobacion")
    return {"ok": True, "codigo": codigo,
            "respuesta_hablada": "Creado. Queda pendiente de aprobación del administrador; "
                                 "el conteo sigue sin interrupción."}


# ─────────────────────── bodegas ───────────────────────
class AbrirIn(BaseModel):
    bodega: str


def _contexto_bodega(s, b, refs):
    """Segun el estado, lo que hace falta para entender de un vistazo quien
    esta en que y cuanto lleva - se usa tanto en el tablero completo como
    en «mis bodegas asignadas» de Conteo."""
    item = {}
    if b.estado == "en_conteo":
        ses = (s.query(SesionConteo)
               .filter_by(bodega_id=b.id, tipo="conteo", estado="abierta")
               .order_by(SesionConteo.id.desc()).first())
        if ses:
            persona = s.get(Usuario, ses.usuario_id)
            hechas = s.query(Conteo).filter_by(
                sesion_id=ses.id, estado="confirmado").count()
            item["persona"] = persona.nombre if persona else None
            item["avance_pct"] = round(hechas / refs * 100) if refs else 0
    elif b.estado == "en_auditoria":
        ses = (s.query(SesionConteo).filter_by(bodega_id=b.id, tipo="auditoria")
               .order_by(SesionConteo.id.desc()).first())
        if ses:
            persona = s.get(Usuario, ses.usuario_id)
            item["persona"] = persona.nombre if persona else None
        conteo_ses = (s.query(SesionConteo).filter_by(bodega_id=b.id, tipo="conteo")
                     .order_by(SesionConteo.id.desc()).first())
        difs = 0
        if conteo_ses:
            for c in (s.query(Conteo).filter_by(
                    sesion_id=conteo_ses.id, estado="confirmado").all()):
                st = s.query(StockSistema).filter_by(
                    articulo_codigo=c.articulo_codigo, bodega_id=b.id).first()
                if abs((c.cantidad or 0) - (st.cantidad_sd if st else 0)) > 0.001:
                    difs += 1
        item["diferencias"] = difs
    elif b.estado == "cerrada":
        hist = (s.query(HistorialCierre).filter_by(bodega_id=b.id)
               .order_by(HistorialCierre.fecha.desc()).first())
        if hist:
            item["hora_cierre"] = hist.fecha.strftime("%H:%M")
    return item


@app.get("/api/bodegas")
def listar_bodegas(propias: int = 0, u: Usuario = Depends(usuario_actual)):
    """El tablero en vivo: cada tarjeta necesita un dato distinto segun su
    estado (quien cuenta y cuanto lleva, quien audita y cuantas diferencias
    encontro, o a que hora se cerro) - no solo el total de referencias.

    ?propias=1 limita el tablero a las bodegas asignadas a quien pregunta -
    para un auditor/administrador. Si la persona no tiene ninguna bodega
    asignada, ve todas (administrador general, sin zona propia); si tiene
    algunas asignadas, ve solo esas (un supervisor de zona con varios
    administradores repartiendose el parque). El resto de pantallas
    (Pedidos elige donde descontar, Ajustes arma la lista para asignar)
    siguen pidiendo la lista completa sin este parametro - pantallas que
    solo un auditor/administrador alcanza a abrir.

    Un auxiliar, en cambio, nunca ve bodegas fuera de su asignacion: para
    ese perfil la restriccion aplica siempre, con o sin ?propias=1, para
    que ninguna pantalla (incluida Pedidos) filtre por accidente el parque
    completo a quien solo debe ver su zona."""
    with Sesion() as s:
        ids_asignadas = {a.bodega_id for a in
                         s.query(AsignacionBodega).filter_by(usuario_id=u.id).all()}
        restringir = propias or u.perfil == "auxiliar"
        if restringir and ids_asignadas:
            bodegas = (s.query(Bodega).filter(Bodega.id.in_(ids_asignadas))
                      .order_by(Bodega.nombre_oficial).all())
        else:
            bodegas = s.query(Bodega).order_by(Bodega.nombre_oficial).all()
        salida = []
        for b in bodegas:
            refs = s.query(StockSistema).filter_by(bodega_id=b.id).count()
            item = {"id": b.id, "bodega": b.nombre_oficial,
                    "estado": b.estado, "referencias": refs}
            item.update(_contexto_bodega(s, b, refs))
            salida.append(item)
    return salida


@app.post("/api/bodegas/buscar")
def buscar_bodega_endpoint(a: AbrirIn, u: Usuario = Depends(usuario_actual)):
    """Solo resuelve el nombre, no abre nada - para que el selector de
    bodega pueda preguntar "¿confirma que abro X?" con el nombre REAL que
    de verdad se va a abrir, en vez de repetir a ciegas lo que se
    reconoció (decir «kiosco» no debe confirmarse como si "KIOSCO" fuera
    una bodega real, cuando lo que existe es "KIOSCO TAQUILLA AYB").

    Si hay varias candidatas igual de razonables ("restaurante" a secas
    encaja en "RESTAURANTE FUENTES AYB" Y "RESTAURANTE FUENTES SUMIN"),
    se devuelven como opciones en vez de decir "no la encuentro" a secas
    - así la persona puede elegir la que quería, no repetir a ciegas."""
    from servicios.conciliacion import buscar_bodegas_candidatas
    with Sesion() as s:
        ids_permitidos = _ids_permitidos_para_buscar(s, u)
        candidatas = buscar_bodegas_candidatas(s, a.bodega, ids_permitidos)
        if len(candidatas) == 1:
            b = candidatas[0]
            return {"encontrada": True, "bodega": b.nombre_oficial, "bodega_id": b.id,
                    "opciones": []}
        opciones = [{"bodega": c.nombre_oficial, "bodega_id": c.id} for c in candidatas[:6]]
        return {"encontrada": False, "bodega": None, "bodega_id": None, "opciones": opciones}


@app.post("/api/bodegas/abrir")
async def abrir(a: AbrirIn, u: Usuario = Depends(usuario_actual)):
    from servicios.conciliacion import buscar_bodega
    with Sesion() as s:
        # buscar_bodega() (misma funcion que usa el agente conversacional):
        # quita tildes y puntuación de sobra (el reconocimiento de voz a
        # veces cierra la frase con un "." que nadie dijo) y prioriza la
        # coincidencia exacta - sin esto, "Zoológico" podía no encontrarse
        # por el punto final, o abrir "ZOOLOGICO SUMINISTROS" en vez de la
        # bodega "ZOOLOGICO" que de verdad se pidió. Restringida a lo
        # asignado si es auxiliar: no debe ni encontrar, ni ofrecer,
        # bodegas de otra zona que igual no podría abrir.
        b = buscar_bodega(s, a.bodega, _ids_permitidos_para_buscar(s, u))
        if b is None:
            raise HTTPException(404, "No encuentro esa bodega.")
        if u.perfil == "auxiliar" and not s.query(AsignacionBodega).filter_by(
                usuario_id=u.id, bodega_id=b.id).first():
            raise HTTPException(403, "Esa bodega no esta asignada a usted.")
        abierta = s.query(SesionConteo).filter_by(bodega_id=b.id, tipo="conteo",
                                                 estado="abierta").first()
        if abierta and abierta.usuario_id != u.id:
            raise HTTPException(409, "Esa bodega ya esta en conteo por otra persona.")
        ses = abierta or SesionConteo(bodega_id=b.id, usuario_id=u.id)
        if not abierta:
            s.add(ses)
            b.estado = "en_conteo"
            s.commit()
            s.refresh(ses)
        refs = s.query(StockSistema).filter_by(bodega_id=b.id).count()
        sid, nombre, bid = ses.id, b.nombre_oficial, b.id
    ESTADOS.setdefault(sid, {}).update(
        {"bodega_id": bid, "bodega_nombre": nombre, "sesion_bd": sid})
    registrar(u, "APERTURA", f"{nombre} abierta - sesion bloqueada")
    await difundir_estado()
    return {"sesion_id": sid, "bodega": nombre, "referencias": refs, "bodega_id": bid}


class CrearBodegaIn(BaseModel):
    nombre: str


@app.post("/api/bodegas/crear-pendiente")
def crear_bodega_pendiente(p: CrearBodegaIn, u: Usuario = Depends(usuario_actual)):
    """La bodega no se crea de una para un auxiliar: queda pendiente de
    aprobacion del administrador (Aprobacion tipo "bodega", ya soportada
    en aprobar()/rechazar()) - asi el catalogo no crece con lo que
    cualquiera escriba sin control. Un administrador ya tiene esa
    autoridad, asi que para el la bodega se crea de inmediato - de lo
    contrario terminaria aprobando su propia solicitud, lo cual no
    verifica nada (visto en produccion: Diana pidio "ALIMENTOS" y quedo
    esperando su propia firma en su propia bandeja)."""
    nombre = _limpiar_nombre_dictado(p.nombre).upper()
    if not nombre:
        raise HTTPException(400, "Dígame el nombre de la bodega.")
    with Sesion() as s:
        if s.query(Bodega).filter_by(nombre_oficial=nombre).first():
            raise HTTPException(409, "Ya existe una bodega con ese nombre.")
        if u.perfil == "auditor":
            s.add(Bodega(nombre_oficial=nombre, estado="pendiente"))
            s.commit()
            registrar(u, "CREACION", f"Bodega {nombre} creada")
            return {"ok": True,
                    "respuesta_hablada": f"{nombre.capitalize()} creada. Ya está en el catálogo."}
        s.add(Aprobacion(tipo="bodega", nombre=nombre, creado_por_id=u.id))
        s.commit()
    registrar(u, "CREACION", f"Bodega {nombre} solicitada, pendiente de aprobacion")
    return {"ok": True,
            "respuesta_hablada": f"Solicitud de {nombre.lower()} enviada. Queda "
                                 "pendiente de aprobación del administrador."}


def _ultima_sesion(s, bodega_id: int, tipo: str):
    return (s.query(SesionConteo).filter_by(bodega_id=bodega_id, tipo=tipo)
            .order_by(SesionConteo.id.desc()).first())


def _requiere_acceso_bodega(s, u: Usuario, bodega_id: int):
    """El tablero (listar_bodegas) ya oculta las bodegas ajenas a un
    auxiliar, pero eso no basta: sin este chequeo, pedir el detalle,
    las firmas o el inventario completo por su bodega_id directamente
    (sin pasar por el tablero) dejaba ver auditoria y stock de cualquier
    zona con solo cambiar el numero en la URL."""
    if u.perfil == "auxiliar" and not s.query(AsignacionBodega).filter_by(
            usuario_id=u.id, bodega_id=bodega_id).first():
        raise HTTPException(403, "Esa bodega no esta asignada a usted.")


def _ids_permitidos_para_buscar(s, u: Usuario) -> set[int] | None:
    """Para restringir buscar_bodega()/buscar_bodegas_candidatas() a lo
    que un auxiliar de verdad puede abrir - sin esto, decir "restaurante"
    ofrecia como opciones bodegas de zonas ajenas que ni siquiera podia
    llegar a abrir, puro ruido (y un nombre que no tenia por qué ver).
    None para un auditor: puede buscar en todo el catálogo."""
    if u.perfil != "auxiliar":
        return None
    return {a.bodega_id for a in
           s.query(AsignacionBodega).filter_by(usuario_id=u.id).all()}


@app.get("/api/bodegas/{bodega_id}/firmas")
def ver_firmas(bodega_id: int, u: Usuario = Depends(usuario_actual)):
    with Sesion() as s:
        _requiere_acceso_bodega(s, u, bodega_id)
        b = s.get(Bodega, bodega_id)
        conteo = _ultima_sesion(s, bodega_id, "conteo")
        auditoria = _ultima_sesion(s, bodega_id, "auditoria")

        def _lado(ses):
            if ses is None:
                return None
            au = s.get(Usuario, ses.usuario_id)
            return {"sesion_id": ses.id, "persona": au.nombre if au else "?",
                    "firmada": bool(ses.firmada),
                    "hora": ses.fin.strftime("%H:%M") if ses.fin else None}

        referencias = s.query(StockSistema).filter_by(bodega_id=bodega_id).count()
        alertas_resueltas = (s.query(Alerta).join(Conteo, Alerta.conteo_id == Conteo.id)
                            .join(SesionConteo, Conteo.sesion_id == SesionConteo.id)
                            .filter(SesionConteo.bodega_id == bodega_id,
                                    Alerta.resuelta == 1).count())
        return {"bodega": b.nombre_oficial if b else None, "referencias": referencias,
                "alertas_resueltas": alertas_resueltas,
                "conteo": _lado(conteo), "auditoria": _lado(auditoria),
                "lista_para_cerrar": bool(conteo and conteo.firmada
                                          and auditoria and auditoria.firmada)}


@app.post("/api/sesiones/{sesion_id}/firmar")
def firmar_sesion(sesion_id: int, u: Usuario = Depends(usuario_actual)):
    """El auxiliar firma su conteo; el administrador firma su recuento ciego."""
    with Sesion() as s:
        ses = s.get(SesionConteo, sesion_id)
        if ses is None:
            raise HTTPException(404, "Sesion no encontrada.")
        if ses.usuario_id != u.id and u.perfil != "auditor":
            raise HTTPException(403, "Solo quien contó puede firmar este conteo.")
        ses.firmada = 1
        ses.fin = ahora()
        b = s.get(Bodega, ses.bodega_id)
        if ses.tipo == "conteo" and b and b.estado == "en_conteo":
            b.estado = "en_auditoria"
        s.commit()
        nombre = b.nombre_oficial if b else "?"
        tipo = ses.tipo
    etiqueta = "Conteo" if tipo == "conteo" else "Auditoria"
    registrar(u, "FIRMA", f"{etiqueta} firmado - {nombre}", "ok")
    return {"ok": True}


@app.post("/api/bodegas/{bodega_id}/auditoria/iniciar")
async def iniciar_auditoria(bodega_id: int, u: Usuario = Depends(requiere_perfil("auditor"))):
    with Sesion() as s:
        b = s.get(Bodega, bodega_id)
        if b is None:
            raise HTTPException(404, "Bodega no encontrada.")
        existente = s.query(SesionConteo).filter_by(
            bodega_id=bodega_id, tipo="auditoria", estado="abierta").first()
        ses = existente or SesionConteo(bodega_id=bodega_id, usuario_id=u.id, tipo="auditoria")
        if not existente:
            s.add(ses)
            s.commit()
            s.refresh(ses)
        refs = s.query(StockSistema).filter_by(bodega_id=bodega_id).count()
        sid, nombre = ses.id, b.nombre_oficial
    ESTADOS.setdefault(sid, {}).update({"bodega_id": bodega_id, "bodega_nombre": nombre})
    registrar(u, "AUDITORIA", f"Recuento ciego iniciado en {nombre}")
    await difundir_estado()
    return {"sesion_id": sid, "bodega": nombre, "referencias": refs}


@app.get("/api/bodegas/{bodega_id}/auditoria/comparar")
def comparar_auditoria(bodega_id: int, u: Usuario = Depends(requiere_perfil("auditor"))):
    with Sesion() as s:
        b = s.get(Bodega, bodega_id)
        ses_conteo = _ultima_sesion(s, bodega_id, "conteo")
        ses_audit = _ultima_sesion(s, bodega_id, "auditoria")

        def _mapa(ses):
            m = {}
            if not ses:
                return m
            for c in (s.query(Conteo).filter_by(sesion_id=ses.id, estado="confirmado")
                      .order_by(Conteo.id).all()):
                m[c.articulo_codigo] = c.cantidad
            return m
        m1, m2 = _mapa(ses_conteo), _mapa(ses_audit)
        codigos = set(m1) | set(m2)
        filas = []
        diagnosticos = []
        for cod in codigos:
            art = s.get(Articulo, cod)
            nombre = art.nombre_oficial if art else cod
            st = s.query(StockSistema).filter_by(articulo_codigo=cod, bodega_id=bodega_id).first()
            sistema = st.cantidad_sd if st else 0
            c1, c2 = m1.get(cod), m2.get(cod)
            autoridad = c2 if c2 is not None else c1
            dif = round((autoridad or 0) - sistema, 3)
            if abs(dif) < 0.01 and (c1 == c2 or c2 is None):
                continue
            filas.append({"codigo": cod, "articulo": nombre,
                          "conteo1": c1, "conteo2": c2, "sistema": sistema,
                          "diferencia": dif,
                          "accion": "Revisar" if (c1 is not None and c2 is not None and c1 != c2)
                                    else "Aceptar"})
            # el sistema ya traia un saldo negativo antes de esta toma (una
            # salida sin su entrada correspondiente): no es un error del
            # conteo fisico, es un dato roto que My Inventory debe corregir.
            if sistema < 0:
                diagnosticos.append(
                    f"El {dif:+g} de {nombre.lower()} no viene de su conteo: el sistema "
                    f"ya traía saldo negativo ({sistema:g}, salida registrada sin entrada). "
                    "Su conteo físico es el que vale; el reporte lo marca como negativo "
                    "del sistema para corrección en My Inventory.")
    filas.sort(key=lambda f: -abs(f["diferencia"]))
    return {"bodega": b.nombre_oficial if b else None,
            "filas": filas, "coinciden": len(codigos) - len(filas) if codigos else 0,
            "total": len(codigos), "diagnosticos": diagnosticos}


@app.post("/api/bodegas/{bodega_id}/auditoria/firmar")
def firmar_auditoria(bodega_id: int, u: Usuario = Depends(requiere_perfil("auditor"))):
    with Sesion() as s:
        ses = _ultima_sesion(s, bodega_id, "auditoria")
        if ses is None:
            raise HTTPException(404, "No hay un recuento de auditoria iniciado.")
        ses.firmada = 1
        ses.fin = ahora()
        s.commit()
        b = s.get(Bodega, bodega_id)
        nombre = b.nombre_oficial if b else "?"
    registrar(u, "FIRMA", f"Auditoria firmada - {nombre}", "ok")
    return {"ok": True}


@app.post("/api/bodegas/{bodega_id}/cerrar")
async def cerrar(bodega_id: int, u: Usuario = Depends(requiere_perfil("auditor"))):
    with Sesion() as s:
        b = s.get(Bodega, bodega_id)
        if b is None:
            raise HTTPException(404, "Bodega no encontrada.")
        ses_conteo = _ultima_sesion(s, bodega_id, "conteo")
        ses_audit = _ultima_sesion(s, bodega_id, "auditoria")
        if not (ses_conteo and ses_conteo.firmada and ses_audit and ses_audit.firmada):
            raise HTTPException(409, "Faltan firmas: el conteo y la auditoría deben "
                                     "estar firmados antes de cerrar.")
        conteos = (s.query(Conteo).filter_by(sesion_id=ses_conteo.id, estado="confirmado").all())
        difs = 0
        for c in conteos:
            st = s.query(StockSistema).filter_by(
                articulo_codigo=c.articulo_codigo, bodega_id=bodega_id).first()
            if abs((c.cantidad or 0) - (st.cantidad_sd if st else 0)) > 0.001:
                difs += 1
        exact = round((len(conteos) - difs) / len(conteos) * 100, 1) if conteos else 100.0
        b.estado = "cerrada"
        for ses in s.query(SesionConteo).filter_by(bodega_id=bodega_id,
                                                   estado="abierta").all():
            ses.estado = "cerrada"
            if not ses.fin:
                ses.fin = ahora()
        s.add(HistorialCierre(bodega_id=bodega_id, exactitud=exact,
                              referencias=len(conteos), diferencias=difs))
        s.commit()
        nombre = b.nombre_oficial
    registrar(u, "CIERRE", f"{nombre} cerrada con doble firma", "ok")
    await difundir_estado()
    return {"ok": True, "bodega": nombre}


@app.post("/api/bodegas/{bodega_id}/reabrir")
async def reabrir_bodega(bodega_id: int, body: dict,
                         u: Usuario = Depends(requiere_perfil("auditor"))):
    motivo = (body.get("motivo") or "").strip()
    if not motivo:
        raise HTTPException(400, "Reabrir una bodega cerrada exige una justificación escrita.")
    with Sesion() as s:
        b = s.get(Bodega, bodega_id)
        if b is None:
            raise HTTPException(404, "Bodega no encontrada.")
        if b.estado != "cerrada":
            raise HTTPException(409, "Solo se reabre una bodega que esté cerrada.")
        # las sesiones firmadas quedan como historial (nada se borra), pero
        # se marcan como reemplazadas para que abrir() arme una ronda de
        # conteo realmente nueva: reabrir sin esto no devolvia nada util al
        # auxiliar, porque "abrir" seguia encontrando su sesion ya firmada.
        for ses in s.query(SesionConteo).filter_by(bodega_id=bodega_id, estado="abierta").all():
            ses.estado = "reemplazada"
        b.estado = "en_conteo"
        s.commit()
        nombre = b.nombre_oficial
    registrar(u, "REAPERTURA", f"{nombre} reabierta - motivo: {motivo}", "alerta")
    await difundir_estado()
    return {"ok": True, "bodega": nombre}


def _narrar_hito(t):
    p = (t.persona or "alguien").title()
    if t.accion == "APERTURA":
        return f"{p} abre la bodega"
    if t.accion == "AUDITORIA":
        return f"{p} inicia el reconteo ciego"
    if t.accion == "CORRECCION":
        return "Alerta: " + t.detalle.split(" (valor anterior")[0]
    if t.accion == "FIRMA" and "Conteo firmado" in t.detalle:
        return f"{p} cierra el conteo"
    if t.accion == "FIRMA" and "Auditoria firmada" in t.detalle:
        return f"{p} firma el reconteo"
    if t.accion == "CIERRE":
        return "Cierre con doble firma"
    if t.accion == "REAPERTURA":
        return f"{p}: {t.detalle}"
    return t.detalle


def _color_hito(t):
    if t.accion == "CIERRE":
        return "verde"
    if t.accion in ("CORRECCION", "REAPERTURA"):
        return "oro"
    return "azul"


@app.get("/api/bodegas/{bodega_id}/detalle")
def detalle_bodega(bodega_id: int, u: Usuario = Depends(usuario_actual)):
    with Sesion() as s:
        _requiere_acceso_bodega(s, u, bodega_id)
        b = s.get(Bodega, bodega_id)
        if b is None:
            raise HTTPException(404, "Bodega no encontrada.")
        total = s.query(StockSistema).filter_by(bodega_id=bodega_id).count()
        # solo la ronda de conteo mas reciente: tras un reabrir(), la sesion
        # anterior queda como historial y no debe mezclarse con el recuento
        # nuevo en la exactitud/diferencias que se muestran aqui.
        ses_conteo_actual = _ultima_sesion(s, bodega_id, "conteo")
        conteos = (s.query(Conteo).filter_by(
                   sesion_id=ses_conteo_actual.id, estado="confirmado").all()
                   if ses_conteo_actual else [])
        difs = []
        for c in conteos:
            st = s.query(StockSistema).filter_by(
                articulo_codigo=c.articulo_codigo, bodega_id=bodega_id).first()
            esperado = st.cantidad_sd if st else 0
            if abs((c.cantidad or 0) - esperado) > 0.001:
                a = s.get(Articulo, c.articulo_codigo)
                difs.append({"articulo": a.nombre_oficial if a else c.articulo_codigo,
                             "contado": c.cantidad, "sistema": esperado,
                             "diferencia": round(c.cantidad - esperado, 3)})

        sesiones = s.query(SesionConteo).filter_by(bodega_id=bodega_id).all()
        usuario_ids = {ses.usuario_id for ses in sesiones if ses.usuario_id}
        personas_nombres = []
        for uid in usuario_ids:
            us = s.get(Usuario, uid)
            if us and us.nombre.title() not in personas_nombres:
                personas_nombres.append(us.nombre.title())
        if len(personas_nombres) <= 1:
            personas = personas_nombres[0] if personas_nombres else None
        else:
            personas = ", ".join(personas_nombres[:-1]) + " y " + personas_nombres[-1]

        # hitos: los que ya mencionan la bodega por nombre (apertura/cierre/etc)
        # mas las correcciones de la persona en el rango de su sesion (esas
        # no mencionan la bodega, solo el articulo).
        hitos_t = list(s.query(Traza).filter(
            Traza.detalle.contains(b.nombre_oficial)).all())
        # el nombre de una bodega puede ser substring del de otra (ej.
        # "ZOOLOGICO" de "ZOOLOGICO SUMINISTROS" y "ZOOLOGICO PISCILAGO";
        # tambien "MOVIL FONDA", "MOVIL MIRADOR", "PANADERIA" con su propia
        # "... SUMINISTROS") - confirmado en produccion: abrir "ZOOLOGICO
        # SUMINISTROS" hacia aparecer ese evento en la linea de tiempo de
        # "ZOOLOGICO" a secas, una bodega distinta que ni se habia tocado.
        # Cuando el texto contiene el nombre de mas de una bodega real, se
        # prefiere siempre el mas largo (el mas especifico) como dueño real
        # del evento.
        if hitos_t:
            _todos_nombres = [x.nombre_oficial for x in s.query(Bodega).all()]
            def _es_de_esta_bodega(detalle):
                candidatos = [n for n in _todos_nombres if n in detalle]
                return not candidatos or max(candidatos, key=len) == b.nombre_oficial
            hitos_t = [t for t in hitos_t if _es_de_esta_bodega(t.detalle)]
        vistos = {t.id for t in hitos_t}
        for ses in sesiones:
            if not ses.usuario_id:
                continue
            fin = ses.fin or ahora()
            correcciones = (s.query(Traza)
                           .filter(Traza.accion == "CORRECCION",
                                   Traza.usuario_id == ses.usuario_id,
                                   Traza.creado >= ses.inicio, Traza.creado <= fin)
                           .all())
            for t in correcciones:
                if t.id not in vistos:
                    hitos_t.append(t)
                    vistos.add(t.id)
        hitos_t.sort(key=lambda t: t.creado)
        hitos = [{"hora": t.creado.strftime("%H:%M"), "texto": _narrar_hito(t),
                  "tipo": _color_hito(t)} for t in hitos_t]

        alertas_resueltas = (s.query(Alerta).join(Conteo, Alerta.conteo_id == Conteo.id)
                            .join(SesionConteo, Conteo.sesion_id == SesionConteo.id)
                            .filter(SesionConteo.bodega_id == bodega_id,
                                    Alerta.resuelta == 1).count())

        exact = round((len(conteos) - len(difs)) / len(conteos) * 100, 1) if conteos else 0
        duracion_min = None
        if ses_conteo_actual and ses_conteo_actual.fin:
            duracion_min = round((ses_conteo_actual.fin - ses_conteo_actual.inicio).total_seconds() / 60)
        # referencia fija de un conteo manual en papel (no hay dato real de
        # esto: es un supuesto declarado, no una medicion de Colsubsidio)
        tiempo_papel_min = round(total * 20 / 60) if total else None

        unidades_stock = sum(f.cantidad_sd or 0 for f in
                             s.query(StockSistema).filter_by(bodega_id=bodega_id).all())

        cierre_t = next((t for t in reversed(hitos_t) if t.accion == "CIERRE"), None)
        hora_cierre = cierre_t.creado.strftime("%H:%M") if cierre_t else None

        ses_auditoria = next((ses for ses in sesiones if ses.tipo == "auditoria"), None)
        revisor = None
        if ses_auditoria and ses_auditoria.usuario_id:
            us = s.get(Usuario, ses_auditoria.usuario_id)
            revisor = us.nombre.title() if us else None

        historial = (s.query(HistorialCierre).filter_by(bodega_id=bodega_id)
                    .order_by(HistorialCierre.fecha.desc()).all())
        anterior = historial[1] if len(historial) > 1 else None
        return {"bodega": b.nombre_oficial, "estado": b.estado,
                "referencias": total, "contadas": len(conteos),
                "exactitud": f"{exact} %", "diferencias": difs, "hitos": hitos,
                "duracion_min": duracion_min, "tiempo_papel_min": tiempo_papel_min,
                "unidades_stock": round(unidades_stock, 1),
                "personas": personas, "alertas_resueltas": alertas_resueltas,
                "hora_cierre": hora_cierre, "revisor": revisor,
                "ultima_toma_anterior": ({"fecha": anterior.fecha.strftime("%Y-%m-%d"),
                                          "exactitud": anterior.exactitud}
                                         if anterior else None)}


@app.get("/api/bodegas/{bodega_id}/articulos")
def articulos_bodega(bodega_id: int, u: Usuario = Depends(usuario_actual)):
    """El extracto completo de My Inventory para esta bodega, tal cual
    quedo cargado del Excel: codigo, articulo, unidad y saldo del sistema."""
    with Sesion() as s:
        _requiere_acceso_bodega(s, u, bodega_id)
        b = s.get(Bodega, bodega_id)
        if b is None:
            raise HTTPException(404, "Bodega no encontrada.")
        filas = (s.query(StockSistema, Articulo)
                .join(Articulo, Articulo.codigo == StockSistema.articulo_codigo)
                .filter(StockSistema.bodega_id == bodega_id)
                .order_by(Articulo.nombre_oficial).all())
        return [{"codigo": a.codigo, "articulo": a.nombre_oficial,
                 "unidad": a.unidad_medida, "sd": st.cantidad_sd}
                for st, a in filas]


# ─────────────────────── consultas y reportes ───────────────────────
@app.get("/api/articulos/catalogo-ligero")
def catalogo_ligero(u: Usuario = Depends(usuario_actual)):
    """El catálogo completo pero liviano (solo codigo/nombre/unidad), para
    que el modo sin conexión pueda sugerir nombres oficiales guardandolo
    en el equipo mientras hay señal."""
    with Sesion() as s:
        return [{"codigo": a.codigo, "nombre": a.nombre_oficial, "unidad": a.unidad_medida}
                for a in s.query(Articulo).all()]


@app.get("/api/articulos/consulta")
def consulta_articulo(q: str, codigo: str = "", u: Usuario = Depends(usuario_actual)):
    from servicios.conciliacion import buscar_articulo, buscar_bodegas_candidatas
    # Una orden explícita ("abra kiosco taquilla ayb") se resuelve ANTES
    # que cualquier otra cosa: si se dejara caer primero por la búsqueda
    # de artículo/bodega, el propio "abra" sumaba como palabra de más en
    # la coincidencia por palabras contra esa misma bodega y la orden
    # explícita nunca llegaba a reconocerse como tal - terminaba en la
    # sugerencia de "vea su detalle", no en abrirla de una vez.
    if _VERBOS_ABRIR_BODEGA.search(q):
        r = _resolver_asistente("bodegas", q, u)
        return {
            "resumen": r.get("respuesta_hablada", ""),
            "bodegas": [], "sugerencia_bodega": None, "sugerencia_bodega_id": None,
            "accion": r.get("accion"), "destino": r.get("destino"),
            "pestana": r.get("pestana"), "bodega": r.get("bodega"),
        }
    cand_todos = buscar_articulo(q)
    # Este buscador acepta CUALQUIER frase (nombre de ingrediente, de
    # bodega, una pregunta, una orden) - no solo un nombre de artículo
    # dictado a propósito, como sí es el caso en Conteo/Pedido (donde
    # este mismo umbral global de 45 sigue igual, sin tocar). Con ese
    # umbral más flojo aquí, frases sueltas sin relación con ningún
    # producto ("seguir contando", "no entendí", "espera") coincidían
    # por casualidad con productos reales que comparten una raíz de 4
    # letras (SEGUir/SEGUndos, ENTEndí/ENTEro...) - una coincidencia
    # LEGÍTIMA en el sentido estructural (la misma que hace que BLANCA
    # encuentre BLANCO), pero sin ninguna relación real de significado.
    # Probado contra el catálogo real: una búsqueda de artículo genuina,
    # hasta parcial o descuidada ("tomate", "vino", "tabla picar"),
    # siempre puntuó 84 o más; el ruido de frases sueltas se quedó entre
    # 45 y 80. 82 separa limpio los dos grupos.
    UMBRAL_CONFIANZA_BODEGAS = 82
    # ya eligió una alternativa específica (clic en un chip de "¿era este
    # otro?") - se respeta tal cual, sin el filtro extra: ahí la persona
    # ya confirmó cuál quería, así que la confianza original no importa.
    cand = cand_todos if codigo else [c for c in cand_todos if c["confianza"] >= UMBRAL_CONFIANZA_BODEGAS]
    if not cand:
        # lo dicho no es ningun articulo del catalogo - pero si SI es el
        # nombre de una bodega (p. ej. alguien dice "restaurante" en este
        # buscador de ingredientes por error, cuando quería ir a Conteo a
        # abrirla), vale la pena decirlo en vez de un "no encontre" a
        # secas que deja a la persona sin saber por que. "restaurante" a
        # secas encaja en mas de una bodega real - ahi no hay una sola
        # que prellenar, pero igual vale la pena decir que existen y
        # mandar a Conteo a terminar de decir cual.
        with Sesion() as s:
            ids_permitidos = _ids_permitidos_para_buscar(s, u)
            candidatas = buscar_bodegas_candidatas(s, q, ids_permitidos)
            if ids_permitidos is not None:
                # buscar_bodegas_candidatas() no restringe una coincidencia
                # EXACTA (para que /abrir pueda decir "existe pero no es
                # suya" en vez de "no existe") - aqui, en cambio, esto es
                # solo una sugerencia informativa sin ese motivo: no hay
                # por qué nombrarle a un auxiliar una bodega ajena.
                candidatas = [c for c in candidatas if c.id in ids_permitidos]
        if len(candidatas) == 1:
            b = candidatas[0]
            return {
                "resumen": (f"No encuentro ese artículo, pero {b.nombre_oficial.title()} "
                            "sí es una bodega - vea su detalle para abrirla."),
                "bodegas": [], "sugerencia_bodega": b.nombre_oficial,
                "sugerencia_bodega_id": b.id,
            }
        if candidatas:
            nombres = ", ".join(c.nombre_oficial.title() for c in candidatas[:4])
            return {
                "resumen": (f"No encuentro ese artículo. Ese nombre coincide con varias "
                            f"bodegas ({nombres}) - búsquelas en Bodegas para ver cuál es."),
                "bodegas": [], "sugerencia_bodega": None, "sugerencia_bodega_id": None,
            }
        # Ni artículo ni bodega: puede ser una pregunta suelta ("¿cuántas
        # bodegas están pendientes?") o una orden de navegar ("llévame a
        # reportes") - un solo buscador para todo, en vez de dos cuadros
        # de búsqueda separados (uno para ingredientes, otro para
        # cualquier otra cosa) que además terminaban dando respuestas
        # distintas para lo mismo.
        r = _resolver_asistente("bodegas", q, u)
        return {
            "resumen": r.get("respuesta_hablada", ""),
            "bodegas": [], "sugerencia_bodega": None, "sugerencia_bodega_id": None,
            "accion": r.get("accion"), "destino": r.get("destino"),
            "pestana": r.get("pestana"), "bodega": r.get("bodega"),
        }
    # si la persona ya eligio una de las alternativas, usa esa; si no, la mejor
    a = next((c for c in cand if c["codigo"] == codigo), None) or cand[0]
    hoy = ahora().date()
    with Sesion() as s:
        filas = s.query(StockSistema).filter_by(articulo_codigo=a["codigo"]).all()
        total = sum(f.cantidad_sd or 0 for f in filas)
        det = []
        for f in filas:
            b = s.get(Bodega, f.bodega_id)
            ultima = (s.query(Conteo).join(SesionConteo)
                     .filter(SesionConteo.bodega_id == f.bodega_id,
                             Conteo.articulo_codigo == a["codigo"],
                             Conteo.estado == "confirmado")
                     .order_by(Conteo.id.desc()).first())
            if ultima:
                ultima_toma = (f"hoy {ultima.creado.strftime('%H:%M')}"
                               if ultima.creado.date() == hoy
                               else ultima.creado.strftime("%d %b").lower())
            elif b and b.estado == "en_conteo":
                ultima_toma = "en conteo"
            else:
                ultima_toma = "sin toma"
            det.append({"bodega": b.nombre_oficial if b else "?",
                        "cantidad": f.cantidad_sd, "estado": b.estado if b else "?",
                        "ultima_toma": ultima_toma})
        # consumo real del ultimo mes, sobre servicios ya legalizados
        hace_30 = ahora() - timedelta(days=30)
        lineas_mes = (s.query(LineaServicio)
                     .filter(LineaServicio.articulo_codigo == a["codigo"],
                             LineaServicio.estado == "legalizado",
                             LineaServicio.creado >= hace_30).all())
        consumo_mes = sum(l.usado or 0 for l in lineas_mes)
        servicios_mes = len(lineas_mes)
    cobertura_dias = round(total / (consumo_mes / 30)) if consumo_mes > 0 and total > 0 else None
    # otros articulos parecidos y CERCANOS en puntaje: un top score alto no
    # basta si el segundo esta empatado o casi (ARROZ y ARROZ BASMATI
    # empatan al 100 cuando solo se dice "arroz"); ahi es donde se confunde
    # el producto sin que la persona se de cuenta.
    alternativas = [c for c in cand if c["codigo"] != a["codigo"]
                    and (a["confianza"] - c["confianza"]) < 15][:2]
    ambiguo = bool(alternativas)
    resumen = f"{a['nombre']}: {total:g} {a['unidad']} en {len(filas)} bodegas."
    if ambiguo:
        resumen += (f" Encontré artículos parecidos ({', '.join(c['nombre'] for c in alternativas)}); "
                    "confirme cuál necesita si no es este.")
    return {"articulo": a["nombre"], "codigo": a["codigo"], "unidad": a["unidad"],
            "total": total, "bodegas": det, "resumen": resumen,
            "ambiguo": ambiguo, "alternativas": alternativas,
            "consumo_mes": round(consumo_mes, 2), "servicios_mes": servicios_mes,
            "cobertura_dias": cobertura_dias}


@app.get("/api/articulos/{codigo}/movimientos")
def movimientos_articulo(codigo: str, u: Usuario = Depends(usuario_actual)):
    """«Ver movimientos»: los ultimos conteos confirmados de este articulo,
    en cualquier bodega, con quien y cuando."""
    with Sesion() as s:
        conteos = (s.query(Conteo).filter_by(articulo_codigo=codigo, estado="confirmado")
                  .order_by(Conteo.id.desc()).limit(20).all())
        salida = []
        for c in conteos:
            ses = s.get(SesionConteo, c.sesion_id)
            b = s.get(Bodega, ses.bodega_id) if ses else None
            persona = s.get(Usuario, ses.usuario_id) if ses else None
            salida.append({"hora": c.creado.strftime("%Y-%m-%d %H:%M"),
                           "bodega": b.nombre_oficial if b else "?",
                           "persona": persona.nombre if persona else "?",
                           "cantidad": c.cantidad, "unidad": c.unidad})
    return salida


@app.get("/api/articulos/{codigo}/en-recetas")
def articulo_en_recetas(codigo: str, u: Usuario = Depends(usuario_actual)):
    """«Comparar con la receta»: en que recetas aparece este articulo y
    cuanto pide por porcion."""
    with Sesion() as s:
        ings = s.query(RecetaIngrediente).filter_by(articulo_codigo=codigo).all()
        salida = []
        for ing in ings:
            r = s.get(Receta, ing.receta_id)
            if r:
                salida.append({"receta": r.nombre, "por_porcion": ing.cantidad_por_porcion,
                               "rendimiento": r.rendimiento})
    return salida


@app.post("/api/reportes")
def reporte(formato: str = "xlsx", u: Usuario = Depends(requiere_perfil("auditor"))):
    ruta, filas, vista_previa = reportes.consolidado(formato)
    registrar(u, "REPORTE", f"Consolidado generado: {ruta} ({filas} filas)")
    return {"archivo": ruta, "filas": filas, "vista_previa": vista_previa}


@app.post("/api/reportes/diferencias")
def reporte_diferencias(formato: str = "xlsx", u: Usuario = Depends(requiere_perfil("auditor"))):
    ruta, filas, bodegas_con_descuadre = reportes.diferencias_archivo(formato)
    registrar(u, "REPORTE",
             f"Diferencias por bodega exportado: {ruta} ({filas} filas, "
             f"{bodegas_con_descuadre} bodegas)")
    return {"archivo": ruta, "filas": filas, "bodegas_con_descuadre": bodegas_con_descuadre}


@app.post("/api/bodegas/exportar-estado")
def exportar_estado_bodegas(formato: str = "xlsx", u: Usuario = Depends(requiere_perfil("auditor"))):
    ruta = reportes.estado_bodegas(formato)
    registrar(u, "REPORTE", f"Estado de bodegas exportado: {ruta}")
    return {"archivo": ruta}


def _parsear_archivo_reporte(t):
    """Convierte una traza cruda de tipo REPORTE en la tarjeta de archivo
    que muestra Reportes.jsx - sin esto, cada archivo generado se perdia
    en cuanto se salia de la pantalla (no habia historial real)."""
    d = t.detalle
    if ": " not in d or "reportes/" not in d:
        return None
    _, resto = d.split(": ", 1)
    archivo = resto.split(" (")[0].strip()
    filas = None
    if "(" in resto and "filas" in resto:
        try:
            filas = int(resto.split("(")[1].split(" filas")[0])
        except (ValueError, IndexError):
            filas = None
    if d.startswith("Consolidado generado"):
        titulo, subtitulo = "Consolidado para My Inventory", "Listo para carga"
    elif d.startswith("Diferencias por bodega"):
        titulo = "Diferencias por bodega"
        bodegas_txt = resto.split(", ")[-1].replace(" bodegas)", "").strip() if "bodegas" in resto else None
        subtitulo = f"{bodegas_txt} bodegas con descuadre" if bodegas_txt else "Exportado"
    elif d.startswith("Estado de bodegas"):
        titulo, subtitulo = "Estado del tablero", "Exportado"
    elif d.startswith("Detalle de bodega"):
        # el nombre de la bodega (no solo "Detalle de bodega" a secas) va
        # en la clave de deduplicacion mas abajo: sin esto, exportar el
        # detalle de una bodega distinta hacia desaparecer de "recientes"
        # el de la anterior, como si nunca se hubiera generado.
        titulo = "Detalle de bodega"
        nombre_bodega = d.split("Detalle de bodega ", 1)[1].split(" exportado:")[0].strip()
        subtitulo = nombre_bodega.title() if nombre_bodega else "Exportado"
    elif d.startswith("Analisis de consumo"):
        titulo, subtitulo = "Análisis de consumo", "Exportado"
    elif d.startswith("Registro de trazabilidad"):
        titulo, subtitulo = "Registro de trazabilidad", "Exportado"
    else:
        titulo, subtitulo = "Reporte", "Exportado"
    # clave de deduplicacion: para casi todos los tipos es el titulo (solo
    # importa el mas reciente); "Detalle de bodega" es la excepcion, porque
    # el mismo titulo generico cubre un archivo distinto por cada bodega.
    clave = f"{titulo}::{subtitulo}" if titulo == "Detalle de bodega" else titulo
    return {"titulo": titulo, "subtitulo": subtitulo, "archivo": archivo, "filas": filas,
            "formato": archivo.rsplit(".", 1)[-1].upper() if "." in archivo else "?",
            "hora": t.creado.strftime("%H:%M"), "persona": (t.persona or "").title(),
            "clave": clave}


@app.get("/api/reportes/recientes")
def reportes_recientes(u: Usuario = Depends(requiere_perfil("auditor"))):
    """El historial real de archivos generados (via pantalla o por voz),
    leido de la trazabilidad - para que la lista sobreviva a salir de la
    pantalla o recargar, en vez de vivir solo en el estado del componente.
    Un solo archivo por tipo (el mas reciente): generar el mismo reporte
    varias veces en el dia no debe ir apilando copias viejas - lo que
    importa es el ultimo, los anteriores ya quedaron obsoletos apenas se
    genero uno nuevo del mismo tipo."""
    with Sesion() as s:
        trazas = (s.query(Traza).filter_by(accion="REPORTE")
                 .order_by(Traza.id.desc()).limit(40).all())
    vistos = set()
    salida = []
    for t in trazas:
        x = _parsear_archivo_reporte(t)
        if not x or x["clave"] in vistos:
            continue
        vistos.add(x["clave"])
        salida.append(x)
    return salida[:10]


@app.post("/api/bodegas/{bodega_id}/exportar-detalle")
def exportar_detalle_bodega(bodega_id: int, formato: str = "xlsx",
                            u: Usuario = Depends(requiere_perfil("auditor"))):
    ruta = reportes.detalle_bodega(bodega_id, formato)
    with Sesion() as s:
        b = s.get(Bodega, bodega_id)
        nombre_bodega = b.nombre_oficial if b else str(bodega_id)
    # el nombre (no solo el id) queda en el propio mensaje para que
    # _parsear_archivo_reporte pueda mostrar de cual bodega es la tarjeta,
    # y distinguir el archivo de esta bodega del de otra en "recientes".
    registrar(u, "REPORTE", f"Detalle de bodega {nombre_bodega} exportado: {ruta}")
    return {"archivo": ruta}


@app.get("/api/reportes/descargar")
def descargar(archivo: str, u: Usuario = Depends(requiere_perfil("auditor"))):
    if ".." in archivo or not archivo.startswith("reportes/"):
        raise HTTPException(400, "Ruta no permitida.")
    from servicios.archivos import leer_bytes
    contenido = leer_bytes(archivo)
    if contenido is None:
        raise HTTPException(404, "Archivo no encontrado.")
    tipo = "text/csv" if archivo.endswith(".csv") else (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    return Response(content=contenido, media_type=tipo, headers={
        "Content-Disposition": f'attachment; filename="{os.path.basename(archivo)}"'})


@app.get("/api/reportes/vista-previa")
def vista_previa_reporte(archivo: str, u: Usuario = Depends(requiere_perfil("auditor"))):
    """Para poder ver el contenido de cualquier archivo ya generado (no solo
    el que se acaba de crear) con solo dar clic en su tarjeta, sin tener
    que descargarlo primero. Lee el archivo tal cual quedo guardado (de la
    base, no de disco - ver servicios/archivos.py), asi que la vista previa
    de un reporte viejo muestra lo que ese reporte realmente tenia, no el
    estado actual de la base, y sigue funcionando despues de un redeploy."""
    if ".." in archivo or not archivo.startswith("reportes/"):
        raise HTTPException(400, "Ruta no permitida.")
    import io
    import pandas as pd
    from servicios.archivos import leer_bytes
    contenido = leer_bytes(archivo)
    if contenido is None:
        raise HTTPException(404, "Archivo no encontrado.")
    buf = io.BytesIO(contenido)
    df = pd.read_csv(buf) if archivo.endswith(".csv") else pd.read_excel(buf)
    df = df.fillna(0)
    return {"filas": df.head(8).to_dict("records"), "total": len(df)}


# ─────────────────────── los tres momentos ───────────────────────
class PedidoIn(BaseModel):
    plato: str
    porciones: int = Field(gt=0)
    bodega_id: int = 1


@app.post("/api/pedidos/calcular")
def api_calcular(p: PedidoIn, u: Usuario = Depends(usuario_actual)):
    return calcular_pedido(p.plato, p.porciones, p.bodega_id)


class EnviarPedidoIn(BaseModel):
    plato: str
    porciones: int = Field(gt=0)
    bodega_id: int
    servicio_id: int = 1


# protege el bloque de verificar-duplicado + insertar: sin esto, dos
# peticiones concurrentes (un reintento de red, un doble toque en la
# tableta) podian pasar juntas la verificacion de "ya_existe" antes de que
# cualquiera terminara de guardar, y las dos quedaban registradas como
# pedidos reales en vez de que la segunda se detectara como duplicada.
# Alcanza con un lock en memoria porque el servicio corre en un solo
# proceso (uvicorn sin --workers, ver render.yaml); con varios procesos
# haría falta una constraint a nivel de base de datos.
_lock_enviar_pedido = threading.Lock()


@app.post("/api/pedidos/enviar")
def api_enviar(datos: EnviarPedidoIn, u: Usuario = Depends(usuario_actual)):
    # las lineas ya no se reciben del cliente: se vuelven a calcular aqui
    # mismo contra la receta y el stock en vivo, igual que hace "Calcular
    # el pedido". Confiar en las cantidades que mandara el navegador
    # permitia pedir cualquier cosa (cualquier codigo de articulo, en
    # cualquier cantidad) para cualquier plato, incluso uno sin receta.
    calculo = calcular_pedido(datos.plato, datos.porciones, datos.bodega_id)
    if not calculo["receta_encontrada"]:
        raise HTTPException(404, f"No encontré una receta para «{datos.plato}».")
    lineas_a_pedir = [l for l in calculo["lineas"] if l["falta"] > 0]
    if not lineas_a_pedir:
        raise HTTPException(400, "No hay nada que pedir: ya tiene todo en la bodega.")

    with _lock_enviar_pedido:
        with Sesion() as s:
            # si el mismo pedido (servicio + plato + porciones) ya quedo
            # abierto o esperando aprobacion, no lo duplica: cubre un doble
            # clic, un doble disparo por voz, o un reintento tras una
            # desconexion que si alcanzo a llegar la primera vez.
            ya_existe = (s.query(LineaServicio)
                        .filter_by(servicio_id=datos.servicio_id, plato=datos.plato,
                                   porciones=datos.porciones)
                        .filter(LineaServicio.estado.in_(["abierto", "pendiente_aprobacion"]))
                        .first())
            if ya_existe:
                return {"ok": True, "duplicado": True}
            # un auxiliar pide, pero es el administrador quien de verdad autoriza
            # que salga del almacen - igual que ya pasa con productos y bodegas
            # creados en plena toma. El administrador autoriza su propio pedido
            # de una vez: no tiene sentido pedirse permiso a si mismo.
            estado_inicial = "abierto" if u.perfil == "auditor" else "pendiente_aprobacion"
            # el sufijo evita que dos pedidos distintos creados en el mismo
            # segundo (dos auxiliares pidiendo casi a la vez) terminen con
            # el mismo numero_pedido - eso los mezclaba en una sola tarjeta
            # de aprobacion en Auditoria, con los items de ambos revueltos.
            numero = f"PED-{ahora().strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(2).upper()}"
            n = 0
            items = []
            for l in lineas_a_pedir:
                s.add(LineaServicio(servicio_id=datos.servicio_id,
                                    articulo_codigo=l["codigo"],
                                    nombre=l["nombre"], pedido=l["falta"],
                                    plato=datos.plato, porciones=datos.porciones,
                                    estado=estado_inicial, bodega_id=datos.bodega_id,
                                    creado_por_id=u.id, numero_pedido=numero))
                items.append({"nombre": l["nombre"], "cantidad": l["falta"],
                             "unidad": l.get("unidad", "")})
                n += 1
            s.commit()
            b = s.get(Bodega, datos.bodega_id)
            bodega_nombre = b.nombre_oficial if b else None
    if estado_inicial == "pendiente_aprobacion":
        registrar(u, "PEDIDO", f"Pedido {numero} enviado, pendiente de aprobacion ({n} lineas)")
    else:
        registrar(u, "PEDIDO", f"Pedido {numero} enviado y aprobado ({n} lineas)")
    return {"ok": True, "numero_pedido": numero, "estado": estado_inicial,
            "hora": ahora().strftime("%H:%M"),
            "bodega": bodega_nombre, "persona": u.nombre,
            "items": items, "total_lineas": n}


@app.get("/api/pedidos/{numero_pedido}/estado")
def estado_pedido(numero_pedido: str, u: Usuario = Depends(usuario_actual)):
    """Para que quien pidió pueda enterarse si un administrador ya lo
    aprobó o rechazó, aunque haya salido de Pedidos y vuelto - la pantalla
    no se refresca sola."""
    with Sesion() as s:
        fila = s.query(LineaServicio).filter_by(numero_pedido=numero_pedido).first()
        if fila is None:
            raise HTTPException(404, "Ese pedido no existe.")
        if fila.creado_por_id != u.id and u.perfil != "auditor":
            raise HTTPException(403, "Ese pedido no es suyo.")
        return {"numero_pedido": numero_pedido, "estado": fila.estado}


@app.get("/api/pedidos/pendientes")
def pedidos_pendientes(u: Usuario = Depends(requiere_perfil("auditor"))):
    """Pedidos de auxiliares esperando la firma del administrador antes de
    contar como enviados de verdad al almacen - el pedir no se detiene
    (queda registrado de una vez), pero salir del almacen si depende de
    esta aprobacion, igual que con productos y bodegas nuevas."""
    with Sesion() as s:
        filas = (s.query(LineaServicio)
                .filter_by(estado="pendiente_aprobacion")
                .order_by(LineaServicio.creado.desc()).all())
        grupos = {}
        for f in filas:
            g = grupos.setdefault(f.numero_pedido, {
                "numero_pedido": f.numero_pedido, "plato": f.plato,
                "porciones": f.porciones, "hora": f.creado.strftime("%H:%M"),
                "bodega_id": f.bodega_id, "creado_por_id": f.creado_por_id,
                "items": [],
            })
            g["items"].append({"nombre": f.nombre, "cantidad": f.pedido})
        out = []
        for g in grupos.values():
            b = s.get(Bodega, g["bodega_id"]) if g["bodega_id"] else None
            persona = s.get(Usuario, g["creado_por_id"]) if g["creado_por_id"] else None
            out.append({**g, "bodega": b.nombre_oficial if b else None,
                       "persona": persona.nombre if persona else "—"})
        out.sort(key=lambda x: x["numero_pedido"], reverse=True)
        return out


class ResolverPedidoIn(BaseModel):
    aprobar: bool


@app.post("/api/pedidos/{numero_pedido}/resolver")
def resolver_pedido(numero_pedido: str, datos: ResolverPedidoIn,
                    u: Usuario = Depends(requiere_perfil("auditor"))):
    with Sesion() as s:
        filas = (s.query(LineaServicio)
                .filter_by(numero_pedido=numero_pedido, estado="pendiente_aprobacion").all())
        if not filas:
            raise HTTPException(404, "Pedido no encontrado o ya resuelto.")
        nuevo_estado = "abierto" if datos.aprobar else "rechazado"
        plato = filas[0].plato
        for f in filas:
            f.estado = nuevo_estado
        s.commit()
    accion = "aprobado" if datos.aprobar else "rechazado"
    registrar(u, "APROBACION", f"Pedido {numero_pedido} ({plato}) {accion}",
              "ok" if datos.aprobar else "alerta")
    return {"ok": True, "estado": nuevo_estado}


@app.get("/api/legalizacion/{servicio_id}")
def api_legalizacion(servicio_id: int, u: Usuario = Depends(usuario_actual)):
    return comparar_legalizacion(servicio_id)


@app.post("/api/legalizacion/confirmar")
def api_confirmar(body: dict, u: Usuario = Depends(usuario_actual)):
    sid = body.get("servicio_id", 1)
    # opcional: permite mandar lo usado junto con la confirmación en vez de
    # exigir un "/legalizacion/ajustar" por cada insumo antes de cerrar.
    usos = {item.get("codigo"): item.get("usado") for item in body.get("usos", [])}
    with Sesion() as s:
        # solo el pedido que de verdad se le mostro a la persona (el mas
        # reciente) - si hubiera otro pedido distinto todavia abierto para
        # este servicio, sigue esperando su propio turno, no se legaliza
        # de arrastre solo porque comparte servicio_id.
        for l in _filas_a_legalizar(s, sid):
            if l.articulo_codigo in usos and usos[l.articulo_codigo] is not None:
                l.usado = usos[l.articulo_codigo]
            dif = (l.usado or 0) - (l.pedido or 0)
            if dif < 0:                       # sobrante: vuelve a bodega
                st = s.query(StockSistema).filter_by(
                    articulo_codigo=l.articulo_codigo, bodega_id=l.bodega_id).first()
                if st:
                    st.cantidad_sd = (st.cantidad_sd or 0) + abs(dif)
            l.estado = "legalizado"
        s.commit()
    registrar(u, "LEGALIZACION", f"Servicio {sid} legalizado", "ok")
    return {"ok": True}


@app.post("/api/legalizacion/ajustar")
def api_ajustar_legalizacion(body: dict, u: Usuario = Depends(usuario_actual)):
    """«Ajustar por voz»: corrige lo realmente usado de un insumo antes de
    confirmar, dictando en vez de editar celda por celda."""
    from agente.cerebro import pensar
    sid = body.get("servicio_id", 1)
    texto = (body.get("texto") or "").strip()
    if not texto:
        raise HTTPException(400, "Dígame el insumo y la cantidad.")
    turno = pensar("Esta corrigiendo cuanto se uso de un insumo en un "
                   "servicio de comidas ya cerrado, antes de legalizarlo.", texto)
    articulo_texto = (turno.get("articulo_texto") or texto).upper()
    cantidad = turno.get("cantidad")
    if cantidad is None:
        raise HTTPException(400, "No entendí la cantidad. ¿Me la repite?")
    palabras = [p for p in articulo_texto.split() if len(p) >= 3]
    with Sesion() as s:
        # mismo alcance que comparar_legalizacion/confirmar: solo el
        # pedido mas reciente, no cualquier otro que siga abierto para
        # este servicio.
        filas = _filas_a_legalizar(s, sid)
        objetivo = next((f for f in filas
                         if any(p in f.nombre.upper() for p in palabras)), None)
        if objetivo is None:
            raise HTTPException(404, "No encontré ese insumo en este servicio.")
        objetivo.usado = cantidad
        s.commit()
        nombre = objetivo.nombre
    registrar(u, "LEGALIZACION", f"Ajuste por voz: {nombre} -> {cantidad:g}", "alerta")
    return comparar_legalizacion(sid)


@app.get("/api/analisis/consumo")
def api_analisis(dias: int = 30, u: Usuario = Depends(requiere_perfil("auditor"))):
    return analisis_consumo(dias)


@app.post("/api/analisis/exportar")
def exportar_analisis(formato: str = "xlsx", dias: int = 30,
                      u: Usuario = Depends(requiere_perfil("auditor"))):
    import pandas as pd
    from servicios.archivos import guardar_df
    datos = analisis_consumo(dias)
    df = pd.DataFrame(datos["subutilizados"])
    marca = ahora().strftime("%Y%m%d_%H%M")
    ruta = f"reportes/analisis_consumo_{marca}.{formato}"
    guardar_df(ruta, df, formato)
    registrar(u, "REPORTE", f"Analisis de consumo exportado: {ruta} ({len(df)} filas)")
    return {"archivo": ruta}


@app.get("/api/pedidos/receta")
def api_receta(plato: str, u: Usuario = Depends(usuario_actual)):
    return detalle_receta(plato)


# ─────────────────────── recetas: catálogo administrado ───────────────────────
# CuentaVoz si gestiona las recetas: crearlas, editarlas y borrarlas queda a
# cargo del administrador (perfil auditor), igual que la gestion de usuarios
# o de bodegas. El auxiliar solo las consulta al armar un pedido.
class IngredienteIn(BaseModel):
    articulo_codigo: str
    cantidad_por_porcion: float


class RecetaIn(BaseModel):
    nombre: str
    rendimiento: int = 1
    preparacion: str = ""
    ingredientes: list[IngredienteIn]


@app.get("/api/recetas")
def listar_recetas(u: Usuario = Depends(usuario_actual)):
    with Sesion() as s:
        recetas = s.query(Receta).order_by(Receta.nombre).all()
        return [{"id": r.id, "nombre": r.nombre, "rendimiento": r.rendimiento,
                 "ingredientes": s.query(RecetaIngrediente)
                                 .filter_by(receta_id=r.id).count()}
                for r in recetas]


@app.get("/api/recetas/{receta_id}")
def obtener_receta(receta_id: int, u: Usuario = Depends(usuario_actual)):
    with Sesion() as s:
        r = s.get(Receta, receta_id)
        if r is None:
            raise HTTPException(404, "Receta no encontrada.")
        ings = s.query(RecetaIngrediente).filter_by(receta_id=r.id).all()
        lineas = []
        for i in ings:
            art = s.get(Articulo, i.articulo_codigo)
            lineas.append({"articulo_codigo": i.articulo_codigo,
                           "nombre": art.nombre_oficial if art else i.articulo_codigo,
                           "unidad": art.unidad_medida if art else "",
                           "cantidad_por_porcion": i.cantidad_por_porcion})
        return {"id": r.id, "nombre": r.nombre, "rendimiento": r.rendimiento,
                "preparacion": r.preparacion or "", "lineas": lineas}


def _validar_ingredientes(s, ingredientes):
    if not ingredientes:
        raise HTTPException(400, "La receta necesita al menos un ingrediente.")
    vistos = set()
    for ing in ingredientes:
        art = s.get(Articulo, ing.articulo_codigo)
        if art is None:
            raise HTTPException(400, f"El artículo {ing.articulo_codigo} no existe en el catálogo.")
        if ing.cantidad_por_porcion <= 0:
            raise HTTPException(400, "La cantidad por porción debe ser mayor que cero.")
        # el mismo articulo en dos lineas de la receta no se suma solo: el
        # editor no impide elegirlo dos veces por error, y calcular_pedido
        # terminaba mostrando dos filas separadas del mismo insumo (con el
        # mismo codigo, lo que ademas rompe la key de React en la tabla) en
        # vez de una sola cantidad combinada.
        if ing.articulo_codigo in vistos:
            raise HTTPException(400, f"«{art.nombre_oficial}» está repetido en la receta: "
                                     "combine las cantidades en una sola línea.")
        vistos.add(ing.articulo_codigo)


@app.post("/api/recetas")
def crear_receta(datos: RecetaIn, u: Usuario = Depends(requiere_perfil("auditor"))):
    with Sesion() as s:
        _validar_ingredientes(s, datos.ingredientes)
        if s.query(Receta).filter(Receta.nombre.ilike(datos.nombre.strip())).first():
            raise HTTPException(400, "Ya existe una receta con ese nombre.")
        r = Receta(nombre=datos.nombre.strip(), rendimiento=datos.rendimiento,
                   preparacion=datos.preparacion.strip())
        s.add(r)
        s.flush()
        for ing in datos.ingredientes:
            s.add(RecetaIngrediente(receta_id=r.id, articulo_codigo=ing.articulo_codigo,
                                    cantidad_por_porcion=ing.cantidad_por_porcion))
        s.commit()
        rid, nombre = r.id, r.nombre
    registrar(u, "RECETA", f"Receta creada: {nombre} ({len(datos.ingredientes)} ingredientes)", "ok")
    return {"ok": True, "id": rid}


@app.put("/api/recetas/{receta_id}")
def editar_receta(receta_id: int, datos: RecetaIn,
                  u: Usuario = Depends(requiere_perfil("auditor"))):
    with Sesion() as s:
        r = s.get(Receta, receta_id)
        if r is None:
            raise HTTPException(404, "Receta no encontrada.")
        _validar_ingredientes(s, datos.ingredientes)
        otra = s.query(Receta).filter(Receta.nombre.ilike(datos.nombre.strip()),
                                      Receta.id != receta_id).first()
        if otra:
            raise HTTPException(400, "Ya existe otra receta con ese nombre.")
        r.nombre = datos.nombre.strip()
        r.rendimiento = datos.rendimiento
        r.preparacion = datos.preparacion.strip()
        s.query(RecetaIngrediente).filter_by(receta_id=receta_id).delete()
        for ing in datos.ingredientes:
            s.add(RecetaIngrediente(receta_id=receta_id, articulo_codigo=ing.articulo_codigo,
                                    cantidad_por_porcion=ing.cantidad_por_porcion))
        s.commit()
        nombre = r.nombre
    registrar(u, "RECETA", f"Receta editada: {nombre} ({len(datos.ingredientes)} ingredientes)", "ok")
    return {"ok": True}


@app.delete("/api/recetas/{receta_id}")
def eliminar_receta(receta_id: int, u: Usuario = Depends(requiere_perfil("auditor"))):
    with Sesion() as s:
        r = s.get(Receta, receta_id)
        if r is None:
            raise HTTPException(404, "Receta no encontrada.")
        nombre = r.nombre
        s.query(RecetaIngrediente).filter_by(receta_id=receta_id).delete()
        s.delete(r)
        s.commit()
    registrar(u, "RECETA", f"Receta eliminada: {nombre}", "ok")
    return {"ok": True}


@app.get("/api/reportes/diferencias-por-bodega")
def api_diferencias_por_bodega(u: Usuario = Depends(requiere_perfil("auditor"))):
    return analitica.diferencias_por_bodega(limite=50)


@app.get("/api/panel/resumen")
def api_panel_resumen(u: Usuario = Depends(requiere_perfil("auditor"))):
    return analitica.resumen_ejecutivo()


@app.get("/api/panel/alertas")
def api_panel_alertas(u: Usuario = Depends(requiere_perfil("auditor"))):
    return analitica.resumen_alertas_panel()


# ─────────────────────── alertas, usuarios y trazas ───────────────────────
_TIPO_ALERTA_TITULO = {
    "desviacion": "Desviación de cantidad", "negativo": "Cantidad negativa dictada",
    "unidad": "Unidad de medida", "inexistente": "Artículo fuera del catálogo",
}


@app.get("/api/alertas")
def ver_alertas(resueltas: int = 0, u: Usuario = Depends(usuario_actual)):
    with Sesion() as s:
        salida = []
        for a in s.query(Alerta).filter_by(resuelta=resueltas).order_by(
                Alerta.id.desc()).all():
            art = bodega = persona = None
            if a.conteo_id:
                c = s.get(Conteo, a.conteo_id)
                if c:
                    ar = s.get(Articulo, c.articulo_codigo)
                    art = ar.nombre_oficial if ar else None
                    ses = s.get(SesionConteo, c.sesion_id)
                    if ses:
                        b = s.get(Bodega, ses.bodega_id)
                        bodega = b.nombre_oficial if b else None
                        us = s.get(Usuario, ses.usuario_id)
                        persona = us.nombre.title() if us else None
            salida.append({"id": a.id, "tipo": a.tipo,
                           "titulo": _TIPO_ALERTA_TITULO.get(a.tipo, a.tipo),
                           "detalle": a.detalle, "articulo": art, "bodega": bodega,
                           "persona": persona, "hora": a.creado.strftime("%H:%M")})
    return salida


@app.get("/api/alertas/resumen")
def resumen_alertas(u: Usuario = Depends(usuario_actual)):
    """Estadisticas reales para la bandeja: abiertas, resueltas hoy y el
    tiempo medio real entre que se genera la alerta y se resuelve."""
    hoy = ahora().date()
    with Sesion() as s:
        abiertas = s.query(Alerta).filter_by(resuelta=0).count()
        resueltas_hoy = (s.query(Alerta).filter(Alerta.resuelta == 1,
                         Alerta.resuelto.isnot(None)).all())
        resueltas_hoy = [a for a in resueltas_hoy if a.resuelto.date() == hoy]
        tiempo_medio_min = None
        if resueltas_hoy:
            segundos = [(a.resuelto - a.creado).total_seconds() for a in resueltas_hoy]
            tiempo_medio_min = round(sum(segundos) / len(segundos) / 60, 1)
    return {"abiertas": abiertas, "resueltas_hoy": len(resueltas_hoy),
            "tiempo_medio_min": tiempo_medio_min}


@app.post("/api/alertas/{alerta_id}/resolver")
def resolver_alerta(alerta_id: int, u: Usuario = Depends(requiere_perfil("auditor"))):
    with Sesion() as s:
        a = s.get(Alerta, alerta_id)
        if a is None:
            raise HTTPException(404, "Alerta no encontrada.")
        a.resuelta = 1
        a.resuelto = ahora()
        s.commit()
        nombre = None
        if a.conteo_id:
            c = s.get(Conteo, a.conteo_id)
            if c:
                art = s.get(Articulo, c.articulo_codigo)
                nombre = art.nombre_oficial if art else None
    detalle = f"Alerta resuelta - {nombre}: {a.detalle}" if nombre else f"Alerta {alerta_id} resuelta"
    registrar(u, "ALERTA", detalle, "ok")
    return {"ok": True}


@app.get("/api/usuarios")
def listar_usuarios(u: Usuario = Depends(requiere_perfil("auditor"))):
    with Sesion() as s:
        salida = []
        for x in s.query(Usuario).all():
            n_bodegas = s.query(AsignacionBodega).filter_by(usuario_id=x.id).count()
            salida.append({"id": x.id, "nombre": x.nombre, "perfil": x.perfil,
                           "correo": x.correo, "activo": bool(x.activo),
                           "bodegas_asignadas": n_bodegas,
                           "ultimo_acceso": (x.ultimo_acceso.strftime("%Y-%m-%d %H:%M")
                                            if x.ultimo_acceso else None)})
        return salida


class CrearUsuarioIn(BaseModel):
    nombre: str
    perfil: str
    correo: str = ""
    pin: str | None = None    # None: se genera uno temporal, ver mas abajo


@app.post("/api/usuarios")
def crear_usuario(datos: CrearUsuarioIn, u: Usuario = Depends(requiere_perfil("auditor"))):
    nombre = datos.nombre.strip().lower()
    if datos.perfil not in ("auxiliar", "auditor"):
        raise HTTPException(400, "El perfil debe ser auxiliar o auditor.")
    # Cognito exige un correo real para crear la cuenta - antes era
    # opcional porque solo se guardaba en esta base; ahora sin correo no
    # hay como crear la cuenta de verdad, asi que se exige aqui.
    correo = (datos.correo or "").strip()
    if not correo or "@" not in correo:
        raise HTTPException(400, "El correo es obligatorio y debe ser valido.")
    # sin esto, todo usuario creado desde Ajustes (la pantalla nunca pide
    # un PIN) quedaba con la misma clave de siempre - la misma que
    # aparece publicada en el README para las cuentas de demostracion.
    # Un temporal aleatorio, distinto cada vez, obliga a que quien lo
    # reciba lo cambie por uno propio desde Mi perfil.
    pin_generado = None
    if datos.pin is None:
        pin_generado = secrets.token_urlsafe(6) + "1Aa"   # cumple la politica de Cognito
        pin_para_guardar = pin_generado
    else:
        pin_para_guardar = datos.pin
    if len(pin_para_guardar) < 8:
        raise HTTPException(400, "El PIN debe tener al menos 8 caracteres.")
    with Sesion() as s:
        if s.query(Usuario).filter_by(nombre=nombre).first():
            raise HTTPException(409, "Ya existe un usuario con ese nombre.")
        nuevo = Usuario(nombre=nombre, perfil=datos.perfil, correo=correo)
        s.add(nuevo)
        s.commit()
        s.refresh(nuevo)
        nid = nuevo.id
        # codigo de empleado: para poder ingresar con el ademas del nombre
        nuevo.codigo = f"CS-{48000 + nid}"
        s.commit()
    if not _crear_usuario_cognito(nombre, correo, pin_para_guardar):
        raise HTTPException(502, "La cuenta local se creo, pero no se pudo crear en Cognito. "
                                 "Revise que el correo no este ya registrado.")
    registrar(u, "USUARIO", f"Usuario {nombre} creado ({datos.perfil})", "ok")
    respuesta = {"ok": True, "id": nid}
    if pin_generado:
        respuesta["pin_temporal"] = pin_generado
    return respuesta


@app.put("/api/usuarios/yo")
def editar_perfil(datos: dict, u: Usuario = Depends(usuario_actual)):
    """Cada quien edita su propio perfil - va antes de /usuarios/{usuario_id}
    a proposito: "yo" no es un entero, y si esta ruta queda despues, esa otra
    la intercepta primero y revienta con un 422 (el mismo problema que ya
    paso con /usuarios/yo/bodegas)."""
    correo_nuevo = (datos.get("correo") or "").strip()
    # si Cognito no queda enterado del correo nuevo, el codigo de "olvide
    # mi clave" seguiria yendo al correo viejo para siempre - se sincroniza
    # ANTES de guardar localmente, para no dejar los dos lados desfasados.
    if correo_nuevo and correo_nuevo != u.correo:
        if not _actualizar_correo_cognito(u.nombre, correo_nuevo):
            raise HTTPException(502, "No se pudo actualizar el correo en este momento.")
    with Sesion() as s:
        usr = s.get(Usuario, u.id)
        for k in ("nombre", "correo", "telefono"):
            if k in datos:
                setattr(usr, k, datos[k])
        s.commit()
    registrar(u, "PERFIL", "Datos personales actualizados")
    return {"ok": True}


class EditarUsuarioIn(BaseModel):
    correo: str | None = None
    perfil: str | None = None
    activo: bool | None = None


@app.put("/api/usuarios/{usuario_id}")
def editar_usuario(usuario_id: int, datos: EditarUsuarioIn,
                   u: Usuario = Depends(requiere_perfil("auditor"))):
    """Editar correo, rol o estado de OTRA persona - no es lo mismo que
    /usuarios/yo, que cada quien usa para su propio perfil. No se borra a
    nadie (romperia la trazabilidad de sus conteos y firmas pasadas):
    desactivar es el equivalente seguro a eliminar, y ya bloquea el
    ingreso (ver usuario_actual)."""
    if datos.perfil is not None and datos.perfil not in ("auxiliar", "auditor"):
        raise HTTPException(400, "El perfil debe ser auxiliar o auditor.")
    if usuario_id == u.id and datos.activo is False:
        raise HTTPException(400, "No puede desactivar su propia cuenta.")
    if usuario_id == u.id and datos.perfil is not None and datos.perfil != u.perfil:
        raise HTTPException(400, "No puede cambiar su propio rol.")
    with Sesion() as s:
        obj = s.get(Usuario, usuario_id)
        if obj is None:
            raise HTTPException(404, "Usuario no encontrado.")
        cambios = []
        if datos.correo is not None and datos.correo != obj.correo:
            # mismo motivo que en editar_perfil: sin esto Cognito le
            # seguiria mandando los codigos de recuperar clave al correo
            # viejo de esa persona, sin que nada lo avisara.
            if not _actualizar_correo_cognito(obj.nombre, datos.correo):
                raise HTTPException(502, "No se pudo actualizar el correo en este momento.")
            obj.correo = datos.correo
            cambios.append("correo")
        if datos.perfil is not None and datos.perfil != obj.perfil:
            obj.perfil = datos.perfil
            cambios.append(f"perfil -> {datos.perfil}")
        desactivado = False
        if datos.activo is not None and bool(datos.activo) != bool(obj.activo):
            obj.activo = int(datos.activo)
            desactivado = not datos.activo
            cambios.append("activo" if datos.activo else "inactivo")
        s.commit()
        nombre = obj.nombre
    if desactivado:
        # cierra sus sesiones vivas en Cognito - el access token ya
        # emitido sigue valido hasta que vence solo (ver seguridad.py)
        try:
            _cliente_cognito().admin_user_global_sign_out(
                UserPoolId=COGNITO_USER_POOL_ID, Username=nombre)
        except Exception as e:
            print(f"[cognito] no se pudo cerrar la sesion de {nombre}: {e}")
    if cambios:
        registrar(u, "USUARIO", f"{nombre} editado: {', '.join(cambios)}", "ok")
    return {"ok": True}


@app.delete("/api/usuarios/{usuario_id}")
def eliminar_usuario(usuario_id: int, u: Usuario = Depends(requiere_perfil("auditor"))):
    """Borra de verdad a alguien (no solo desactivar) - para limpiar cuentas
    de prueba de un ambiente antes de una demo, sin dejarlas visibles en
    Gestión de usuarios. A propósito NO es lo que hace editar_usuario()
    de arriba para el uso normal (esa sigue prefiriendo desactivar, por la
    misma razón documentada ahí: no romper la trazabilidad de conteos y
    firmas reales). Aquí sí se borra la cuenta, pero la Traza (registro
    inmutable) NUNCA se toca como fila - solo se le suelta la referencia al
    usuario (usuario_id queda en NULL; el nombre en "persona" ya es texto
    aparte) para que el historial real de esa persona, si lo hubo, siga
    intacto y legible después de borrar la cuenta."""
    if usuario_id == u.id:
        raise HTTPException(400, "No puede eliminar su propia cuenta.")
    with Sesion() as s:
        obj = s.get(Usuario, usuario_id)
        if obj is None:
            raise HTTPException(404, "Usuario no encontrado.")
        nombre = obj.nombre
        # sesiones de conteo/auditoria de esta persona: primero los Conteo
        # de cada sesion (y las Alertas que esos Conteo hayan generado),
        # despues la sesion misma - en ese orden, por las llaves foraneas.
        sesiones = s.query(SesionConteo).filter_by(usuario_id=usuario_id).all()
        for ses in sesiones:
            conteos = s.query(Conteo).filter_by(sesion_id=ses.id).all()
            for c in conteos:
                s.query(Alerta).filter_by(conteo_id=c.id).delete()
                s.delete(c)
            s.delete(ses)
        s.query(AsignacionBodega).filter_by(usuario_id=usuario_id).delete()
        # MensajeSoporte exige remitente/destinatario (no admite NULL) - sin
        # cuenta de uno de los dos lados, el mensaje no puede seguir existiendo.
        s.query(MensajeSoporte).filter(
            (MensajeSoporte.remitente_id == usuario_id)
            | (MensajeSoporte.destinatario_id == usuario_id)).delete()
        # estas si admiten NULL: se sueltan en vez de borrarse, para no
        # perder pedidos/aprobaciones reales solo porque quien los creo
        # ya no tiene cuenta.
        for linea in s.query(LineaServicio).filter_by(creado_por_id=usuario_id).all():
            linea.creado_por_id = None
        for ap in s.query(Aprobacion).filter_by(creado_por_id=usuario_id).all():
            ap.creado_por_id = None
        for ap in s.query(Aprobacion).filter_by(resuelto_por_id=usuario_id).all():
            ap.resuelto_por_id = None
        for t in s.query(Traza).filter_by(usuario_id=usuario_id).all():
            t.usuario_id = None
        s.delete(obj)
        s.commit()
    try:
        _cliente_cognito().admin_delete_user(UserPoolId=COGNITO_USER_POOL_ID, Username=nombre)
    except Exception as e:
        print(f"[cognito] no se pudo borrar la cuenta de {nombre}: {e}")
    registrar(u, "USUARIO", f"{nombre} eliminado de forma permanente", "ok")
    return {"ok": True}


class ItemSemillaIn(BaseModel):
    articulo_codigo: str
    cantidad: float
    # solo para bodegas sin ningun stock de sistema cargado todavia (el
    # extracto de My Inventory nunca llego para esa bodega): crea la fila
    # de StockSistema con este valor ANTES de contar, para tener contra
    # que comparar. Si la bodega ya tiene stock de este articulo, se
    # ignora - nunca pisa un valor real ya cargado.
    cantidad_sistema_si_falta: float | None = None
    # una cantidad que se sale del umbral normalmente se salta (ver
    # docstring de sembrar_conteo) - forzar=true la guarda igual Y crea la
    # Alerta de "desviacion" que le correspondería, exactamente como
    # cuando una persona real dice "sí, confirmo" tras la advertencia. Es
    # para poblar Alertas/Auditoría con casos reales en un ambiente de
    # demo, no para forzar cantidades negativas o de otro articulo/unidad
    # (esas siguen sin poder guardarse: no tendría sentido real).
    forzar: bool = False


class ConteoSemillaIn(BaseModel):
    bodega_id: int
    usuario_id: int
    items: list[ItemSemillaIn]


@app.post("/api/admin/sembrar-conteo")
def sembrar_conteo(datos: ConteoSemillaIn, u: Usuario = Depends(requiere_perfil("auditor"))):
    """Crea conteos CONFIRMADOS reales (misma tabla, misma trazabilidad, se
    validan igual que si la persona lo hubiera dictado) para poblar un
    ambiente con datos de muestra antes de una demo - ej. que el panel
    gerencial tenga varias bodegas con diferencia real, no solo una. No
    pasa por reconocimiento de voz/texto: articulo y cantidad van directos,
    para que sembrar muchos a la vez no dependa de que el agente entienda
    cada frase (ni de la cuota de Gemini). Los items que dispararian una
    alerta (negativo, fuera de umbral...) se saltan en vez de forzarse -
    esto es para que la demo se vea real, no para inventar anomalias."""
    with Sesion() as s:
        persona = s.get(Usuario, datos.usuario_id)
        if persona is None:
            raise HTTPException(404, "Usuario no encontrado.")
        bodega = s.get(Bodega, datos.bodega_id)
        if bodega is None:
            raise HTTPException(404, "Bodega no encontrada.")
        ses = (s.query(SesionConteo)
               .filter_by(bodega_id=datos.bodega_id, usuario_id=datos.usuario_id, estado="abierta")
               .first())
        if not ses:
            ses = SesionConteo(bodega_id=datos.bodega_id, usuario_id=datos.usuario_id,
                               tipo="conteo", estado="abierta")
            s.add(ses)
            s.commit()
            s.refresh(ses)
        sesion_id = ses.id
        if bodega.estado == "pendiente":
            bodega.estado = "en_conteo"
            s.commit()
        nombre_bodega = bodega.nombre_oficial

    guardados = 0
    saltados = []
    for item in datos.items:
        with Sesion() as s:
            art = s.get(Articulo, item.articulo_codigo)
            if art is None:
                saltados.append(item.articulo_codigo)
                continue
            if item.cantidad_sistema_si_falta is not None:
                existe = s.query(StockSistema).filter_by(
                    articulo_codigo=item.articulo_codigo, bodega_id=datos.bodega_id).first()
                if not existe:
                    s.add(StockSistema(articulo_codigo=item.articulo_codigo,
                                       bodega_id=datos.bodega_id,
                                       cantidad_sd=item.cantidad_sistema_si_falta))
                    s.commit()
        v = validar_conteo(item.articulo_codigo, item.cantidad, art.unidad_medida, datos.bodega_id)
        if not v["ok"] and not (item.forzar and v["tipo"] == "desviacion"):
            saltados.append(item.articulo_codigo)
            continue
        with Sesion() as s:
            reg = Conteo(sesion_id=sesion_id, articulo_codigo=item.articulo_codigo,
                        cantidad=item.cantidad, unidad=art.unidad_medida, estado="confirmado")
            s.add(reg)
            s.commit()
            s.refresh(reg)
            if not v["ok"]:
                esperado = v.get("esperado") or 0
                s.add(Alerta(conteo_id=reg.id, tipo="desviacion",
                             detalle=f"El sistema esperaba alrededor de {esperado:g}, "
                                     f"se contaron {item.cantidad:g}."))
                s.commit()
        guardados += 1
    if guardados:
        registrar(persona, "CONTEO",
                 f"{guardados} referencias contadas en {nombre_bodega} (datos de muestra)")
    return {"ok": True, "guardados": guardados, "saltados": saltados}


class DuracionSemillaIn(BaseModel):
    sesion_id: int
    minutos: float


@app.post("/api/admin/sembrar-duracion")
def sembrar_duracion(datos: DuracionSemillaIn, u: Usuario = Depends(requiere_perfil("auditor"))):
    """Ajusta cuánto "duró" una sesión de conteo (su inicio, relativo al fin
    que ya tiene) - para cuando una sesión de muestra se abrió hace rato
    (en otra prueba) y se firma/cierra recién ahora: sin esto, "tiempo
    promedio de conteo" del panel sale con la diferencia real entre esos
    dos momentos, que no fue tiempo contando de verdad."""
    with Sesion() as s:
        ses = s.get(SesionConteo, datos.sesion_id)
        if ses is None:
            raise HTTPException(404, "Sesion no encontrada.")
        if not ses.fin:
            raise HTTPException(409, "Esta sesion todavia no tiene fin (no está firmada/cerrada).")
        ses.inicio = ses.fin - timedelta(minutes=datos.minutos)
        s.commit()
    return {"ok": True}


class AlertaSemillaIn(BaseModel):
    tipo: str          # negativo | unidad | inexistente | desviacion
    detalle: str


@app.post("/api/admin/sembrar-alerta")
def sembrar_alerta(datos: AlertaSemillaIn, u: Usuario = Depends(requiere_perfil("auditor"))):
    """Crea una Alerta suelta (sin conteo asociado) para los tipos que en
    el flujo real NUNCA llegan a guardarse como conteo (negativo, unidad
    equivocada, artículo inexistente) - la persona tiene que repetir el
    dato, así que lo único que queda de ese intento es la alerta misma.
    Para poblar Auditoría/Panel con variedad real de tipos antes de una
    demo, no solo "desviación" (que sí se puede sembrar junto con su
    conteo via /admin/sembrar-conteo con forzar=true)."""
    if datos.tipo not in ("negativo", "unidad", "inexistente", "desviacion"):
        raise HTTPException(400, "Tipo de alerta no reconocido.")
    with Sesion() as s:
        s.add(Alerta(conteo_id=None, tipo=datos.tipo, detalle=datos.detalle))
        s.commit()
    return {"ok": True}


class NegativosSemillaIn(BaseModel):
    inicial: int


@app.put("/api/admin/negativos-iniciales")
def ajustar_negativos_iniciales(datos: NegativosSemillaIn, u: Usuario = Depends(requiere_perfil("auditor"))):
    """La tarjeta "Negativos detectados en el sistema" compara el inicio de
    ESTE período contra el conteo actual - si nunca se fijó un punto de
    partida (o se fijó igual al valor de hoy, por default), la tarjeta
    siempre muestra "X → X" y no cuenta ninguna historia. Este valor es la
    foto de hace un tiempo (de antes de que My Inventory corrigiera los
    que ya se corrigieron), no algo que la app recalcule sola: por diseño,
    corregir un negativo del sistema pasa por fuera de CuentaVoz."""
    with Sesion() as s:
        existente = s.get(ConfigClave, "negativos_iniciales")
        valor = str(datos.inicial)
        if existente:
            existente.valor = valor
        else:
            s.add(ConfigClave(clave="negativos_iniciales", valor=valor))
        s.commit()
    return {"ok": True}


@app.delete("/api/admin/historial-cierre/{historial_id}")
def borrar_historial_cierre(historial_id: int, u: Usuario = Depends(requiere_perfil("auditor"))):
    """Para limpiar una foto de "Exactitud por toma de inventario" que
    quedó mal (ej. una bodega de muestra que se cerró antes de tener
    suficientes items contados, y después se reabrió para completarla) -
    a diferencia de la Traza, HistorialCierre no es un registro legal
    inmutable: es una serie de tiempo para la gráfica del panel, y una
    foto tomada por error de una prueba no debería quedar mezclada con el
    histórico real."""
    with Sesion() as s:
        h = s.get(HistorialCierre, historial_id)
        if h is None:
            raise HTTPException(404, "Registro no encontrado.")
        s.delete(h)
        s.commit()
    return {"ok": True}


class UsoSemillaItem(BaseModel):
    articulo_codigo: str
    usado: float


class UsoSemillaIn(BaseModel):
    servicio_id: int
    usos: list[UsoSemillaItem]


@app.put("/api/admin/legalizacion-uso")
def sembrar_uso_legalizacion(datos: UsoSemillaIn, u: Usuario = Depends(requiere_perfil("auditor"))):
    """Registra cuánto se usó de verdad en las líneas ya "abierto" de un
    servicio, SIN legalizarlo - a diferencia de /api/legalizacion/confirmar,
    que además cierra el servicio de una vez. Para dejar una comparación
    real y completa (pedido vs. usado) lista para revisar y confirmar en
    vivo en la demo, en vez de una pantalla vacía o con todo en cero."""
    with Sesion() as s:
        actualizadas = 0
        for item in datos.usos:
            l = (s.query(LineaServicio)
                .filter_by(servicio_id=datos.servicio_id, articulo_codigo=item.articulo_codigo,
                            estado="abierto").first())
            if l:
                l.usado = item.usado
                actualizadas += 1
        s.commit()
    return {"ok": True, "actualizadas": actualizadas}


@app.get("/api/usuarios/yo/bodegas")
def bodegas_asignadas(u: Usuario = Depends(usuario_actual)):
    """Las bodegas asignadas a la persona que tiene la sesion. Va ANTES de
    la ruta parametrizada /usuarios/{usuario_id}/bodegas a proposito: si
    quedara despues, FastAPI hace match de "yo" contra {usuario_id} primero
    y esta ruta nunca se alcanza (por eso nunca respondia para un auxiliar)."""
    with Sesion() as s:
        asigs = s.query(AsignacionBodega).filter_by(usuario_id=u.id).all()
        salida = []
        for a in asigs:
            b = s.get(Bodega, a.bodega_id)
            if b:
                refs = s.query(StockSistema).filter_by(bodega_id=b.id).count()
                item = {"id": b.id, "bodega": b.nombre_oficial,
                       "estado": b.estado, "referencias": refs}
                item.update(_contexto_bodega(s, b, refs))
                salida.append(item)
    return salida


@app.get("/api/usuarios/{usuario_id}/bodegas")
def ver_bodegas_de_usuario(usuario_id: int, u: Usuario = Depends(requiere_perfil("auditor"))):
    """Para no borrar asignaciones existentes al agregar una nueva (ver
    «Asignar auditor» en el tablero de bodegas)."""
    with Sesion() as s:
        return [a.bodega_id for a in
                s.query(AsignacionBodega).filter_by(usuario_id=usuario_id).all()]


@app.put("/api/usuarios/{usuario_id}/bodegas")
def asignar_bodegas(usuario_id: int, body: dict,
                    u: Usuario = Depends(requiere_perfil("auditor"))):
    ids = body.get("bodega_ids", [])
    with Sesion() as s:
        objetivo = s.get(Usuario, usuario_id)
        if objetivo is None:
            raise HTTPException(404, "Usuario no encontrado.")
        s.query(AsignacionBodega).filter_by(usuario_id=usuario_id).delete()
        for bid in ids:
            s.add(AsignacionBodega(usuario_id=usuario_id, bodega_id=bid))
        s.commit()
        nombre = objetivo.nombre
    registrar(u, "ASIGNACION", f"Bodegas asignadas a {nombre}: {len(ids)}", "ok")
    return {"ok": True}


@app.get("/api/bodegas/asignaciones")
def ver_asignaciones_completas(u: Usuario = Depends(requiere_perfil("auditor"))):
    """Vista de cobertura: por cada bodega, quien la tiene asignada (o
    nadie). Con varios auxiliares repartiendose 54 bodegas, el administrador
    necesita ver esto de un vistazo para no dejar bodegas sin nadie a cargo
    ni confundir a dos personas asignandoles las mismas por error - revisar
    ficha por ficha de cada persona no lo deja ver."""
    with Sesion() as s:
        por_bodega: dict[int, list] = {}
        for a in s.query(AsignacionBodega).all():
            por_bodega.setdefault(a.bodega_id, []).append(a.usuario_id)
        salida = []
        for b in s.query(Bodega).order_by(Bodega.nombre_oficial).all():
            personas = []
            for uid in por_bodega.get(b.id, []):
                us = s.get(Usuario, uid)
                if us:
                    personas.append({"id": us.id, "nombre": us.nombre, "perfil": us.perfil})
            salida.append({"id": b.id, "bodega": b.nombre_oficial, "asignados": personas})
    return salida




# acciones sin valor para el resumen de "Inicio": ingresos repetidos, ajustes
# de perfil y cada conteo individual (eso ya se ve en el tablero de Bodegas)
_RUIDO_ACTIVIDAD = ("INGRESO", "SEGURIDAD", "PERFIL", "CONTEO")


def _narrar_actividad(t):
    p = (t.persona or "alguien").title()
    d = t.detalle
    if t.accion == "CREACION":
        nombre = d.split(" creado,")[0]
        return f"{p} creó {nombre.title()}, pendiente de aprobación"
    if t.accion == "APERTURA":
        bodega = d.split(" abierta")[0]
        return f"{p} abrió {bodega.title()}"
    if t.accion == "AUDITORIA":
        bodega = d.replace("Recuento ciego iniciado en ", "")
        return f"{p} inició el recuento ciego en {bodega.title()}"
    if t.accion == "FIRMA":
        tipo, _, bodega = d.partition(" - ")
        verbo = "firmó el conteo de" if tipo.lower().startswith("conteo") else "firmó la auditoría de"
        return f"{p} {verbo} {bodega.title()}"
    if t.accion == "CIERRE":
        bodega = d.split(" cerrada")[0]
        return f"{bodega.title()} quedó cerrada con doble firma"
    if t.accion == "REAPERTURA":
        motivo = d.split("motivo: ")[-1]
        bodega = d.split(" reabierta")[0]
        return f"{p} reabrió {bodega.title()} — motivo: {motivo}"
    if t.accion == "REPORTE":
        if d.startswith("Consolidado generado"):
            filas = f" ({d.rsplit('(', 1)[-1]}" if "(" in d else ""
            return f"{p} generó el consolidado para My Inventory{filas}"
        if d.startswith("Estado de bodegas exportado"):
            return f"{p} exportó el estado del tablero"
        if d.startswith("Detalle de bodega"):
            return f"{p} exportó el detalle de una bodega"
        return f"{p} generó un reporte"
    if t.accion == "PEDIDO":
        return f"{p} envió un pedido al almacén"
    if t.accion == "LEGALIZACION":
        if d.startswith("Ajuste por voz"):
            return f"{p} ajustó un consumo por voz"
        return f"{p} legalizó un servicio"
    if t.accion == "ALERTA":
        if d.startswith("Alerta resuelta - "):
            nombre, _, msg = d[len("Alerta resuelta - "):].partition(": ")
            try:
                esperado = msg.split("alrededor de ")[1].split(".")[0]
                confirmado = msg.split("¿Confirma ")[1].rstrip("?")
                return f"Alerta resuelta: {nombre} pasó de {esperado} a {confirmado}"
            except IndexError:
                return f"{p} resolvió una alerta de {nombre}"
        return f"{p} resolvió una alerta"
    if t.accion == "CORRECCION":
        cambio = d.split(" (valor anterior")[0]
        return f"{p} corrigió un conteo: {cambio}"
    if t.accion == "USUARIO":
        nombre = d.split(" creado")[0].replace("Usuario ", "")
        return f"{p} creó el usuario {nombre.title()}"
    if t.accion == "ASIGNACION":
        return f"{p}: {d.lower()}"
    if t.accion == "APROBACION":
        if "entra al catalogo" in d:
            nombre = d.split(" aprobado")[0]
            return f"{p} aprobó el producto {nombre.title()}"
        nombre = d.split(" rechazado")[0]
        return f"{p} rechazó el producto {nombre.title()}"
    if t.accion == "AJUSTE":
        return f"{p} actualizó la configuración del sistema"
    if t.accion == "SOPORTE":
        if " le escribió a " in d:
            destinatario = d.split(" le escribió a ")[1].split(":")[0]
            return f"{p} le escribió a {destinatario.title()}"
        return f"{p} reportó un problema"
    return f"{p}: {d}"


@app.get("/api/trazabilidad/reciente")
def traza_reciente(u: Usuario = Depends(usuario_actual)):
    """Vista compartida para Inicio: sin datos sensibles, solo la acción y quién."""
    with Sesion() as s:
        trazas = (s.query(Traza).filter(~Traza.accion.in_(_RUIDO_ACTIVIDAD))
                 .order_by(Traza.id.desc()).limit(8).all())
        return [{"hora": t.creado.strftime("%H:%M"), "persona": (t.persona or "").title(),
                 "accion": t.accion, "detalle": _narrar_actividad(t), "tipo": t.tipo}
                for t in trazas]


# ─────────────────────── aprobaciones en paralelo ───────────────────────
@app.get("/api/aprobaciones")
def listar_aprobaciones(estado: str = "pendiente",
                        u: Usuario = Depends(requiere_perfil("auditor"))):
    with Sesion() as s:
        salida = []
        q = s.query(Aprobacion)
        if estado:
            q = q.filter_by(estado=estado)
        for a in q.order_by(Aprobacion.id.desc()).all():
            b = s.get(Bodega, a.bodega_id) if a.bodega_id else None
            creador = s.get(Usuario, a.creado_por_id) if a.creado_por_id else None
            salida.append({"id": a.id, "tipo": a.tipo, "nombre": a.nombre,
                           "unidad_medida": a.unidad_medida,
                           "cantidad_inicial": a.cantidad_inicial,
                           "bodega": b.nombre_oficial if b else None,
                           "creado_por": creador.nombre if creador else "?",
                           "hora": a.creado.strftime("%H:%M")})
    return salida


@app.post("/api/aprobaciones/{aprobacion_id}/aprobar")
def aprobar(aprobacion_id: int, u: Usuario = Depends(requiere_perfil("auditor"))):
    with Sesion() as s:
        a = s.get(Aprobacion, aprobacion_id)
        if a is None or a.estado != "pendiente":
            raise HTTPException(404, "Aprobacion no encontrada o ya resuelta.")
        a.estado = "aprobado"
        a.resuelto_por_id = u.id
        a.resuelto = ahora()
        if a.tipo == "producto" and a.articulo_codigo:
            existe = s.query(StockSistema).filter_by(
                articulo_codigo=a.articulo_codigo, bodega_id=a.bodega_id).first()
            if not existe:
                # el saldo del sistema arrancaba siempre en 0, sin importar
                # cuanto se haya contado de verdad al crearlo (ej. "noventa
                # alicornios") - el articulo quedaba marcado con una
                # "diferencia" de +90 para siempre en el detalle de la
                # bodega, como si nunca se hubiera revisado, aunque el
                # administrador lo acababa de aprobar con ese conteo.
                s.add(StockSistema(articulo_codigo=a.articulo_codigo, bodega_id=a.bodega_id,
                                   cantidad_sd=a.cantidad_inicial or 0))
            if a.conteo_id:
                c = s.get(Conteo, a.conteo_id)
                if c:
                    c.estado = "confirmado"
        elif a.tipo == "bodega":
            s.add(Bodega(nombre_oficial=a.nombre, estado="pendiente"))
        s.commit()
        nombre = a.nombre
    registrar(u, "APROBACION", f"{nombre} aprobado y entra al catalogo oficial", "ok")
    return {"ok": True}


@app.post("/api/aprobaciones/{aprobacion_id}/rechazar")
def rechazar(aprobacion_id: int, u: Usuario = Depends(requiere_perfil("auditor"))):
    with Sesion() as s:
        a = s.get(Aprobacion, aprobacion_id)
        if a is None or a.estado != "pendiente":
            raise HTTPException(404, "Aprobacion no encontrada o ya resuelta.")
        a.estado = "rechazado"
        a.resuelto_por_id = u.id
        a.resuelto = ahora()
        if a.conteo_id:
            c = s.get(Conteo, a.conteo_id)
            if c:
                c.estado = "rechazado"
        s.commit()
        nombre = a.nombre
    registrar(u, "APROBACION", f"{nombre} rechazado", "alerta")
    return {"ok": True}


@app.post("/api/soporte/reportar")
def reportar_problema(body: dict, u: Usuario = Depends(usuario_actual)):
    detalle = (body.get("detalle") or "").strip() or "Sin detalle."
    registrar(u, "SOPORTE", f"{u.nombre} reporto: {detalle}", "alerta")
    return {"ok": True}


def _enviar_correo_real(destinatario: str, asunto: str, cuerpo: str) -> tuple[bool, str]:
    """Envía un correo de verdad por la API de Brevo (HTTPS) si hay
    credenciales configuradas (BREVO_API_KEY). Antes se intentó SMTP
    directo a Gmail (Render bloquea el puerto 587, "Network is
    unreachable") y luego la API de Resend (Cloudflare la rechazaba con
    "error code: 1010", probablemente por la reputación de las IPs
    compartidas de Render) - ninguna de las dos depende del código, así
    que se cambió de proveedor otra vez. Sin BREVO_API_KEY configurada,
    no intenta nada: el llamador sigue funcionando igual que antes (solo
    trazabilidad), el mismo patrón de "se degrada sin romperse" que ya
    usa el agente sin GOOGLE_API_KEY. Devuelve (enviado, motivo-si-fallo)
    - el motivo es temporal mientras se termina de calibrar el envío
    real."""
    api_key = os.getenv("BREVO_API_KEY", "").strip()
    remitente = os.getenv("BREVO_FROM", os.getenv("SMTP_CORREO", "")).strip()
    if not api_key or not remitente or not destinatario:
        return False, "sin BREVO_API_KEY/BREVO_FROM configuradas"
    payload = json.dumps({
        "sender": {"name": "CuentaVoz", "email": remitente},
        "to": [{"email": destinatario}],
        "subject": asunto, "textContent": cuerpo,
    }).encode("utf-8")
    peticion = urllib.request.Request(
        "https://api.brevo.com/v3/smtp/email", data=payload, method="POST",
        headers={"api-key": api_key, "Content-Type": "application/json",
                 "Accept": "application/json",
                 "User-Agent": "CuentaVoz/1.0 (+https://cuentavoz.onrender.com)"})
    # El contenedor de Render no tiene ruta de salida por IPv6, pero la
    # resolución de nombres a veces sí devuelve una dirección IPv6 (y
    # Python la intenta primero) - eso da exactamente "Network is
    # unreachable" aunque el IPv4 normal funcione bien. Se fuerza IPv4
    # solo durante esta conexión puntual.
    getaddrinfo_original = socket.getaddrinfo

    def _forzar_ipv4(host, port, family=0, type=0, proto=0, flags=0):
        return getaddrinfo_original(host, port, socket.AF_INET, type, proto, flags)

    socket.getaddrinfo = _forzar_ipv4
    try:
        with urllib.request.urlopen(peticion, timeout=10) as resp:
            return 200 <= resp.status < 300, ""
    except urllib.error.HTTPError as e:
        motivo = f"HTTP {e.code}: {e.read().decode('utf-8', 'ignore')[:300]}"
        print(f"[correo] no se pudo enviar a {destinatario}: {motivo}")
        return False, motivo
    except Exception as e:
        motivo = f"{type(e).__name__}: {e}"
        print(f"[correo] no se pudo enviar a {destinatario}: {motivo}")
        return False, motivo
    finally:
        socket.getaddrinfo = getaddrinfo_original


@app.post("/api/soporte/mensaje-administrador")
def mensaje_administrador(body: dict, u: Usuario = Depends(usuario_actual)):
    """"Escribirle al administrador". El mensaje siempre queda trazado -
    se ve en Ajustes → Registro de trazabilidad - y además se intenta un
    correo real (vía Brevo) si el servidor tiene BREVO_API_KEY
    configurada. Sin esa credencial (el caso normal por ahora: no
    depende de registrar una cuenta con un tercero), el frontend abre el
    correo ya instalado en el dispositivo de quien envía, con el mensaje
    listo - así igual llega un correo real, desde la cuenta de esa
    persona, sin que CuentaVoz tenga que gestionar ningún servicio de
    correo por su cuenta."""
    mensaje = (body.get("mensaje") or "").strip()
    if not mensaje:
        raise HTTPException(400, "Escriba el mensaje antes de enviarlo.")
    with Sesion() as s:
        admin = (s.query(Usuario)
                .filter(Usuario.perfil == "auditor", Usuario.activo == 1, Usuario.id != u.id)
                .first())
        if not admin:
            raise HTTPException(404, "No hay un administrador disponible por ahora.")
        nombre_admin, correo_admin, admin_id = admin.nombre, admin.correo, admin.id
        s.add(MensajeSoporte(remitente_id=u.id, destinatario_id=admin_id, mensaje=mensaje))
        s.commit()
    registrar(u, "SOPORTE", f"{u.nombre} le escribió a {nombre_admin}: {mensaje}")
    cuerpo = f"Mensaje enviado desde CuentaVoz por {u.nombre}.\n\n{mensaje}"
    correo_enviado, _motivo = _enviar_correo_real(correo_admin, "Mensaje desde CuentaVoz", cuerpo)
    return {"ok": True, "administrador": nombre_admin, "correo_enviado": correo_enviado}


@app.get("/api/soporte/mensajes")
def mis_mensajes_soporte(u: Usuario = Depends(usuario_actual)):
    """La bandeja de "Soporte en vivo" dentro de la app: para un auxiliar,
    lo que ha escrito y si ya le respondieron; para el administrador, lo
    que le han escrito y lo que falta por responder."""
    with Sesion() as s:
        if u.perfil == "auditor":
            filas = (s.query(MensajeSoporte)
                    .filter(MensajeSoporte.destinatario_id == u.id)
                    .order_by(MensajeSoporte.creado.desc()).all())
        else:
            filas = (s.query(MensajeSoporte)
                    .filter(MensajeSoporte.remitente_id == u.id)
                    .order_by(MensajeSoporte.creado.desc()).all())
        ids_personas = {m.remitente_id for m in filas} | {m.destinatario_id for m in filas}
        personas = {p.id: p.nombre for p in s.query(Usuario).filter(Usuario.id.in_(ids_personas)).all()}
        return [{"id": m.id,
                 "de": personas.get(m.remitente_id, "?"),
                 "para": personas.get(m.destinatario_id, "?"),
                 "mensaje": m.mensaje, "respuesta": m.respuesta,
                 "creado": m.creado.strftime("%Y-%m-%d %H:%M"),
                 "respondido": m.respondido.strftime("%Y-%m-%d %H:%M") if m.respondido else None}
                for m in filas]


@app.post("/api/soporte/mensajes/{mensaje_id}/responder")
def responder_mensaje_soporte(mensaje_id: int, body: dict, u: Usuario = Depends(usuario_actual)):
    """Solo quien recibió el mensaje puede responderlo - no hace falta
    pedir perfil "auditor" aparte: si no es el destinatario, no puede."""
    respuesta = (body.get("respuesta") or "").strip()
    if not respuesta:
        raise HTTPException(400, "Escriba la respuesta antes de enviarla.")
    with Sesion() as s:
        m = s.get(MensajeSoporte, mensaje_id)
        if not m or m.destinatario_id != u.id:
            raise HTTPException(404, "Ese mensaje no existe o no es suyo para responder.")
        if m.respuesta is not None:
            # sin este chequeo, dos respuestas al mismo mensaje (un doble
            # clic, un reintento de red, dos pestañas abiertas) pisaban la
            # respuesta anterior en silencio - la persona que ya la había
            # leído (o recibido por correo) se quedaba sin saber que
            # cambió, y se mandaba un segundo correo real de mas.
            raise HTTPException(409, "Ese mensaje ya fue respondido.")
        m.respuesta = respuesta
        m.respondido = ahora()
        s.commit()
        remitente = s.get(Usuario, m.remitente_id)
        nombre_remitente = remitente.nombre if remitente else "?"
        correo_remitente = remitente.correo if remitente else None
    registrar(u, "SOPORTE", f"{u.nombre} le respondió a {nombre_remitente}: {respuesta}")
    return {"ok": True, "destinatario": nombre_remitente, "correo_destinatario": correo_remitente}


@app.get("/api/soporte/administrador")
def administrador_de_turno(u: Usuario = Depends(usuario_actual)):
    """Con quien puede contactarse cualquier persona (no solo el
    administrador) desde Ayuda - sin exponer el resto del listado de
    usuarios, que si es exclusivo del administrador. Si quien pregunta ya
    es administrador, no tiene sentido mostrarse a si mismo como contacto:
    se busca a OTRO administrador, y si no hay ninguno mas, no hay a quien
    escribirle (para eso esta la mesa de ayuda de Colsubsidio aparte)."""
    with Sesion() as s:
        admin = (s.query(Usuario)
                .filter(Usuario.perfil == "auditor", Usuario.activo == 1,
                        Usuario.id != u.id)
                .first())
    if not admin:
        return {"nombre": None, "correo": None, "es_usted": u.perfil == "auditor"}
    return {"nombre": admin.nombre, "correo": admin.correo, "es_usted": False}


@app.get("/api/usuarios/yo")
def ver_perfil(u: Usuario = Depends(usuario_actual)):
    from agente.cerebro import VOCES, VOZ_DEFECTO
    dias_pin = (ahora() - (u.pin_actualizado or ahora())).days
    # idioma_voz guardaba un codigo de idioma de navegador (es-MX, es-CO...)
    # de cuando la voz salia por speechSynthesis; ahora guarda la clave de
    # la voz neuronal elegida (kore, puck...). Una cuenta con el valor
    # viejo cae a la voz por defecto en vez de romper el selector.
    voz = u.idioma_voz if u.idioma_voz in VOCES else VOZ_DEFECTO
    return {"id": u.id, "nombre": u.nombre, "correo": u.correo, "telefono": u.telefono,
            "codigo": u.codigo, "perfil": u.perfil,
            "ultimo_acceso": u.ultimo_acceso.strftime("%Y-%m-%d %H:%M") if u.ultimo_acceso else None,
            "pin_vence_en_dias": max(90 - dias_pin, 0),
            "idioma_voz": voz, "velocidad_voz": u.velocidad_voz,
            "confirmacion_hablada": bool(u.confirmacion_hablada)}


@app.get("/api/usuarios/yo/resumen")
def resumen_inicio(u: Usuario = Depends(usuario_actual)):
    hoy = ahora().date()
    inicio_mes = hoy.replace(day=1)
    with Sesion() as s:
        n_bodegas = s.query(AsignacionBodega).filter_by(usuario_id=u.id).count()
        sesiones_usr = [x.id for x in s.query(SesionConteo).filter_by(usuario_id=u.id).all()]
        ref_hoy = 0
        if sesiones_usr:
            ref_hoy = sum(1 for c in (s.query(Conteo)
                          .filter(Conteo.sesion_id.in_(sesiones_usr),
                                  Conteo.estado == "confirmado").all())
                          if c.creado.date() == hoy)
        alertas_abiertas = s.query(Alerta).filter_by(resuelta=0).count()
        # "Su exactitud del mes" tenia que decir de verdad SU exactitud (las
        # bodegas donde esta persona contó o auditó) y de verdad DEL MES
        # actual - antes promediaba el historial de cierres de TODAS las
        # bodegas de TODA la operación, sin filtrar ni por persona ni por
        # fecha, asi que un auxiliar nuevo sin ningun cierre propio veia el
        # mismo numero que la administradora con mas experiencia.
        bodegas_suyas = {ses.bodega_id for ses in s.query(SesionConteo)
                         .filter(SesionConteo.usuario_id == u.id).all()}
        historial_mes = (s.query(HistorialCierre)
                         .filter(HistorialCierre.bodega_id.in_(bodegas_suyas),
                                 HistorialCierre.fecha >= inicio_mes).all()
                         if bodegas_suyas else [])
        exact_mes = (round(sum(h.exactitud for h in historial_mes) / len(historial_mes), 1)
                     if historial_mes else 100.0)
    return {"bodegas_asignadas": n_bodegas, "referencias_hoy": ref_hoy,
            "alertas_por_revisar": alertas_abiertas, "exactitud_mes": exact_mes}


@app.put("/api/usuarios/yo/preferencias")
def guardar_preferencias(body: dict, u: Usuario = Depends(usuario_actual)):
    with Sesion() as s:
        usr = s.get(Usuario, u.id)
        for k in ("idioma_voz", "velocidad_voz"):
            if k in body:
                setattr(usr, k, body[k])
        if "confirmacion_hablada" in body:
            usr.confirmacion_hablada = 1 if body["confirmacion_hablada"] else 0
        s.commit()
    return {"ok": True}


@app.post("/api/usuarios/yo/marcar-clave-cambiada")
def marcar_clave_cambiada(u: Usuario = Depends(usuario_actual)):
    """Cognito es quien cambia la clave (Mi perfil o "olvide mi clave"),
    nunca este backend - pero el aviso de "su clave vence en N dias" (ver
    ver_perfil) se calcula desde pin_actualizado, que sin esta llamada se
    queda congelado en la fecha de creacion de la cuenta para siempre. El
    frontend llama esto justo despues de que Cognito confirma el cambio."""
    with Sesion() as s:
        usr = s.get(Usuario, u.id)
        usr.pin_actualizado = ahora()
        s.commit()
    return {"ok": True}


@app.post("/api/usuarios/yo/cerrar-todas")
def cerrar_todas_sesiones(u: Usuario = Depends(usuario_actual)):
    """Antes invalidaba con un contador propio (version_token) y devolvia
    un token nuevo firmado por nosotros; ahora la identidad la maneja
    Cognito, asi que se le pide a Cognito que revoque los refresh tokens
    de esta persona (AdminUserGlobalSignOut: nadie con sesion abierta en
    otro dispositivo puede volver a pedir un access token nuevo). El
    access token que ya tenia emitido cada dispositivo sigue firmando
    valido hasta que vence solo (el User Pool los emite con vida corta,
    1 hora, para que esa ventana sea chica)."""
    cliente = _cliente_cognito()
    try:
        cliente.admin_user_global_sign_out(UserPoolId=COGNITO_USER_POOL_ID, Username=u.nombre)
    except Exception as e:
        raise HTTPException(502, f"No se pudo cerrar las sesiones en este momento: {e}")
    registrar(u, "SEGURIDAD", "Sesion cerrada en todos los dispositivos")
    return {"ok": True}


def _tipo_imagen_real(contenido: bytes) -> str | None:
    """El Content-Type que manda el navegador lo elige quien sube el
    archivo, no el archivo: antes se guardaba y se devolvia tal cual al
    pedir la foto, asi que subir algo con Content-Type "text/html" lo
    serviria despues como HTML. Aqui se detecta el tipo real por los
    primeros bytes (firma del formato), no por lo que diga la cabecera."""
    if contenido.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if contenido.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if contenido.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if contenido[:4] == b"RIFF" and contenido[8:12] == b"WEBP":
        return "image/webp"
    return None


@app.post("/api/usuarios/yo/foto")
async def subir_foto(foto: UploadFile = File(...),
                     u: Usuario = Depends(usuario_actual)):
    contenido = await foto.read()
    if len(contenido) > 3 * 1024 * 1024:
        raise HTTPException(400, "La foto no puede pesar mas de 3 MB.")
    tipo_real = _tipo_imagen_real(contenido)
    if tipo_real is None:
        raise HTTPException(400, "El archivo no es una imagen valida (JPEG, PNG, GIF o WebP).")
    with Sesion() as s:
        usr = s.get(Usuario, u.id)
        usr.foto = contenido
        usr.foto_tipo = tipo_real
        s.commit()
    return {"ok": True}


@app.get("/api/usuarios/yo/foto")
def ver_foto(u: Usuario = Depends(usuario_actual)):
    with Sesion() as s:
        usr = s.get(Usuario, u.id)
        if not usr.foto:
            raise HTTPException(404, "Sin foto.")
        return Response(content=usr.foto, media_type=usr.foto_tipo or "image/jpeg")


@app.get("/api/voz/voces")
def voces_disponibles(u: Usuario = Depends(usuario_actual)):
    from agente.cerebro import VOCES, VOZ_DEFECTO
    return {"voces": [{"clave": k, **v} for k, v in VOCES.items()],
            "defecto": VOZ_DEFECTO}


class HablarIn(BaseModel):
    texto: str
    voz: str = "kore"


@app.post("/api/voz/hablar")
def api_hablar(body: HablarIn, u: Usuario = Depends(usuario_actual)):
    from agente.cerebro import sintetizar_voz
    texto = (body.texto or "").strip()
    if not texto:
        raise HTTPException(400, "Falta el texto.")
    wav = sintetizar_voz(texto, body.voz)
    if wav is None:
        raise HTTPException(503, "Voz neuronal no disponible en este momento.")
    return Response(content=wav, media_type="audio/wav")


def _filtro_traza(s, persona: str, accion: str, rango: str):
    q = s.query(Traza)
    if persona:
        q = q.filter_by(persona=persona)
    if accion:
        q = q.filter_by(accion=accion)
    if rango == "hoy":
        q = q.filter(Traza.creado >= ahora().replace(hour=0, minute=0, second=0))
    elif rango == "semana":
        q = q.filter(Traza.creado >= ahora() - timedelta(days=7))
    elif rango == "mes":
        q = q.filter(Traza.creado >= ahora() - timedelta(days=30))
    return q


@app.get("/api/trazabilidad")
def ver_traza(persona: str = "", accion: str = "", rango: str = "",
              u: Usuario = Depends(requiere_perfil("auditor"))):
    with Sesion() as s:
        q = _filtro_traza(s, persona, accion, rango)
        return [{"id": t.id, "hora": t.creado.strftime("%H:%M:%S"),
                 "persona": t.persona, "accion": t.accion,
                 "detalle": t.detalle, "tipo": t.tipo}
                for t in q.order_by(Traza.id.desc()).limit(200)]


@app.get("/api/trazabilidad/exportar")
def exportar_traza(persona: str = "", accion: str = "", rango: str = "",
                   formato: str = "xlsx",
                   u: Usuario = Depends(requiere_perfil("auditor"))):
    import pandas as pd
    from servicios.archivos import guardar_df
    with Sesion() as s:
        q = _filtro_traza(s, persona, accion, rango)
        filas = [{"fecha": t.creado.strftime("%Y-%m-%d %H:%M:%S"), "persona": t.persona,
                 "accion": t.accion, "detalle": t.detalle}
                for t in q.order_by(Traza.id.desc()).all()]
    df = pd.DataFrame(filas)
    marca = ahora().strftime("%Y%m%d_%H%M")
    ruta = f"reportes/trazabilidad_{marca}.{formato}"
    guardar_df(ruta, df, formato)
    registrar(u, "REPORTE", f"Registro de trazabilidad exportado: {ruta} ({len(df)} filas)")
    return {"archivo": ruta, "filas": len(df)}


@app.get("/api/ajustes")
def ver_ajustes(u: Usuario = Depends(usuario_actual)):
    with Sesion() as s:
        offline = s.get(ConfigClave, "offline")
        usuarios_activos = s.query(Usuario).filter_by(activo=1).count()
        aprobaciones_pend = s.query(Aprobacion).filter_by(estado="pendiente").count()
        pedidos_pend = (s.query(LineaServicio.numero_pedido)
                        .filter_by(estado="pendiente_aprobacion")
                        .distinct().count())
    return {"umbral": round(umbral_actual() * 100),
            "bloquear_negativos": True, "confirmar_alertas": True,
            "offline": (offline.valor == "1") if offline else True,
            "version": "1.0.0", "modelo": os.getenv("MODELO", "gemini-flash-latest"),
            "idioma_voz": os.getenv("IDIOMA_VOZ", "es-CO"),
            "base_datos": "SQLite",
            "usuarios_activos": usuarios_activos,
            "aprobaciones_pendientes": aprobaciones_pend + pedidos_pend}


@app.put("/api/ajustes")
def guardar_ajustes(body: dict, u: Usuario = Depends(requiere_perfil("auditor"))):
    with Sesion() as s:
        if "umbral" in body:
            valor = str(max(1, min(500, float(body["umbral"]))) / 100)
            existente = s.get(ConfigClave, "umbral_anomalia")
            if existente:
                existente.valor = valor
            else:
                s.add(ConfigClave(clave="umbral_anomalia", valor=valor))
        if "offline" in body:
            valor = "1" if body["offline"] else "0"
            existente = s.get(ConfigClave, "offline")
            if existente:
                existente.valor = valor
            else:
                s.add(ConfigClave(clave="offline", valor=valor))
        s.commit()
    registrar(u, "AJUSTE", "Configuracion del sistema actualizada", "ok")
    return {"ok": True}


# ─────────────────────── tablero en vivo ───────────────────────
conexiones: list[WebSocket] = []


def estado_bodegas():
    with Sesion() as s:
        return [{"bodega": b.nombre_oficial, "estado": b.estado, "id": b.id}
                for b in s.query(Bodega).order_by(Bodega.nombre_oficial).all()]


async def difundir_estado():
    for ws in list(conexiones):
        try:
            await ws.send_json(estado_bodegas())
        except Exception:
            if ws in conexiones:
                conexiones.remove(ws)


@app.websocket("/api/bodegas/estado")
async def ws_estado(ws: WebSocket):
    from seguridad import verificar_token
    if not verificar_token(ws.query_params.get("token")):
        await ws.close(code=1008)
        return
    await ws.accept()
    conexiones.append(ws)
    await ws.send_json(estado_bodegas())
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        if ws in conexiones:
            conexiones.remove(ws)
