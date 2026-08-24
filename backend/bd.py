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
    _migrar_columnas_ya_opcionales()


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


def _migrar_columnas_ya_opcionales():
    """Quita el NOT NULL de las columnas que el modelo ya declara opcionales.

    _migrar_columnas_faltantes solo AGREGA columnas; nunca relaja una
    restriccion existente. Eso dejo un fallo real y silencioso en
    produccion: al pasar la identidad a Cognito, Usuario.clave_hash se
    volvio nullable=True en el modelo (ya nadie la llena, la clave la
    guarda Cognito), pero la tabla de Postgres seguia con el NOT NULL de
    cuando se creo. En local no se noto porque cuentavoz.db se recrea de
    cero; en Render, CADA insercion de usuario fallaba - autoregistro y
    "crear usuario" desde Ajustes - con un 500 que ademas llegaba al
    navegador sin cabeceras CORS, o sea disfrazado de "Sin conexion con el
    servidor. Revise el Wi-Fi".

    Solo en Postgres: SQLite no sabe hacer ALTER COLUMN, y alla no hace
    falta. Nunca toca la llave primaria, que debe seguir siendo NOT NULL.
    """
    if not motor.dialect.name.startswith("postgres"):
        return
    from sqlalchemy import inspect, text
    inspector = inspect(motor)
    with motor.begin() as conexion:
        for tabla in Base.metadata.sorted_tables:
            if not inspector.has_table(tabla.name):
                continue
            en_bd = {c["name"]: c for c in inspector.get_columns(tabla.name)}
            for columna in tabla.columns:
                actual = en_bd.get(columna.name)
                if actual is None or columna.primary_key:
                    continue
                # la base exige valor pero el modelo ya dice que es opcional
                if columna.nullable and not actual.get("nullable", True):
                    conexion.execute(text(
                        f'ALTER TABLE {tabla.name} '
                        f'ALTER COLUMN {columna.name} DROP NOT NULL'))
                    print(f"[bd] ahora opcional: {tabla.name}.{columna.name}")
