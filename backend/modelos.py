"""Las tablas del sistema: el diagrama de clases hecho código."""
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, LargeBinary
from bd import Base
from horario import ahora


class Usuario(Base):
    __tablename__ = "usuario"
    id = Column(Integer, primary_key=True)
    nombre = Column(String, nullable=False)
    perfil = Column(String, nullable=False)          # auxiliar | auditor
    clave_hash = Column(String, nullable=False)
    correo = Column(String, default="")
    telefono = Column(String, default="")
    codigo = Column(String, default="")
    activo = Column(Integer, default=1)
    version_token = Column(Integer, default=0)       # +1 invalida sesiones anteriores
    huella_registrada = Column(Integer, default=0)   # tiene al menos una CredencialWebAuthn
    pin_actualizado = Column(DateTime, default=ahora)
    ultimo_acceso = Column(DateTime, nullable=True)
    idioma_voz = Column(String, default="es-MX")
    velocidad_voz = Column(String, default="normal")     # lenta | normal | rapida
    confirmacion_hablada = Column(Integer, default=1)
    # la foto va en la misma base (no en disco): el disco del Web Service
    # en Render es efimero y se borra en cada deploy/reinicio, la base no.
    foto = Column(LargeBinary, nullable=True)
    foto_tipo = Column(String, nullable=True)         # ej. "image/jpeg"


class AsignacionBodega(Base):
    """Qué bodegas puede contar cada persona."""
    __tablename__ = "asignacion_bodega"
    id = Column(Integer, primary_key=True)
    usuario_id = Column(Integer, ForeignKey("usuario.id"))
    bodega_id = Column(Integer, ForeignKey("bodega.id"))


class Bodega(Base):
    __tablename__ = "bodega"
    id = Column(Integer, primary_key=True)
    nombre_oficial = Column(String, unique=True, nullable=False)
    estado = Column(String, default="pendiente")     # pendiente | en_conteo | en_auditoria | cerrada


class Articulo(Base):
    __tablename__ = "articulo"
    codigo = Column(String, primary_key=True)
    nombre_oficial = Column(String, nullable=False)
    unidad_medida = Column(String, nullable=False)


class StockSistema(Base):
    """El extracto de My Inventory: lo que el sistema cree que hay."""
    __tablename__ = "stock_sistema"
    id = Column(Integer, primary_key=True)
    articulo_codigo = Column(String, ForeignKey("articulo.codigo"))
    bodega_id = Column(Integer, ForeignKey("bodega.id"))
    cantidad_sd = Column(Float, default=0)


class AliasArticulo(Base):
    """Cómo habla el equipo de verdad. El agente lo va aprendiendo."""
    __tablename__ = "alias_articulo"
    id = Column(Integer, primary_key=True)
    texto_dicho = Column(String, index=True)
    articulo_codigo = Column(String, ForeignKey("articulo.codigo"))
    bodega_id = Column(Integer, nullable=True)


class SesionConteo(Base):
    __tablename__ = "sesion_conteo"
    id = Column(Integer, primary_key=True)
    bodega_id = Column(Integer, ForeignKey("bodega.id"))
    usuario_id = Column(Integer, ForeignKey("usuario.id"))
    tipo = Column(String, default="conteo")          # conteo | auditoria
    estado = Column(String, default="abierta")
    firmada = Column(Integer, default=0)             # firma digital de cierre
    inicio = Column(DateTime, default=ahora)
    fin = Column(DateTime, nullable=True)


class Conteo(Base):
    __tablename__ = "conteo"
    id = Column(Integer, primary_key=True)
    sesion_id = Column(Integer, ForeignKey("sesion_conteo.id"))
    articulo_codigo = Column(String, ForeignKey("articulo.codigo"))
    cantidad = Column(Float, nullable=False)
    unidad = Column(String)
    estado = Column(String, default="confirmado")
    # confirmado | corregido | pendiente_aprobacion | borrador
    corrige_a = Column(Integer, ForeignKey("conteo.id"), nullable=True)
    creado = Column(DateTime, default=ahora)


class Alerta(Base):
    __tablename__ = "alerta"
    id = Column(Integer, primary_key=True)
    conteo_id = Column(Integer, ForeignKey("conteo.id"), nullable=True)
    tipo = Column(String)          # unidad | negativo | desviacion | inexistente
    detalle = Column(String)
    resuelta = Column(Integer, default=0)
    creado = Column(DateTime, default=ahora)
    resuelto = Column(DateTime, nullable=True)


class Traza(Base):
    """Registro inmutable: solo crece, nunca se edita ni se borra."""
    __tablename__ = "traza"
    id = Column(Integer, primary_key=True)
    usuario_id = Column(Integer, ForeignKey("usuario.id"), nullable=True)
    persona = Column(String)
    accion = Column(String)        # APERTURA | CIERRE | CORRECCION | ALERTA...
    detalle = Column(String)
    tipo = Column(String, default="info")
    creado = Column(DateTime, default=ahora)


# ─── los tres momentos del reto: recetas y servicios ───
class Receta(Base):
    __tablename__ = "receta"
    id = Column(Integer, primary_key=True)
    nombre = Column(String, nullable=False)
    rendimiento = Column(Integer, default=1)
    # paso a paso de cocina, no solo la lista de ingredientes con su cantidad.
    preparacion = Column(String, default="")


class RecetaIngrediente(Base):
    __tablename__ = "receta_ingrediente"
    id = Column(Integer, primary_key=True)
    receta_id = Column(Integer, ForeignKey("receta.id"))
    articulo_codigo = Column(String, ForeignKey("articulo.codigo"))
    cantidad_por_porcion = Column(Float, nullable=False)


class LineaServicio(Base):
    __tablename__ = "linea_servicio"
    id = Column(Integer, primary_key=True)
    servicio_id = Column(Integer, default=1)
    articulo_codigo = Column(String, ForeignKey("articulo.codigo"))
    nombre = Column(String)
    pedido = Column(Float, default=0)
    usado = Column(Float, default=0)
    # abierto | legalizado | pendiente_aprobacion | rechazado
    estado = Column(String, default="abierto")
    plato = Column(String, default="")
    porciones = Column(Integer, default=0)
    creado = Column(DateTime, default=ahora)
    bodega_id = Column(Integer, ForeignKey("bodega.id"), nullable=True)
    creado_por_id = Column(Integer, ForeignKey("usuario.id"), nullable=True)
    # agrupa las lineas de un mismo envio para poder aprobarlo/rechazarlo
    # como una sola unidad, no linea por linea.
    numero_pedido = Column(String, nullable=True)


# ─── aprobación en paralelo: productos y bodegas creados en plena toma ───
class Aprobacion(Base):
    __tablename__ = "aprobacion"
    id = Column(Integer, primary_key=True)
    tipo = Column(String, nullable=False)            # producto | bodega
    nombre = Column(String, nullable=False)
    unidad_medida = Column(String, nullable=True)
    cantidad_inicial = Column(Float, nullable=True)
    bodega_id = Column(Integer, ForeignKey("bodega.id"), nullable=True)
    articulo_codigo = Column(String, ForeignKey("articulo.codigo"), nullable=True)
    conteo_id = Column(Integer, ForeignKey("conteo.id"), nullable=True)
    creado_por_id = Column(Integer, ForeignKey("usuario.id"), nullable=True)
    estado = Column(String, default="pendiente")     # pendiente | aprobado | rechazado
    creado = Column(DateTime, default=ahora)
    resuelto_por_id = Column(Integer, ForeignKey("usuario.id"), nullable=True)
    resuelto = Column(DateTime, nullable=True)


class HistorialCierre(Base):
    """Una foto de la exactitud cada vez que una bodega cierra con doble firma."""
    __tablename__ = "historial_cierre"
    id = Column(Integer, primary_key=True)
    bodega_id = Column(Integer, ForeignKey("bodega.id"))
    exactitud = Column(Float, default=100)
    referencias = Column(Integer, default=0)
    diferencias = Column(Integer, default=0)
    fecha = Column(DateTime, default=ahora)


class ConfigClave(Base):
    """Ajustes editables desde la aplicación, con el .env como valor por defecto."""
    __tablename__ = "config_clave"
    clave = Column(String, primary_key=True)
    valor = Column(String, nullable=False)


class MensajeSoporte(Base):
    """Un mensaje de "Soporte en vivo" (auxiliar -> administrador) con su
    respuesta, si ya la dio - la bandeja dentro de la app en Ayuda,
    aparte del correo real que tambien se manda por fuera (EmailJS)."""
    __tablename__ = "mensaje_soporte"
    id = Column(Integer, primary_key=True)
    remitente_id = Column(Integer, ForeignKey("usuario.id"), nullable=False)
    destinatario_id = Column(Integer, ForeignKey("usuario.id"), nullable=False)
    mensaje = Column(String, nullable=False)
    respuesta = Column(String, nullable=True)
    creado = Column(DateTime, default=ahora)
    respondido = Column(DateTime, nullable=True)


class CredencialWebAuthn(Base):
    """Una llave de acceso (huella, Windows Hello, etc.) registrada en un
    dispositivo para un usuario - el ingreso real por biometria via WebAuthn,
    no la simulacion anterior."""
    __tablename__ = "credencial_webauthn"
    id = Column(Integer, primary_key=True)
    usuario_id = Column(Integer, ForeignKey("usuario.id"), nullable=False)
    credential_id = Column(String, nullable=False, unique=True)   # base64url
    public_key = Column(String, nullable=False)                   # base64url
    sign_count = Column(Integer, default=0)
    dispositivo = Column(String, default="")     # nombre amigable, ej. "Edge en este equipo"
    creado = Column(DateTime, default=ahora)
