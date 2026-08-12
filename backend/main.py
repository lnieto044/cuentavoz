"""La API de CuentaVoz. Aqui se conectan la tableta, el agente y la base."""
import os
import secrets
from datetime import datetime, timedelta

from dotenv import load_dotenv
load_dotenv()

from fastapi import (FastAPI, WebSocket, WebSocketDisconnect, Depends,
                     HTTPException, UploadFile, File, Request)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from bd import Sesion, iniciar_bd
from modelos import (Usuario, Bodega, Articulo, StockSistema, SesionConteo,
                     Conteo, Alerta, Traza, LineaServicio, AsignacionBodega,
                     Aprobacion, HistorialCierre, ConfigClave,
                     Receta, RecetaIngrediente, CredencialWebAuthn)
from seguridad import (hash_clave, verificar_clave, crear_token,
                       usuario_actual, requiere_perfil, registrar)
from agente.orquestador import procesar_turno, ESTADOS, avance
from servicios.recetas import (calcular_pedido, comparar_legalizacion,
                               analisis_consumo, detalle_receta)
from servicios.validacion import umbral_actual
from servicios import analitica, huella
import reportes

app = FastAPI(title="CuentaVoz", version="1.0.0",
              description="Asistente por voz para inventarios · Colsubsidio")

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

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


@app.on_event("startup")
def arranque():
    iniciar_bd()
    with Sesion() as s:
        if s.query(Usuario).count() == 0:
            s.add_all([
                Usuario(nombre="luis", perfil="auxiliar",
                        clave_hash=hash_clave("StockXperts"),
                        correo="lnieto@colsubsidio.com", codigo="CS-48127"),
                Usuario(nombre="diana", perfil="auditor",
                        clave_hash=hash_clave("StockXperts"),
                        correo="diana@colsubsidio.com", codigo="CS-48200"),
                Usuario(nombre="stephanie", perfil="auxiliar",
                        clave_hash=hash_clave("StockXperts"), codigo="CS-48311"),
                Usuario(nombre="valentina", perfil="auxiliar",
                        clave_hash=hash_clave("StockXperts"), codigo="CS-48342"),
            ])
            s.commit()
            print("[arranque] usuarios de prueba creados (clave StockXperts)")

        # bodegas asignadas por persona: solo la primera vez, y solo si ya
        # hay bodegas cargadas (cargar_excel.py corre antes que la API)
        if s.query(AsignacionBodega).count() == 0 and s.query(Bodega).count() > 0:
            bodegas = s.query(Bodega).order_by(Bodega.nombre_oficial).all()
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
            base = datetime.now() - timedelta(days=120)
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
                "gemini": bool(os.getenv("GOOGLE_API_KEY", "").strip())}


# ─────────────────────── identidad ───────────────────────
def _buscar_usuario_por_entrada(s, entrada: str):
    """Se puede ingresar con el nombre de usuario o con el codigo de
    empleado (ej. CS-48127) - lo que la persona tenga a la mano."""
    entrada = entrada.strip()
    return s.query(Usuario).filter(
        (Usuario.nombre == entrada.lower()) | (Usuario.codigo == entrada.upper())
    ).first()


@app.post("/api/ingresar")
@limiter.limit("5/minute")
def ingresar(request: Request, form: OAuth2PasswordRequestForm = Depends()):
    with Sesion() as s:
        u = _buscar_usuario_por_entrada(s, form.username)
        if not u or not verificar_clave(form.password, u.clave_hash):
            raise HTTPException(401, "Usuario o clave incorrectos.")
        if not u.activo:
            raise HTTPException(403, "Ese usuario esta inactivo.")
        u.ultimo_acceso = datetime.now()
        s.commit()
        s.refresh(u)
    registrar(u, "INGRESO", f"{u.nombre} inicio sesion")
    return {"token": crear_token(u), "perfil": u.perfil,
            "usuario": {"id": u.id, "nombre": u.nombre, "perfil": u.perfil}}


@app.get("/api/usuarios/perfil")
@limiter.limit("20/minute")
def perfil_por_usuario(request: Request, usuario: str = ""):
    """Para que la pantalla de ingreso muestre «Auxiliar» o «Administrador»
    apenas se escribe el usuario, sin esperar a iniciar sesion. Solo
    devuelve el perfil y si tiene huella (nada mas sensible: ni nombre, ni
    correo) y esta limitado por minuto para no servir de lista para
    adivinar usuarios validos."""
    if not usuario.strip():
        return {"perfil": None, "tiene_huella": False}
    with Sesion() as s:
        u = _buscar_usuario_por_entrada(s, usuario)
        if not u or not u.activo:
            return {"perfil": None, "tiene_huella": False}
        tiene_huella = s.query(CredencialWebAuthn).filter_by(usuario_id=u.id).first() is not None
    return {"perfil": u.perfil, "tiene_huella": tiene_huella}


@app.get("/api/auth/huella/opciones")
@limiter.limit("20/minute")
def opciones_ingreso_huella(request: Request, usuario: str = ""):
    """Paso 1 del ingreso con huella: reto para navigator.credentials.get()."""
    with Sesion() as s:
        u = _buscar_usuario_por_entrada(s, usuario)
        if not u or not u.activo:
            raise HTTPException(404, "No hay una huella registrada para ese usuario.")
        credenciales = [c.credential_id for c in
                        s.query(CredencialWebAuthn).filter_by(usuario_id=u.id).all()]
    if not credenciales:
        raise HTTPException(404, "No hay una huella registrada para ese usuario.")
    reto_id, opciones = huella.opciones_ingreso(u.id, credenciales)
    return {"reto_id": reto_id, "opciones": opciones}


class VerificarHuellaIn(BaseModel):
    reto_id: str
    credencial: dict


@app.post("/api/auth/huella/verificar")
@limiter.limit("10/minute")
def verificar_ingreso_huella(request: Request, datos: VerificarHuellaIn):
    cred_id = datos.credencial.get("id") if isinstance(datos.credencial, dict) else None
    with Sesion() as s:
        registro = s.query(CredencialWebAuthn).filter_by(credential_id=cred_id).first()
        if not registro:
            raise HTTPException(401, "Credencial de huella no reconocida.")
        try:
            usuario_id, nuevo_conteo = huella.verificar_ingreso(
                datos.reto_id, datos.credencial, registro.public_key, registro.sign_count)
        except Exception as e:
            raise HTTPException(401, f"No se pudo verificar la huella: {e}")
        if usuario_id != registro.usuario_id:
            raise HTTPException(401, "Credencial de huella no reconocida.")
        registro.sign_count = nuevo_conteo
        u = s.get(Usuario, usuario_id)
        if not u.activo:
            raise HTTPException(403, "Ese usuario esta inactivo.")
        u.ultimo_acceso = datetime.now()
        s.commit()
        s.refresh(u)
    registrar(u, "INGRESO", f"{u.nombre} inicio sesion con huella")
    return {"token": crear_token(u), "perfil": u.perfil,
            "usuario": {"id": u.id, "nombre": u.nombre, "perfil": u.perfil}}


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
    r = procesar_turno(t.texto, t.sesion_id, u,
                       opciones_respaldo=t.opciones_pendientes,
                       opciones_para_respaldo=t.opciones_para,
                       bodega_id_respaldo=t.bodega_id_respaldo,
                       bodega_nombre_respaldo=t.bodega_nombre_respaldo,
                       preparacion_respaldo=t.preparacion_respaldo,
                       porciones_respaldo=t.porciones_respaldo)
    if r.get("bodega"):
        await difundir_estado()
    return r


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


class CrearProductoIn(BaseModel):
    nombre: str
    unidad_medida: str
    cantidad_inicial: float
    sesion_id: int = 1


@app.post("/api/conteo/crear-producto")
def crear_producto_pendiente(p: CrearProductoIn, u: Usuario = Depends(usuario_actual)):
    """El conteo no se detiene: el producto entra pendiente y sigue contando."""
    est = ESTADOS.get(p.sesion_id, {})
    bodega_id = est.get("bodega_id")
    if not bodega_id:
        raise HTTPException(409, "Abra una bodega antes de crear un producto.")
    if p.cantidad_inicial < 0:
        raise HTTPException(400, "La cantidad inicial no puede ser negativa.")
    codigo = f"PEND-{datetime.now().strftime('%H%M%S%f')[:10]}"
    with Sesion() as s:
        s.add(Articulo(codigo=codigo, nombre_oficial=p.nombre.upper().strip(),
                       unidad_medida=p.unidad_medida))
        s.commit()
        conteo = Conteo(sesion_id=p.sesion_id, articulo_codigo=codigo,
                        cantidad=p.cantidad_inicial, unidad=p.unidad_medida,
                        estado="pendiente_aprobacion")
        s.add(conteo)
        s.commit()
        s.refresh(conteo)
        s.add(Aprobacion(tipo="producto", nombre=p.nombre.upper().strip(),
                         unidad_medida=p.unidad_medida, cantidad_inicial=p.cantidad_inicial,
                         bodega_id=bodega_id, articulo_codigo=codigo,
                         conteo_id=conteo.id, creado_por_id=u.id))
        s.commit()
    registrar(u, "CREACION", f"{p.nombre.upper()} creado, pendiente de aprobacion")
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


@app.post("/api/bodegas/abrir")
async def abrir(a: AbrirIn, u: Usuario = Depends(usuario_actual)):
    with Sesion() as s:
        b = (s.query(Bodega)
             .filter(Bodega.nombre_oficial.contains(a.bodega.upper())).first())
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
    """Igual que crear_producto_pendiente: la bodega no se crea de una,
    queda pendiente de aprobacion del administrador (Aprobacion tipo
    "bodega", ya soportada en aprobar()/rechazar()) - asi el catalogo de
    bodegas no crece con lo que cualquiera escriba sin control."""
    nombre = p.nombre.upper().strip()
    if not nombre:
        raise HTTPException(400, "Dígame el nombre de la bodega.")
    with Sesion() as s:
        if s.query(Bodega).filter_by(nombre_oficial=nombre).first():
            raise HTTPException(409, "Ya existe una bodega con ese nombre.")
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
                    "hora": ses.fin.strftime("%H:%M") if ses.fin else None,
                    "huella": bool(au and au.huella_registrada)}

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
        ses.fin = datetime.now()
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
        ses.fin = datetime.now()
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
                ses.fin = datetime.now()
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
        vistos = {t.id for t in hitos_t}
        for ses in sesiones:
            if not ses.usuario_id:
                continue
            fin = ses.fin or datetime.now()
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
    from servicios.conciliacion import buscar_articulo
    cand = buscar_articulo(q)
    if not cand:
        return {"resumen": "No encontre ese articulo en el catalogo.", "bodegas": []}
    # si la persona ya eligio una de las alternativas, usa esa; si no, la mejor
    a = next((c for c in cand if c["codigo"] == codigo), None) or cand[0]
    hoy = datetime.now().date()
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
        hace_30 = datetime.now() - timedelta(days=30)
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
        titulo, subtitulo = "Detalle de bodega", "Exportado"
    else:
        titulo, subtitulo = "Reporte", "Exportado"
    return {"titulo": titulo, "subtitulo": subtitulo, "archivo": archivo, "filas": filas,
            "formato": archivo.rsplit(".", 1)[-1].upper() if "." in archivo else "?",
            "hora": t.creado.strftime("%H:%M"), "persona": (t.persona or "").title()}


@app.get("/api/reportes/recientes")
def reportes_recientes(u: Usuario = Depends(requiere_perfil("auditor"))):
    """El historial real de archivos generados (via pantalla o por voz),
    leido de la trazabilidad - para que la lista sobreviva a salir de la
    pantalla o recargar, en vez de vivir solo en el estado del componente."""
    with Sesion() as s:
        trazas = (s.query(Traza).filter_by(accion="REPORTE")
                 .order_by(Traza.id.desc()).limit(20).all())
    salida = [_parsear_archivo_reporte(t) for t in trazas]
    return [x for x in salida if x][:10]


@app.post("/api/bodegas/{bodega_id}/exportar-detalle")
def exportar_detalle_bodega(bodega_id: int, formato: str = "xlsx",
                            u: Usuario = Depends(requiere_perfil("auditor"))):
    ruta = reportes.detalle_bodega(bodega_id, formato)
    registrar(u, "REPORTE", f"Detalle de bodega {bodega_id} exportado: {ruta}")
    return {"archivo": ruta}


@app.get("/api/reportes/descargar")
def descargar(archivo: str, u: Usuario = Depends(requiere_perfil("auditor"))):
    if ".." in archivo or not archivo.startswith("reportes/"):
        raise HTTPException(400, "Ruta no permitida.")
    if not os.path.exists(archivo):
        raise HTTPException(404, "Archivo no encontrado.")
    return FileResponse(archivo, filename=os.path.basename(archivo))


@app.get("/api/reportes/vista-previa")
def vista_previa_reporte(archivo: str, u: Usuario = Depends(requiere_perfil("auditor"))):
    """Para poder ver el contenido de cualquier archivo ya generado (no solo
    el que se acaba de crear) con solo dar clic en su tarjeta, sin tener
    que descargarlo primero. Lee el archivo tal cual quedo guardado, asi
    que la vista previa de un reporte viejo muestra lo que ese reporte
    realmente tenia, no el estado actual de la base."""
    if ".." in archivo or not archivo.startswith("reportes/"):
        raise HTTPException(400, "Ruta no permitida.")
    if not os.path.exists(archivo):
        raise HTTPException(404, "Archivo no encontrado.")
    import pandas as pd
    df = pd.read_csv(archivo) if archivo.endswith(".csv") else pd.read_excel(archivo)
    df = df.fillna(0)
    return {"filas": df.head(8).to_dict("records"), "total": len(df)}


# ─────────────────────── los tres momentos ───────────────────────
class PedidoIn(BaseModel):
    plato: str
    porciones: int
    bodega_id: int = 1


@app.post("/api/pedidos/calcular")
def api_calcular(p: PedidoIn, u: Usuario = Depends(usuario_actual)):
    return calcular_pedido(p.plato, p.porciones, p.bodega_id)


@app.post("/api/pedidos/enviar")
def api_enviar(body: dict, u: Usuario = Depends(usuario_actual)):
    sid = body.get("servicio_id", 1)
    plato = body.get("plato", "")
    porciones = body.get("porciones", 0)
    bodega_id = body.get("bodega_id")
    with Sesion() as s:
        # si el mismo pedido (servicio + plato + porciones) ya quedo abierto
        # O esperando aprobacion, no lo duplica: cubre un doble clic, un
        # doble disparo por voz, o un reintento tras una desconexion que si
        # alcanzo a llegar la primera vez.
        ya_existe = (s.query(LineaServicio)
                    .filter_by(servicio_id=sid, plato=plato, porciones=porciones)
                    .filter(LineaServicio.estado.in_(["abierto", "pendiente_aprobacion"]))
                    .first())
        if ya_existe:
            return {"ok": True, "duplicado": True}
        # un auxiliar pide, pero es el administrador quien de verdad autoriza
        # que salga del almacen - igual que ya pasa con productos y bodegas
        # creados en plena toma. El administrador autoriza su propio pedido
        # de una vez: no tiene sentido pedirse permiso a si mismo.
        estado_inicial = "abierto" if u.perfil == "auditor" else "pendiente_aprobacion"
        numero = f"PED-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        n = 0
        items = []
        for l in body.get("lineas", []):
            if (l.get("falta") or 0) > 0:
                s.add(LineaServicio(servicio_id=sid,
                                    articulo_codigo=l["codigo"],
                                    nombre=l["nombre"], pedido=l["falta"],
                                    plato=plato, porciones=porciones,
                                    estado=estado_inicial, bodega_id=bodega_id,
                                    creado_por_id=u.id, numero_pedido=numero))
                items.append({"nombre": l["nombre"], "cantidad": l["falta"],
                             "unidad": l.get("unidad", "")})
                n += 1
        s.commit()
        bodega_nombre = None
        if bodega_id:
            b = s.get(Bodega, bodega_id)
            bodega_nombre = b.nombre_oficial if b else None
    if estado_inicial == "pendiente_aprobacion":
        registrar(u, "PEDIDO", f"Pedido {numero} enviado, pendiente de aprobacion ({n} lineas)")
    else:
        registrar(u, "PEDIDO", f"Pedido {numero} enviado y aprobado ({n} lineas)")
    return {"ok": True, "numero_pedido": numero, "estado": estado_inicial,
            "hora": datetime.now().strftime("%H:%M"),
            "bodega": bodega_nombre, "persona": u.nombre,
            "items": items, "total_lineas": n}


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
        for l in s.query(LineaServicio).filter_by(servicio_id=sid, estado="abierto").all():
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
        filas = s.query(LineaServicio).filter_by(servicio_id=sid, estado="abierto").all()
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
    datos = analisis_consumo(dias)
    df = pd.DataFrame(datos["subutilizados"])
    os.makedirs("reportes", exist_ok=True)
    marca = datetime.now().strftime("%Y%m%d_%H%M")
    ruta = f"reportes/analisis_consumo_{marca}.{formato}"
    if formato == "csv":
        df.to_csv(ruta, index=False)
    else:
        df.to_excel(ruta, index=False)
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
    for ing in ingredientes:
        if s.get(Articulo, ing.articulo_codigo) is None:
            raise HTTPException(400, f"El artículo {ing.articulo_codigo} no existe en el catálogo.")
        if ing.cantidad_por_porcion <= 0:
            raise HTTPException(400, "La cantidad por porción debe ser mayor que cero.")


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
    hoy = datetime.now().date()
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
        a.resuelto = datetime.now()
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
    # sin esto, todo usuario creado desde Ajustes (la pantalla nunca pide
    # un PIN) quedaba con la misma clave de siempre - la misma que
    # aparece publicada en el README para las cuentas de demostracion.
    # Un temporal aleatorio, distinto cada vez, obliga a que quien lo
    # reciba lo cambie por uno propio desde Mi perfil.
    pin_generado = None
    if datos.pin is None:
        pin_generado = secrets.token_urlsafe(6)
        pin_para_guardar = pin_generado
    else:
        pin_para_guardar = datos.pin
    if len(pin_para_guardar) < 6:
        raise HTTPException(400, "El PIN debe tener al menos 6 digitos.")
    with Sesion() as s:
        if s.query(Usuario).filter_by(nombre=nombre).first():
            raise HTTPException(409, "Ya existe un usuario con ese nombre.")
        nuevo = Usuario(nombre=nombre, perfil=datos.perfil,
                        clave_hash=hash_clave(pin_para_guardar), correo=datos.correo)
        s.add(nuevo)
        s.commit()
        s.refresh(nuevo)
        nid = nuevo.id
        # codigo de empleado: para poder ingresar con el ademas del nombre
        nuevo.codigo = f"CS-{48000 + nid}"
        s.commit()
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
            obj.correo = datos.correo
            cambios.append("correo")
        if datos.perfil is not None and datos.perfil != obj.perfil:
            obj.perfil = datos.perfil
            cambios.append(f"perfil -> {datos.perfil}")
        if datos.activo is not None and bool(datos.activo) != bool(obj.activo):
            obj.activo = int(datos.activo)
            obj.version_token = (obj.version_token or 0) + 1  # cierra sus sesiones vivas
            cambios.append("activo" if datos.activo else "inactivo")
        s.commit()
        nombre = obj.nombre
    if cambios:
        registrar(u, "USUARIO", f"{nombre} editado: {', '.join(cambios)}", "ok")
    return {"ok": True}


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
        a.resuelto = datetime.now()
        if a.tipo == "producto" and a.articulo_codigo:
            existe = s.query(StockSistema).filter_by(
                articulo_codigo=a.articulo_codigo, bodega_id=a.bodega_id).first()
            if not existe:
                s.add(StockSistema(articulo_codigo=a.articulo_codigo,
                                   bodega_id=a.bodega_id, cantidad_sd=0))
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
        a.resuelto = datetime.now()
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
    dias_pin = (datetime.now() - (u.pin_actualizado or datetime.now())).days
    # idioma_voz guardaba un codigo de idioma de navegador (es-MX, es-CO...)
    # de cuando la voz salia por speechSynthesis; ahora guarda la clave de
    # la voz neuronal elegida (kore, puck...). Una cuenta con el valor
    # viejo cae a la voz por defecto en vez de romper el selector.
    voz = u.idioma_voz if u.idioma_voz in VOCES else VOZ_DEFECTO
    return {"nombre": u.nombre, "correo": u.correo, "telefono": u.telefono,
            "codigo": u.codigo, "perfil": u.perfil,
            "ultimo_acceso": u.ultimo_acceso.strftime("%Y-%m-%d %H:%M") if u.ultimo_acceso else None,
            "pin_vence_en_dias": max(90 - dias_pin, 0),
            "huella_registrada": bool(u.huella_registrada),
            "idioma_voz": voz, "velocidad_voz": u.velocidad_voz,
            "confirmacion_hablada": bool(u.confirmacion_hablada)}


@app.get("/api/usuarios/yo/resumen")
def resumen_inicio(u: Usuario = Depends(usuario_actual)):
    hoy = datetime.now().date()
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
        historial = s.query(HistorialCierre).all()
        exact_mes = (round(sum(h.exactitud for h in historial) / len(historial), 1)
                     if historial else 100.0)
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


@app.post("/api/usuarios/yo/huella/opciones")
@limiter.limit("10/minute")
def opciones_registro_huella(request: Request, u: Usuario = Depends(usuario_actual)):
    """Paso 1 del registro: reto de WebAuthn para navigator.credentials.create()."""
    with Sesion() as s:
        existentes = [c.credential_id for c in
                     s.query(CredencialWebAuthn).filter_by(usuario_id=u.id).all()]
    return huella.opciones_registro(u.id, u.nombre, existentes)


@app.post("/api/usuarios/yo/huella/verificar")
@limiter.limit("10/minute")
def verificar_registro_huella(request: Request, credencial: dict, u: Usuario = Depends(usuario_actual)):
    """Paso 2: verifica la respuesta del navegador y guarda la credencial."""
    try:
        verificado = huella.verificar_registro(u.id, credencial)
    except Exception as e:
        raise HTTPException(400, f"No se pudo registrar la huella: {e}")
    with Sesion() as s:
        s.add(CredencialWebAuthn(usuario_id=u.id, credential_id=verificado["credential_id"],
                                 public_key=verificado["public_key"],
                                 sign_count=verificado["sign_count"]))
        usr = s.get(Usuario, u.id)
        usr.huella_registrada = 1
        s.commit()
    registrar(u, "SEGURIDAD", f"{u.nombre} registro una huella en este dispositivo", "ok")
    return {"ok": True}


@app.delete("/api/usuarios/yo/huella")
def eliminar_huella(u: Usuario = Depends(usuario_actual)):
    with Sesion() as s:
        s.query(CredencialWebAuthn).filter_by(usuario_id=u.id).delete()
        usr = s.get(Usuario, u.id)
        usr.huella_registrada = 0
        s.commit()
    registrar(u, "SEGURIDAD", f"{u.nombre} elimino sus huellas registradas", "ok")
    return {"ok": True}


@app.post("/api/usuarios/yo/cerrar-todas")
def cerrar_todas_sesiones(u: Usuario = Depends(usuario_actual)):
    with Sesion() as s:
        usr = s.get(Usuario, u.id)
        usr.version_token = (usr.version_token or 0) + 1
        s.commit()
    registrar(u, "SEGURIDAD", "Sesion cerrada en todos los dispositivos")
    return {"ok": True, "token": crear_token(usr)}


@app.put("/api/usuarios/yo/pin")
@limiter.limit("5/minute")
def cambiar_pin(request: Request, body: dict, u: Usuario = Depends(usuario_actual)):
    pin = str(body.get("pin", ""))
    if len(pin) < 6:
        raise HTTPException(400, "El PIN debe tener al menos 6 digitos.")
    with Sesion() as s:
        usr = s.get(Usuario, u.id)
        # sin esto, cualquiera con el token abierto (tableta compartida sin
        # bloquear, token filtrado) podia tomarse la cuenta por completo con
        # solo mandar un PIN nuevo - ni siquiera hacia falta saber el viejo.
        if not verificar_clave(str(body.get("pin_actual", "")), usr.clave_hash):
            raise HTTPException(401, "El PIN actual no es correcto.")
        usr.clave_hash = hash_clave(pin)      # nunca en texto plano
        usr.version_token = (usr.version_token or 0) + 1  # cierra sesiones con el PIN viejo
        s.commit()
        nuevo_token = crear_token(usr)
    registrar(u, "SEGURIDAD", "PIN actualizado")
    return {"ok": True, "token": nuevo_token}


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
        q = q.filter(Traza.creado >= datetime.now().replace(hour=0, minute=0, second=0))
    elif rango == "semana":
        q = q.filter(Traza.creado >= datetime.now() - timedelta(days=7))
    elif rango == "mes":
        q = q.filter(Traza.creado >= datetime.now() - timedelta(days=30))
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
    with Sesion() as s:
        q = _filtro_traza(s, persona, accion, rango)
        filas = [{"fecha": t.creado.strftime("%Y-%m-%d %H:%M:%S"), "persona": t.persona,
                 "accion": t.accion, "detalle": t.detalle}
                for t in q.order_by(Traza.id.desc()).all()]
    df = pd.DataFrame(filas)
    os.makedirs("reportes", exist_ok=True)
    marca = datetime.now().strftime("%Y%m%d_%H%M")
    ruta = f"reportes/trazabilidad_{marca}.{formato}"
    if formato == "csv":
        df.to_csv(ruta, index=False)
    else:
        df.to_excel(ruta, index=False)
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
            "refresco_pbi": "15 minutos",
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
