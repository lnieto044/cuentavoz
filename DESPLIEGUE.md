# Desplegar CuentaVoz en AWS

CuentaVoz **no es un sitio estático**: tiene un backend real (FastAPI +
base de datos + el agente de voz con Gemini) del que depende todo — login,
conteo, pedidos, reportes, recetas. Por eso el despliegue son cuatro
piezas, cada una en un servicio distinto de AWS:

| Parte | Dónde vive | Qué sirve |
|---|---|---|
| `frontend/` | **S3 + CloudFront** | los archivos ya compilados por Vite — **esta es la URL que se comparte** |
| `backend/` | **EC2 + Docker**, con la imagen guardada en **ECR** | la API FastAPI y el agente de voz |
| datos | **RDS** (PostgreSQL) | reemplaza el `cuentavoz.db` local en producción |
| identidad | **AWS Cognito** | registro, ingreso, cambio y recuperación de clave |

## Nadie despliega a mano

Cada `push` a `main` dispara
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), que corre
tres trabajos:

| Trabajo | Qué hace | Si falla |
|---|---|---|
| `test-backend` | corre `backend/tests/` con pytest | **no se construye ni se sube nada** |
| `deploy-backend` | construye la imagen, la sube a ECR, entra por SSH a la EC2 y reemplaza el contenedor | el backend se queda en la versión anterior |
| `deploy-frontend` | `npm run build`, sube a S3 e invalida la caché de CloudFront | el frontend se queda en la versión anterior |

Los dos despliegues dependen de `test-backend`, así que una prueba en rojo
detiene todo antes de tocar producción.

`index.html`, `sw.js` y `manifest.webmanifest` se suben sin caché a
propósito: son los que le avisan al navegador que hay versión nueva. El
resto sí va con caché larga, porque Vite les pone un hash en el nombre.

## Los secretos que necesita el pipeline

Se configuran una sola vez en GitHub → **Settings · Secrets and variables ·
Actions**. Ninguno de estos valores vive en el repositorio.

| Secreto | Para qué |
|---|---|
| `AWS_ACCESS_KEY_ID` · `AWS_SECRET_ACCESS_KEY` · `AWS_REGION` | usuario IAM de CI/CD: subir a ECR y a S3, invalidar CloudFront |
| `ECR_REPOSITORY` | nombre del repositorio de imágenes |
| `EC2_HOST` · `EC2_SSH_KEY` | dirección de la instancia y su llave privada |
| `DB_URL` | cadena de conexión a la base de RDS |
| `COGNITO_REGION` · `COGNITO_USER_POOL_ID` · `COGNITO_APP_CLIENT_ID` | a qué User Pool apunta el backend |
| `COGNITO_AWS_ACCESS_KEY_ID` · `COGNITO_AWS_SECRET_ACCESS_KEY` | usuario IAM `cuentavoz-backend`, con permiso sobre ese User Pool. **Sin esto la API arranca pero nadie puede entrar** |
| `GOOGLE_API_KEY` | la llave de aistudio.google.com. Sin ella el agente sigue funcionando con el intérprete local, pero entiende menos variantes de frase |
| `ORIGEN_PERMITIDO` | la URL del frontend. Sin esto el navegador bloquea las llamadas por CORS aunque todo lo demás esté bien |
| `S3_BUCKET_FRONTEND` · `CLOUDFRONT_DISTRIBUTION_ID` | dónde se publica el frontend y qué caché se invalida |
| `VITE_API_URL` | la URL del backend, incrustada en el build de Vite |
| `SENTRY_DSN` · `VITE_SENTRY_DSN` | opcionales, ver más abajo |

## No pegue los secretos con Enter al final

Esto ya tumbó la plataforma una vez, así que vale la pena contarlo entero.

`DB_URL` se pegó en la consola de GitHub con un salto de línea al final.
Ese salto viaja intacto hasta el contenedor y, como el nombre de la base
es lo último de la cadena, el backend terminaba pidiéndole a RDS una base
llamada `cuentavoz` con un salto pegado detrás:

```
FATAL:  database "cuentavoz
" does not exist
```

Dos cosas lo volvieron difícil de ver:

1. **La aplicación no fallaba a medias: no arrancaba.** `iniciar_bd()`
   conecta a la base durante el arranque, antes de servir la primera
   petición, así que uvicorn moría y CloudFront devolvía `504`.
2. **El pipeline decía verde.** Su comprobación era `docker ps | grep`, y
   con `--restart always` un contenedor en bucle de reinicio igual aparece
   listado.

Se corrigieron las dos: `backend/bd.py` limpia el valor al leerlo con
`.strip()` —como ya hacían todas las demás variables del proyecto— y el
pipeline ahora consulta `/api/salud` hasta que responde, imprime los logs
del contenedor y deja el job en rojo si no contesta en 60 segundos.

Aun así, la costumbre correcta es pegar los secretos sin Enter al final.

## Entrar al servidor cuando algo falla

Dos caminos, y el primero no necesita llave ni instalar nada:

**Desde el navegador.** Consola de AWS → **EC2** → **Instancias** →
seleccione la instancia → **Conectar** → pestaña **EC2 Instance Connect**.

**Desde su equipo**, con la llave del secreto `EC2_SSH_KEY`:

```bash
ssh -i cuentavoz-key.pem ec2-user@<EC2_HOST>
```

Ya adentro, en este orden:

```bash
docker ps -a | grep cuentavoz-api    # Up o Restarting
docker logs --tail 50 cuentavoz-api  # qué dijo antes de morir
```

`Restarting` significa que la aplicación no llega a arrancar, y casi
siempre es la base de datos. Los logs dicen exactamente por qué.

## Cargar los datos reales (una sola vez)

Los usuarios de prueba se crean solos al primer arranque, tanto en la base
como en Cognito (ver `backend/main.py: arranque()`, clave `StockXperts1`),
pero el extracto real de Colsubsidio (bodegas, artículos, stock) hay que
cargarlo a mano contra la base nueva.

Ojo con un detalle del Dockerfile: el contexto del build es `./backend`,
así que **la carpeta `data/` no entra en la imagen**. `cargar_excel.py` no
se puede correr con `docker exec`; hay que llevarlo a la instancia, que es
lo único que alcanza la base de RDS:

```bash
scp -i cuentavoz-key.pem -r data ec2-user@<EC2_HOST>:~/
ssh -i cuentavoz-key.pem ec2-user@<EC2_HOST>
cd ~/data && DB_URL="<la cadena de RDS>" python3 cargar_excel.py
```

Confirme después en `GET /api/salud` que `bodegas`, `articulos` y `stock`
ya no están en cero.

## Notas

- **La instancia no se duerme.** En Render el plan gratis dormía los
  servicios tras 15 minutos y el primer login tardaba 30-50 segundos. En
  EC2 eso no pasa: si la API no responde, es una falla real y no un
  arranque en frío. (El frontend todavía muestra un mensaje de "el
  servidor estaba en reposo" al reintentar; es un resto de la época de
  Render.)
- **Base de datos**: en local se sigue usando SQLite (`DB_URL` por defecto
  en `backend/bd.py`); en producción la variable apunta a RDS. No hay que
  tocar código para el cambio.
- **Las migraciones corren solas.** `iniciar_bd()` llama a `create_all()` y
  después agrega las columnas nuevas con `ALTER TABLE`, porque
  `create_all()` solo crea tablas nuevas y nunca agrega columnas a una que
  ya existe. Por eso un modelo con un campo nuevo llega a una base de
  producción ya viva sin intervención.
- **Verificar sin errores**: `GET <VITE_API_URL>/api/salud` debe responder
  `{"api":"ok", ...}`. Si `gemini` sale en `false` es porque falta
  `GOOGLE_API_KEY`, y no es una falla: el agente sigue funcionando con el
  intérprete local.
- **Identidad**: la maneja AWS Cognito, no este backend — el mismo User
  Pool sirve para local y para producción, basta con apuntar
  `COGNITO_*`/`AWS_*` al mismo.
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

El código ya está listo para mandar los errores no manejados a Sentry,
apagado por defecto: sin las variables de abajo no llama a ningún lado y la
aplicación funciona exactamente igual. Para activarlo:

1. Cree una cuenta gratis en [sentry.io](https://sentry.io) (el plan gratis
   alcanza de sobra para un proyecto de este tamaño).
2. **Create Project** → plataforma **Python/FastAPI** → nombre
   `cuentavoz-api`. Sentry le muestra un DSN (una URL larga que empieza con
   `https://...@...ingest.sentry.io/...`) — cópielo.
3. Guárdelo en GitHub como el secreto `SENTRY_DSN`. El pipeline ya se lo
   pasa al contenedor; basta con volver a desplegar.
4. Repita el paso 2 con un segundo proyecto, plataforma **React**, nombre
   `cuentavoz` — copie su propio DSN.
5. Guárdelo como `VITE_SENTRY_DSN`. Este se incrusta en el build, así que
   solo aplica a partir del siguiente despliegue del frontend.

Con eso, cualquier error real que ocurra en producción (backend o frontend)
aparece en el dashboard de Sentry, con la traza completa.

### Cómo comprobar que quedó bien

Sin forzar nada, y sin esperar a que algo se rompa:

- **Backend**: `GET <VITE_API_URL>/api/salud` debe traer `"sentry": true`.
  Si dice `false`, la variable no llegó al contenedor.
- **Frontend**: el DSN queda dentro del JavaScript compilado. Abra el
  sitio, mire el `<script src="/assets/index-*.js">` y busque
  `ingest.sentry.io` dentro de ese archivo. Si no está, el build salió sin
  la variable: Vite la incrusta al compilar, no la lee en tiempo real.

Ojo con una trampa: **un 404 o un 403 NO generan evento en Sentry**, y está
bien que así sea. El manejador de `main.py` captura excepciones *no
manejadas*; un `HTTPException` lo responde FastAPI por su cuenta. Pedir una
URL inventada para "probar Sentry" no prueba nada y hace concluir que falló
cuando está perfecto.
