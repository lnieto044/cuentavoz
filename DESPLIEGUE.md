# Desplegar CuentaVoz en Render

CuentaVoz **no es un sitio estático**: tiene un backend real (FastAPI +
base de datos + el agente de voz con Gemini) del que depende todo — login,
conteo, pedidos, reportes, recetas. Un "Static Site" de Render solo puede
servir archivos HTML/CSS/JS, así que el despliegue se hace en dos partes:

| Parte | Qué es en Render | Nombre / URL | Qué sirve |
|---|---|---|---|
| `frontend/` | **Static Site** (gratis) | `cuentavoz` → `cuentavoz.onrender.com` | los archivos ya compilados por Vite — **esta es la URL que se comparte** |
| `backend/` | **Web Service** (Python) | `cuentavoz-api` → `cuentavoz-api.onrender.com` | la API FastAPI, la base de datos, el agente |
| datos | **PostgreSQL** de Render | `cuentavoz-db` | reemplaza el `cuentavoz.db` local en producción |

El repo ya trae `render.yaml` en la raíz con las tres piezas definidas
(Blueprint). Así se usa:

## 0. Antes de empezar: libere el nombre "cuentavoz"

Ya existen dos servicios viejos en su cuenta de Render de una subida
anterior (`cuentavoz` y `cuentavoz-frontend`, hechos con URL fija en vez de
variable de entorno) que están ocupando esos nombres. Render no deja crear
un servicio nuevo con un nombre que ya está en uso en la plataforma, así
que antes del paso 1:

1. En el dashboard de Render, entre a cada servicio viejo (`cuentavoz` y
   `cuentavoz-frontend`) → **Settings → Delete Service**.
2. Confirme el borrado de ambos. Esto libera los nombres para el blueprint
   nuevo. (La base de datos de esos servicios viejos, si la tenían, bórrela
   también desde su propia página en el dashboard.)

## 1. Blueprint automático

1. El repo ya está subido a GitHub (`lnieto044/cuentavoz`).
2. En el dashboard de Render: **New → Blueprint** → conecte el repositorio.
   Render lee `render.yaml` y propone crear `cuentavoz-db`, `cuentavoz-api`
   y `cuentavoz` (el Static Site). Confirme.
3. Render pedirá los valores marcados `sync: false` (no se pueden generar
   solos porque dependen uno del otro o son secretos):
   - En **cuentavoz-api**: `GOOGLE_API_KEY` (la llave gratis de
     aistudio.google.com — sin ella el agente sigue funcionando con el
     intérprete local, pero entiende menos variantes de frase).
   - `ORIGEN_PERMITIDO`, `VITE_API_URL`, `WEBAUTHN_RP_ID` y
     `WEBAUTHN_ORIGENES` déjelos vacíos por ahora — el Blueprint aún no
     conoce las URLs finales de cada servicio. Se ponen en el paso 2, es la
     única parte manual.

## 2. Conectar el backend al frontend (una vez, tras el primer deploy)

Una vez `cuentavoz-api` termina de desplegar, Render le asigna la URL fija
`https://cuentavoz-api.onrender.com`. Y:

1. Vaya a **cuentavoz → Environment** → ponga
   `VITE_API_URL=https://cuentavoz-api.onrender.com` → **Save, rebuild**.
   (Es obligatorio reconstruir: Vite incrusta esta variable en el HTML/JS
   compilado, no la lee en tiempo real como el backend.)

Cuando **cuentavoz** termine de desplegar, su URL para compartir es
`https://cuentavoz.onrender.com`. Con esa URL:

2. Vaya a **cuentavoz-api → Environment** → ponga:
   - `ORIGEN_PERMITIDO=https://cuentavoz.onrender.com` (si hay más de un
     origen válido, sepárelos por coma)
   - `WEBAUTHN_RP_ID=cuentavoz.onrender.com` (el dominio del frontend, sin
     `https://` ni barra final)
   - `WEBAUTHN_ORIGENES=https://cuentavoz.onrender.com` (esta vez sí con
     `https://`)
   → **Save, deploy**.

Sin el primer valor (`ORIGEN_PERMITIDO`) el navegador bloquea las llamadas
del frontend a la API por CORS aunque todo lo demás esté bien. Los otros
dos son para que el ingreso con huella del dispositivo (WebAuthn) funcione:
el navegador solo lo permite si `WEBAUTHN_RP_ID` coincide exacto con el
dominio que se ve en la barra de direcciones.

## 3. Cargar los datos reales (una sola vez)

Los usuarios de prueba se crean solos al primer arranque (ver
`backend/main.py: arranque()`, clave `StockXperts`), pero el extracto real
de Colsubsidio (bodegas, artículos, stock) hay que cargarlo a mano contra
la base nueva:

1. En **cuentavoz-api → Shell** (consola del propio servicio, ya tiene
   `DB_URL` apuntando a la Postgres de Render):
   ```bash
   cd ../data && python cargar_excel.py
   ```
2. Confirme en `GET /api/salud` que `bodegas`, `articulos` y `stock` ya no
   están en cero.

## Notas

- **Plan free de Render**: los Web Services gratis se duermen tras 15 min
  sin tráfico y tardan ~30-50 s en despertar en la siguiente petición — es
  normal ver el primer login lento después de inactividad, no es un error.
- **Base de datos**: en local se sigue usando SQLite (`DB_URL` por defecto
  en `backend/bd.py`); en Render la variable `DB_URL` la pone Render sola
  apuntando a Postgres — no hay que tocar código para el cambio.
- **Verificar sin errores**: `GET https://cuentavoz-api.onrender.com/api/salud`
  debe responder `{"api":"ok", ...}`; si `gemini` sale en `false` es porque
  falta `GOOGLE_API_KEY`, no es un fallo — el agente sigue funcionando con
  el intérprete local.
- **Huella del dispositivo**: cada persona la registra una vez desde Mi
  perfil, en cada dispositivo donde la quiera usar (queda ligada a ese
  navegador/equipo, no viaja con la cuenta). Si más adelante cambia el
  dominio (`WEBAUTHN_RP_ID`), las huellas registradas antes dejan de
  funcionar y hay que volver a registrarlas.
- Ver [LEEME_PRIMERO.md](LEEME_PRIMERO.md) para correr todo localmente.
