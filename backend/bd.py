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
