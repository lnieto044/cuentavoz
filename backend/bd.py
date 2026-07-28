"""Conexión a la base de datos. Todo lo demás importa de aquí."""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase


class Base(DeclarativeBase):
    pass



# Ruta absoluta anclada a backend/, para que sqlite apunte siempre al mismo
# archivo sin importar desde que carpeta se ejecute (uvicorn corre desde
# backend/, pero cargar_excel.py corre desde data/).
_RUTA_SQLITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cuentavoz.db")
DB_URL = os.getenv("DB_URL", f"sqlite:///{_RUTA_SQLITE}")
# Render (como antes Heroku) entrega la cadena de Postgres con el esquema
# viejo "postgres://"; SQLAlchemy 2.x ya no lo traduce solo y falla al
# arrancar si no se corrige aqui.
if DB_URL.startswith("postgres://"):
    DB_URL = DB_URL.replace("postgres://", "postgresql://", 1)

# SQLite necesita este argumento extra cuando hay varios hilos (uvicorn)
kwargs = {"connect_args": {"check_same_thread": False}} if DB_URL.startswith("sqlite") else {}
motor = create_engine(DB_URL, **kwargs)
Sesion = sessionmaker(bind=motor, expire_on_commit=False)


def iniciar_bd():
    import modelos  # noqa: F401  (registra todas las tablas)
    Base.metadata.create_all(motor)
    _migrar_columnas_faltantes()


def _migrar_columnas_faltantes():
    """create_all() solo crea tablas nuevas, nunca agrega columnas a una
    tabla que ya existe. Sin esto, una columna agregada al modelo (como
    Usuario.foto) se ve localmente porque cuentavoz.db se recrea facil,
    pero nunca llega a la base de Postgres ya desplegada en Render - hay
    que agregarla a mano en la tabla que ya esta viva. Corre en cada
    arranque y no hace nada si ya esta al dia."""
    from sqlalchemy import inspect, text
    inspector = inspect(motor)
    with motor.begin() as conexion:
        for tabla in Base.metadata.sorted_tables:
            if not inspector.has_table(tabla.name):
                continue
            existentes = {c["name"] for c in inspector.get_columns(tabla.name)}
            for columna in tabla.columns:
                if columna.name in existentes:
                    continue
                tipo = columna.type.compile(dialect=motor.dialect)
                conexion.execute(text(
                    f'ALTER TABLE {tabla.name} ADD COLUMN {columna.name} {tipo}'))
                print(f"[bd] columna agregada: {tabla.name}.{columna.name}")
