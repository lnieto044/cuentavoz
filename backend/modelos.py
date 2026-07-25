"""Las tablas del sistema: el diagrama de clases hecho código."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from bd import Base


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
    huella_registrada = Column(Integer, default=0)   # simulado: no hay lector real
    pin_actualizado = Column(DateTime, default=datetime.now)
    ultimo_acceso = Column(DateTime, nullable=True)
    idioma_voz = Column(String, default="es-CO")
    velocidad_voz = Column(String, default="normal")     # lenta | normal | rapida
    confirmacion_hablada = Column(Integer, default=1)


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
    inicio = Column(DateTime, default=datetime.now)
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
    creado = Column(DateTime, default=datetime.now)


class Alerta(Base):
    __tablename__ = "alerta"
    id = Column(Integer, primary_key=True)
    conteo_id = Column(Integer, ForeignKey("conteo.id"), nullable=True)
    tipo = Column(String)          # unidad | negativo | desviacion | inexistente
    detalle = Column(String)
    resuelta = Column(Integer, default=0)
    creado = Column(DateTime, default=datetime.now)


class Traza(Base):
    """Registro inmutable: solo crece, nunca se edita ni se borra."""
    __tablename__ = "traza"
    id = Column(Integer, primary_key=True)
    usuario_id = Column(Integer, ForeignKey("usuario.id"), nullable=True)
    persona = Column(String)
    accion = Column(String)        # APERTURA | CIERRE | CORRECCION | ALERTA...
    detalle = Column(String)
    tipo = Column(String, default="info")
    creado = Column(DateTime, default=datetime.now)


# ─── los tres momentos del reto: recetas y servicios ───
class Receta(Base):
    __tablename__ = "receta"
    id = Column(Integer, primary_key=True)
    nombre = Column(String, nullable=False)
    rendimiento = Column(Integer, default=1)


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
    estado = Column(String, default="abierto")       # abierto | legalizado


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
    creado = Column(DateTime, default=datetime.now)
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
    fecha = Column(DateTime, default=datetime.now)


class ConfigClave(Base):
    """Ajustes editables desde la aplicación, con el .env como valor por defecto."""
    __tablename__ = "config_clave"
    clave = Column(String, primary_key=True)
    valor = Column(String, nullable=False)
