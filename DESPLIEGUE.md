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
   - `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID`, `AWS_ACCESS_KEY_ID`
     y `AWS_SECRET_ACCESS_KEY`: las credenciales de la cuenta IAM
     `cuentavoz-backend` (no la de aprovisionamiento) sobre el User Pool
     ya creado en AWS Cognito — sin esto la API arranca pero nadie puede
     iniciar sesión. Pídalas al equipo.
   - `ORIGEN_PERMITIDO` y `VITE_API_URL` déjelos vacíos por ahora — el
     Blueprint aún no conoce las URLs finales de cada servicio. Se ponen
     en el paso 2, es la única parte manual.

## 2. Conectar el backend al frontend (una vez, tras el primer deploy)

Una vez `cuentavoz-api` termina de desplegar, Render le asigna la URL fija
`https://cuentavoz-api.onrender.com`. Y:

1. Vaya a **cuentavoz → Environment** → ponga
   `VITE_API_URL=https://cuentavoz-api.onrender.com` → **Save, rebuild**.
   (Es obligatorio reconstruir: Vite incrusta esta variable en el HTML/JS
   compilado, no la lee en tiempo real como el backend.)

Cuando **cuentavoz** termine de desplegar, su URL para compartir es
`https://cuentavoz.onrender.com`. Con esa URL:

2. Vaya a **cuentavoz-api → Environment** → ponga
   `ORIGEN_PERMITIDO=https://cuentavoz.onrender.com` (si hay más de un
   origen válido, sepárelos por coma) → **Save, deploy**.

Sin ese valor el navegador bloquea las llamadas del frontend a la API por
CORS aunque todo lo demás esté bien.

## 3. Cargar los datos reales (una sola vez)

Los usuarios de prueba se crean solos al primer arranque, tanto en la
base local como en Cognito (ver `backend/main.py: arranque()`, clave
`StockXperts1`), pero el extracto real de Colsubsidio (bodegas,
artículos, stock) hay que cargarlo a mano contra la base nueva:

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
- **Identidad**: la maneja AWS Cognito, no este backend - el mismo User
  Pool sirve tanto para local como para Render (no hay que crear uno
  nuevo por entorno, basta con apuntar `COGNITO_*`/`AWS_*` al mismo).
- **Correos (registro/recuperar clave)**: el User Pool usa el remitente
  propio de Cognito (`EmailSendingAccount: COGNITO_DEFAULT`), no Amazon
  SES. Es una decisión tomada a conciencia, no un descuido — vale la pena
  entender el porqué antes de "mejorarlo":

  | | Cognito por defecto | Amazon SES |
  |---|---|---|
  | Destinatarios | **cualquier correo** | solo direcciones verificadas una por una (modo *sandbox*) |
  | Límite | 50 correos/día | 200/día en sandbox |
  | Bandeja | suele caer en **spam** | igual cae en spam desde un @gmail.com |
  | Costo | gratis | gratis |

  Se intentó SES primero, buscando sacar los correos de spam. No sirvió:
  SES arranca en modo *sandbox*, donde **descarta en silencio** todo
  correo a una dirección no verificada previamente — sin error, sin
  rebote, sin nada en los logs. En la práctica el registro solo funcionaba
  para dos direcciones y para cualquier otra persona parecía que la
  aplicación estaba rota. Salir del sandbox se solicitó a AWS (caso
  178754215000785) y quedó pendiente de más información; además, el
  registro de dominios de Route 53 esta bloqueado en cuentas del plan
  gratuito ("Free Tier accounts are not supported for this service").

  Entregar a todo el mundo aunque caiga en spam es estrictamente mejor que
  no entregar. Por eso se volvió al remitente de Cognito.

  **Lo único que arregla el spam de verdad** es un dominio propio (no un
  @gmail.com ni el dominio compartido de AWS) con Easy DKIM configurado en
  SES: Gmail no puede autenticar un envío "desde" gmail.com hecho por un
  tercero, así que mientras el remitente sea una dirección prestada,
  cualquier proveedor lo va a mirar con sospecha. Eso exige comprar un
  dominio (~14 USD/año) y pasar la cuenta de AWS a plan de pago.

  La plantilla del correo (asunto, HTML con la marca de CuentaVoz y
  Colsubsidio, logos y firma) vive en el propio User Pool, en
  `VerificationMessageTemplate`. Se cambia con
  `cognito-idp.update_user_pool` — ojo: esa llamada **reemplaza la
  configuración completa del pool**, así que hay que leerla antes con
  `describe_user_pool` y reenviar todo lo que se quiera conservar. No
  hacerlo apagó `AutoVerifiedAttributes` una vez y dejó el registro sin
  enviar códigos.
- Ver [LEEME_PRIMERO.md](LEEME_PRIMERO.md) para correr todo localmente.

## Monitoreo de errores en producción (Sentry, opcional)

El código ya está listo para mandar los errores no manejados a Sentry -
apagado por defecto (sin las variables de abajo, no llama a ningún lado,
la app funciona exactamente igual). Para activarlo:

1. Cree una cuenta gratis en [sentry.io](https://sentry.io) (el plan
   gratis alcanza de sobra para un proyecto de este tamaño).
2. **Create Project** → plataforma **Python/FastAPI** → nombre
   `cuentavoz-api`. Sentry le muestra un DSN (una URL larga que empieza
   con `https://...@...ingest.sentry.io/...`) - cópielo.
3. En **cuentavoz-api → Environment** (Render): agregue
   `SENTRY_DSN=<ese valor>` → **Save, deploy**.
4. Repita el paso 2 con un segundo proyecto, plataforma **React**, nombre
   `cuentavoz` - copie su propio DSN.
5. En **cuentavoz → Environment** (Render, el Static Site): agregue
   `VITE_SENTRY_DSN=<ese otro valor>` → **Save, rebuild** (obligatorio
   reconstruir, igual que con `VITE_API_URL`: Vite lo incrusta en el build,
   no lo lee en tiempo real).

Con eso, cualquier error real que ocurra en producción (backend o
frontend) aparece en el dashboard de Sentry, con la traza completa.
