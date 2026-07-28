# Desplegar CuentaVoz en Render

CuentaVoz **no es un sitio estático**: tiene un backend real (FastAPI +
base de datos + el agente de voz con Gemini) del que depende todo — login,
conteo, pedidos, reportes, recetas. Un "Static Site" de Render solo puede
servir archivos HTML/CSS/JS, así que el despliegue se hace en dos partes:

| Parte | Qué es en Render | Qué sirve |
|---|---|---|
| `frontend/` | **Static Site** (gratis) | los archivos ya compilados por Vite (`npm run build`) |
| `backend/` | **Web Service** (Python) | la API FastAPI, la base de datos, el agente |
| datos | **PostgreSQL** de Render | reemplaza el `cuentavoz.db` local en producción |

El repo ya trae `render.yaml` en la raíz con las tres piezas definidas
(Blueprint). Así se usa:

## 1. Blueprint automático

1. Suba el repo a GitHub (o GitLab) si no lo ha hecho.
2. En el dashboard de Render: **New → Blueprint** → conecte el repositorio.
   Render lee `render.yaml` y propone crear `cuentavoz-db`, `cuentavoz-api`
   y `cuentavoz-web`. Confirme.
3. Render pedirá los valores marcados `sync: false` (no se pueden generar
   solos porque dependen uno del otro o son secretos):
   - En **cuentavoz-api**: `GOOGLE_API_KEY` (la llave gratis de
     aistudio.google.com — sin ella el agente sigue funcionando con el
     intérprete local, pero entiende menos variantes de frase).
   - `ORIGEN_PERMITIDO` y `VITE_API_URL` déjelos vacíos por ahora — el
     Blueprint aún no conoce las URLs finales de cada servicio. Se ponen en
     el paso 2 y 3, es la única parte manual.

## 2. Conectar el backend al frontend (una vez, tras el primer deploy)

Una vez `cuentavoz-api` termina de desplegar, Render le asigna una URL fija
tipo `https://cuentavoz-api.onrender.com`. Cópiela y:

1. Vaya a **cuentavoz-web → Environment** → ponga
   `VITE_API_URL=https://cuentavoz-api.onrender.com` → **Save, rebuild**.
   (Es obligatorio reconstruir: Vite incrusta esta variable en el HTML/JS
   compilado, no la lee en tiempo real como el backend.)

Cuando `cuentavoz-web` termine de desplegar, tendrá su propia URL tipo
`https://cuentavoz-web.onrender.com`. Cópiela y:

2. Vaya a **cuentavoz-api → Environment** → ponga
   `ORIGEN_PERMITIDO=https://cuentavoz-web.onrender.com` (si hay más de un
   origen válido, sepárelos por coma) → **Save, deploy**.

Sin este paso el navegador bloquea las llamadas del frontend a la API por
CORS aunque todo lo demás esté bien.

3. De paso, en el mismo **cuentavoz-api → Environment**, ponga también:
   - `WEBAUTHN_RP_ID=cuentavoz-web.onrender.com` (el dominio del **frontend**,
     sin `https://` ni barra final)
   - `WEBAUTHN_ORIGENES=https://cuentavoz-web.onrender.com` (esta vez sí con
     `https://`)

   Esto es para el ingreso con huella del dispositivo (WebAuthn): el
   navegador solo lo permite si el `rp_id` coincide exacto con el dominio
   que se ve en la barra de direcciones. Si algún día se usa un dominio
   propio en vez de `onrender.com`, hay que actualizar estas dos variables
   también.

## 3. Cargar los datos reales (una sola vez)

Los usuarios de prueba se crean solos al primer arranque (ver
`backend/main.py: arranque()`), pero el extracto real de Colsubsidio
(bodegas, artículos, stock) hay que cargarlo a mano contra la base nueva:

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
