"""La API de CuentaVoz. Aqui se conectan la tableta, el agente y la base."""
import os
from datetime import datetime

from dotenv import load_dotenv
load_dotenv()

from fastapi import (FastAPI, WebSocket, WebSocketDisconnect, Depends,
                     HTTPException, UploadFile, File, Request)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from bd import Sesion, iniciar_bd
from modelos import (Usuario, Bodega, Articulo, StockSistema, SesionConteo,
                     Conteo, Alerta, Traza, LineaServicio, AsignacionBodega,
                     Aprobacion, HistorialCierre, ConfigClave)
from seguridad import (hash_clave, verificar_clave, crear_token,
                       usuario_actual, requiere_perfil, registrar)
from agente.orquestador import procesar_turno, ESTADOS, avance
from servicios.recetas import (calcular_pedido, comparar_legalizacion,
                               analisis_consumo, detalle_receta)
from servicios.validacion import umbral_actual
from servicios import analitica
import reportes

app = FastAPI(title="CuentaVoz", version="1.0.0",
              description="Asistente por voz para inventarios · Colsubsidio")

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("ORIGEN_PERMITIDO", "http://localhost:5173"),
                   "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)


@app.middleware("http")
async def cabeceras(request: Request, llamar):
    resp = await llamar(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "SAMEORIGIN"
    resp.headers["Referrer-Policy"] = "no-referrer"
    return resp


@app.on_event("startup")
def arranque():
    iniciar_bd()
    with Sesion() as s:
        if s.query(Usuario).count() == 0:
            s.add_all([
                Usuario(nombre="luis", perfil="auxiliar",
                        clave_hash=hash_clave("123456"),
                        correo="lnieto@colsubsidio.com", codigo="CS-48127"),
                Usuario(nombre="diana", perfil="auditor",
                        clave_hash=hash_clave("123456"),
                        correo="diana@colsubsidio.com", codigo="CS-48200"),
                Usuario(nombre="stephanie", perfil="auxiliar",
                        clave_hash=hash_clave("123456"), codigo="CS-48311"),
                Usuario(nombre="valentina", perfil="auxiliar",
                        clave_hash=hash_clave("123456"), codigo="CS-48342"),
            ])
            s.commit()
            print("[arranque] usuarios de prueba creados (clave 123456)")

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
@app.post("/api/ingresar")
@limiter.limit("5/minute")
def ingresar(request: Request, form: OAuth2PasswordRequestForm = Depends()):
    with Sesion() as s:
        u = s.query(Usuario).filter_by(nombre=form.username.strip().lower()).first()
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


# ─────────────────────── el agente ───────────────────────
class TurnoIn(BaseModel):
    texto: str
    sesion_id: int = 1


@app.post("/api/agente/turno")
async def turno(t: TurnoIn, u: Usuario = Depends(usuario_actual)):
    r = procesar_turno(t.texto, t.sesion_id, u)
    if r.get("bodega"):
        await difundir_estado()
    return r


@app.get("/api/sesiones/{sesion_id}/avance")
def ver_avance(sesion_id: int, u: Usuario = Depends(usuario_actual)):
    est = ESTADOS.get(sesion_id, {})
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


@app.get("/api/bodegas")
def listar_bodegas(u: Usuario = Depends(usuario_actual)):
    with Sesion() as s:
        salida = []
        for b in s.query(Bodega).order_by(Bodega.nombre_oficial).all():
            refs = s.query(StockSistema).filter_by(bodega_id=b.id).count()
            salida.append({"id": b.id, "bodega": b.nombre_oficial,
                           "estado": b.estado, "referencias": refs})
    return salida


@app.post("/api/bodegas/abrir")
async def abrir(a: AbrirIn, u: Usuario = Depends(usuario_actual)):
    with Sesion() as s:
        b = (s.query(Bodega)
             .filter(Bodega.nombre_oficial.contains(a.bodega.upper())).first())
        if b is None:
            raise HTTPException(404, "No encuentro esa bodega.")
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


def _ultima_sesion(s, bodega_id: int, tipo: str):
    return (s.query(SesionConteo).filter_by(bodega_id=bodega_id, tipo=tipo)
            .order_by(SesionConteo.id.desc()).first())


@app.get("/api/bodegas/{bodega_id}/firmas")
def ver_firmas(bodega_id: int, u: Usuario = Depends(usuario_actual)):
    with Sesion() as s:
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
        return {"conteo": _lado(conteo), "auditoria": _lado(auditoria),
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
        for cod in codigos:
            art = s.get(Articulo, cod)
            st = s.query(StockSistema).filter_by(articulo_codigo=cod, bodega_id=bodega_id).first()
            sistema = st.cantidad_sd if st else 0
            c1, c2 = m1.get(cod), m2.get(cod)
            autoridad = c2 if c2 is not None else c1
            dif = round((autoridad or 0) - sistema, 3)
            if abs(dif) < 0.01 and (c1 == c2 or c2 is None):
                continue
            filas.append({"codigo": cod, "articulo": art.nombre_oficial if art else cod,
                          "conteo1": c1, "conteo2": c2, "sistema": sistema,
                          "diferencia": dif,
                          "accion": "Revisar" if (c1 is not None and c2 is not None and c1 != c2)
                                    else "Aceptar"})
    filas.sort(key=lambda f: -abs(f["diferencia"]))
    return {"filas": filas, "coinciden": len(codigos) - len(filas) if codigos else 0,
            "total": len(codigos)}


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
        b.estado = "en_conteo"
        s.commit()
        nombre = b.nombre_oficial
    registrar(u, "REAPERTURA", f"{nombre} reabierta - motivo: {motivo}", "alerta")
    await difundir_estado()
    return {"ok": True, "bodega": nombre}


@app.get("/api/bodegas/{bodega_id}/detalle")
def detalle_bodega(bodega_id: int, u: Usuario = Depends(usuario_actual)):
    with Sesion() as s:
        b = s.get(Bodega, bodega_id)
        if b is None:
            raise HTTPException(404, "Bodega no encontrada.")
        total = s.query(StockSistema).filter_by(bodega_id=bodega_id).count()
        conteos = (s.query(Conteo).join(SesionConteo)
                   .filter(SesionConteo.bodega_id == bodega_id,
                           Conteo.estado == "confirmado").all())
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
        hitos = [{"hora": t.creado.strftime("%H:%M"), "texto": t.detalle,
                  "tipo": t.tipo}
                 for t in s.query(Traza).filter(
                     Traza.detalle.contains(b.nombre_oficial)).all()]
        exact = round((len(conteos) - len(difs)) / len(conteos) * 100, 1) if conteos else 0
        return {"bodega": b.nombre_oficial, "estado": b.estado,
                "referencias": total, "contadas": len(conteos),
                "exactitud": f"{exact} %", "diferencias": difs, "hitos": hitos}


# ─────────────────────── consultas y reportes ───────────────────────
@app.get("/api/articulos/consulta")
def consulta_articulo(q: str, u: Usuario = Depends(usuario_actual)):
    from servicios.conciliacion import buscar_articulo
    cand = buscar_articulo(q)
    if not cand:
        return {"resumen": "No encontre ese articulo en el catalogo.", "bodegas": []}
    a = cand[0]
    with Sesion() as s:
        filas = s.query(StockSistema).filter_by(articulo_codigo=a["codigo"]).all()
        total = sum(f.cantidad_sd or 0 for f in filas)
        det = []
        for f in filas:
            b = s.get(Bodega, f.bodega_id)
            det.append({"bodega": b.nombre_oficial if b else "?",
                        "cantidad": f.cantidad_sd, "estado": b.estado if b else "?"})
    return {"articulo": a["nombre"], "unidad": a["unidad"], "total": total,
            "bodegas": det,
            "resumen": f"{a['nombre']}: {total:g} {a['unidad']} en {len(filas)} bodegas."}


@app.post("/api/reportes")
def reporte(formato: str = "xlsx", u: Usuario = Depends(usuario_actual)):
    ruta = reportes.consolidado(formato)
    registrar(u, "REPORTE", f"Consolidado generado: {ruta}")
    return {"archivo": ruta}


@app.get("/api/reportes/descargar")
def descargar(archivo: str, u: Usuario = Depends(usuario_actual)):
    if ".." in archivo or not archivo.startswith("reportes/"):
        raise HTTPException(400, "Ruta no permitida.")
    if not os.path.exists(archivo):
        raise HTTPException(404, "Archivo no encontrado.")
    return FileResponse(archivo, filename=os.path.basename(archivo))


# ─────────────────────── los tres momentos ───────────────────────
class PedidoIn(BaseModel):
    plato: str
    porciones: int
    bodega_id: int = 1


@app.post("/api/pedidos/calcular")
def api_calcular(p: PedidoIn, u: Usuario = Depends(usuario_actual)):
    return {"lineas": calcular_pedido(p.plato, p.porciones, p.bodega_id)}


@app.post("/api/pedidos/enviar")
def api_enviar(body: dict, u: Usuario = Depends(usuario_actual)):
    with Sesion() as s:
        for l in body.get("lineas", []):
            if (l.get("falta") or 0) > 0:
                s.add(LineaServicio(servicio_id=body.get("servicio_id", 1),
                                    articulo_codigo=l["codigo"],
                                    nombre=l["nombre"], pedido=l["falta"]))
        s.commit()
    registrar(u, "PEDIDO", f"Pedido enviado al almacen ({len(body.get('lineas', []))} lineas)")
    return {"ok": True}


@app.get("/api/legalizacion/{servicio_id}")
def api_legalizacion(servicio_id: int, u: Usuario = Depends(usuario_actual)):
    return comparar_legalizacion(servicio_id)


@app.post("/api/legalizacion/confirmar")
def api_confirmar(body: dict, u: Usuario = Depends(usuario_actual)):
    sid = body.get("servicio_id", 1)
    with Sesion() as s:
        for l in s.query(LineaServicio).filter_by(servicio_id=sid).all():
            dif = (l.usado or 0) - (l.pedido or 0)
            if dif < 0:                       # sobrante: vuelve a bodega
                st = s.query(StockSistema).filter_by(
                    articulo_codigo=l.articulo_codigo).first()
                if st:
                    st.cantidad_sd = (st.cantidad_sd or 0) + abs(dif)
            l.estado = "legalizado"
        s.commit()
    registrar(u, "LEGALIZACION", f"Servicio {sid} legalizado", "ok")
    return {"ok": True}


@app.get("/api/analisis/consumo")
def api_analisis(u: Usuario = Depends(usuario_actual)):
    return analisis_consumo()


@app.get("/api/pedidos/receta")
def api_receta(plato: str, u: Usuario = Depends(usuario_actual)):
    return detalle_receta(plato)


@app.get("/api/reportes/diferencias-por-bodega")
def api_diferencias_por_bodega(u: Usuario = Depends(usuario_actual)):
    return analitica.diferencias_por_bodega(limite=50)


@app.get("/api/panel/resumen")
def api_panel_resumen(u: Usuario = Depends(usuario_actual)):
    return analitica.resumen_ejecutivo()


@app.get("/api/panel/alertas")
def api_panel_alertas(u: Usuario = Depends(usuario_actual)):
    return analitica.resumen_alertas_panel()


# ─────────────────────── alertas, usuarios y trazas ───────────────────────
@app.get("/api/alertas")
def ver_alertas(resueltas: int = 0, u: Usuario = Depends(usuario_actual)):
    with Sesion() as s:
        salida = []
        for a in s.query(Alerta).filter_by(resuelta=resueltas).order_by(
                Alerta.id.desc()).all():
            art = None
            if a.conteo_id:
                c = s.get(Conteo, a.conteo_id)
                if c:
                    ar = s.get(Articulo, c.articulo_codigo)
                    art = ar.nombre_oficial if ar else None
            salida.append({"id": a.id, "tipo": a.tipo, "detalle": a.detalle,
                           "articulo": art,
                           "hora": a.creado.strftime("%H:%M")})
    return salida


@app.post("/api/alertas/{alerta_id}/resolver")
def resolver_alerta(alerta_id: int, u: Usuario = Depends(requiere_perfil("auditor"))):
    with Sesion() as s:
        a = s.get(Alerta, alerta_id)
        if a is None:
            raise HTTPException(404, "Alerta no encontrada.")
        a.resuelta = 1
        s.commit()
    registrar(u, "ALERTA", f"Alerta {alerta_id} resuelta", "ok")
    return {"ok": True}


@app.get("/api/usuarios")
def listar_usuarios(u: Usuario = Depends(requiere_perfil("auditor"))):
    with Sesion() as s:
        salida = []
        for x in s.query(Usuario).all():
            n_bodegas = s.query(AsignacionBodega).filter_by(usuario_id=x.id).count()
            salida.append({"id": x.id, "nombre": x.nombre, "perfil": x.perfil,
                           "correo": x.correo, "activo": bool(x.activo),
                           "bodegas_asignadas": n_bodegas})
        return salida


class CrearUsuarioIn(BaseModel):
    nombre: str
    perfil: str
    correo: str = ""
    pin: str = "123456"


@app.post("/api/usuarios")
def crear_usuario(datos: CrearUsuarioIn, u: Usuario = Depends(requiere_perfil("auditor"))):
    nombre = datos.nombre.strip().lower()
    if datos.perfil not in ("auxiliar", "auditor"):
        raise HTTPException(400, "El perfil debe ser auxiliar o auditor.")
    if len(datos.pin) < 6:
        raise HTTPException(400, "El PIN debe tener al menos 6 digitos.")
    with Sesion() as s:
        if s.query(Usuario).filter_by(nombre=nombre).first():
            raise HTTPException(409, "Ya existe un usuario con ese nombre.")
        nuevo = Usuario(nombre=nombre, perfil=datos.perfil,
                        clave_hash=hash_clave(datos.pin), correo=datos.correo)
        s.add(nuevo)
        s.commit()
        s.refresh(nuevo)
        nid = nuevo.id
    registrar(u, "USUARIO", f"Usuario {nombre} creado ({datos.perfil})", "ok")
    return {"ok": True, "id": nid}


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


@app.get("/api/trazabilidad/reciente")
def traza_reciente(u: Usuario = Depends(usuario_actual)):
    """Vista compartida para Inicio: sin datos sensibles, solo la acción y quién."""
    with Sesion() as s:
        return [{"hora": t.creado.strftime("%H:%M"), "persona": t.persona,
                 "accion": t.accion, "detalle": t.detalle, "tipo": t.tipo}
                for t in s.query(Traza).order_by(Traza.id.desc()).limit(8)]


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


@app.get("/api/usuarios/yo")
def ver_perfil(u: Usuario = Depends(usuario_actual)):
    dias_pin = (datetime.now() - (u.pin_actualizado or datetime.now())).days
    return {"nombre": u.nombre, "correo": u.correo, "telefono": u.telefono,
            "codigo": u.codigo, "perfil": u.perfil,
            "ultimo_acceso": u.ultimo_acceso.strftime("%Y-%m-%d %H:%M") if u.ultimo_acceso else None,
            "pin_vence_en_dias": max(90 - dias_pin, 0),
            "huella_registrada": bool(u.huella_registrada),
            "idioma_voz": u.idioma_voz, "velocidad_voz": u.velocidad_voz,
            "confirmacion_hablada": bool(u.confirmacion_hablada)}


@app.get("/api/usuarios/yo/bodegas")
def bodegas_asignadas(u: Usuario = Depends(usuario_actual)):
    with Sesion() as s:
        asigs = s.query(AsignacionBodega).filter_by(usuario_id=u.id).all()
        salida = []
        for a in asigs:
            b = s.get(Bodega, a.bodega_id)
            if b:
                refs = s.query(StockSistema).filter_by(bodega_id=b.id).count()
                salida.append({"id": b.id, "bodega": b.nombre_oficial,
                               "estado": b.estado, "referencias": refs})
    return salida


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


@app.post("/api/usuarios/yo/huella")
def registrar_huella(u: Usuario = Depends(usuario_actual)):
    """Simulado: no hay lector biométrico real en una tableta web."""
    with Sesion() as s:
        usr = s.get(Usuario, u.id)
        usr.huella_registrada = 1
        s.commit()
    registrar(u, "SEGURIDAD", "Huella digital registrada (simulada)")
    return {"ok": True}


@app.post("/api/usuarios/yo/cerrar-todas")
def cerrar_todas_sesiones(u: Usuario = Depends(usuario_actual)):
    with Sesion() as s:
        usr = s.get(Usuario, u.id)
        usr.version_token = (usr.version_token or 0) + 1
        s.commit()
    registrar(u, "SEGURIDAD", "Sesion cerrada en todos los dispositivos")
    return {"ok": True, "token": crear_token(usr)}


@app.put("/api/usuarios/yo")
def editar_perfil(datos: dict, u: Usuario = Depends(usuario_actual)):
    with Sesion() as s:
        usr = s.get(Usuario, u.id)
        for k in ("nombre", "correo", "telefono"):
            if k in datos:
                setattr(usr, k, datos[k])
        s.commit()
    registrar(u, "PERFIL", "Datos personales actualizados")
    return {"ok": True}


@app.put("/api/usuarios/yo/pin")
def cambiar_pin(body: dict, u: Usuario = Depends(usuario_actual)):
    pin = str(body.get("pin", ""))
    if len(pin) < 6:
        raise HTTPException(400, "El PIN debe tener al menos 6 digitos.")
    with Sesion() as s:
        usr = s.get(Usuario, u.id)
        usr.clave_hash = hash_clave(pin)      # nunca en texto plano
        s.commit()
    registrar(u, "SEGURIDAD", "PIN actualizado")
    return {"ok": True}


@app.post("/api/usuarios/yo/foto")
async def subir_foto(foto: UploadFile = File(...),
                     u: Usuario = Depends(usuario_actual)):
    os.makedirs("fotos", exist_ok=True)
    with open(f"fotos/{u.id}.jpg", "wb") as f:
        f.write(await foto.read())
    return {"ok": True}


@app.get("/api/usuarios/yo/foto")
def ver_foto(u: Usuario = Depends(usuario_actual)):
    ruta = f"fotos/{u.id}.jpg"
    if not os.path.exists(ruta):
        raise HTTPException(404, "Sin foto.")
    return FileResponse(ruta)


@app.get("/api/trazabilidad")
def ver_traza(persona: str = "", accion: str = "",
              u: Usuario = Depends(requiere_perfil("auditor"))):
    with Sesion() as s:
        q = s.query(Traza)
        if persona:
            q = q.filter_by(persona=persona)
        if accion:
            q = q.filter_by(accion=accion)
        return [{"id": t.id, "hora": t.creado.strftime("%H:%M:%S"),
                 "persona": t.persona, "accion": t.accion,
                 "detalle": t.detalle, "tipo": t.tipo}
                for t in q.order_by(Traza.id.desc()).limit(200)]


@app.get("/api/ajustes")
def ver_ajustes(u: Usuario = Depends(usuario_actual)):
    with Sesion() as s:
        offline = s.get(ConfigClave, "offline")
        usuarios_activos = s.query(Usuario).filter_by(activo=1).count()
    return {"umbral": round(umbral_actual() * 100),
            "bloquear_negativos": True, "confirmar_alertas": True,
            "offline": (offline.valor == "1") if offline else True,
            "refresco_pbi": "15 minutos",
            "version": "1.0.0", "modelo": os.getenv("MODELO", "gemini-2.0-flash"),
            "idioma_voz": os.getenv("IDIOMA_VOZ", "es-CO"),
            "usuarios_activos": usuarios_activos}


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
    await ws.accept()
    conexiones.append(ws)
    await ws.send_json(estado_bodegas())
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        if ws in conexiones:
            conexiones.remove(ws)
