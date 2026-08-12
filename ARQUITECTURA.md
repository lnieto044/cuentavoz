# Arquitectura de CuentaVoz

Guía técnica para quien llega nuevo al código: qué hace cada pieza, por
qué se eligió cada librería y cómo fluye una petición de punta a punta.
El README explica el producto; esto explica el código.

## Índice

[Vista general](#vista-general) · [Por qué cada librería](#por-qué-cada-librería-backend) ·
[Mapa del backend](#mapa-del-backend) · [Mapa del frontend](#mapa-del-frontend) ·
[Modelo de datos](#modelo-de-datos) · [El agente conversacional](#el-agente-conversacional) ·
[Modo sin conexión](#modo-sin-conexión-pwa) · [Seguridad](#seguridad) · [Tests](#tests)

## Vista general

Dos servicios independientes, cada uno desplegado por separado en Render
(ver [DESPLIEGUE.md](DESPLIEGUE.md)):

```
┌─────────────────────┐        HTTPS + JWT        ┌──────────────────────┐
│  frontend/  (React)  │ ─────────────────────────▶│  backend/  (FastAPI)  │
│  Static Site         │◀───────────────────────── │  Web Service          │
└─────────────────────┘                            └──────────┬───────────┘
                                                                │
                                          ┌─────────────────────┼─────────────────────┐
                                          ▼                     ▼                     ▼
                                   PostgreSQL/SQLite      Google Gemini          Intérprete local
                                   (bd.py, modelos.py)    (agente/cerebro.py)    (servicios/interprete.py)
```

El backend es una API REST pura (sin plantillas ni HTML) más un
WebSocket para el tablero en vivo. El frontend es una SPA que habla con
esa API por `fetch()`. No comparten proceso ni código — cualquier
cliente HTTP podría reemplazar al frontend.

## Por qué cada librería (backend)

| Librería | Para qué | Por qué esta y no otra |
|---|---|---|
| `fastapi` | El framework de la API | Tipado con Pydantic (valida el body de cada request solo), `Depends()` para inyectar `usuario_actual` en cada endpoint sin repetirlo, y genera `/docs` (Swagger) gratis. |
| `uvicorn[standard]` | Servidor ASGI | Necesario porque FastAPI corre sobre ASGI, no WSGI (hace falta para el WebSocket del tablero en vivo). `[standard]` trae `websockets` y `httptools` sin instalarlos aparte. |
| `sqlalchemy` | ORM | Todas las consultas pasan por el ORM (`s.query(...)`), nunca SQL armado a mano — así una inyección SQL no es un vector de ataque posible aquí, ver [Seguridad](#seguridad). También abstrae SQLite (local) vs PostgreSQL (producción) sin cambiar una línea de código de negocio. |
| `psycopg2-binary` | Driver de PostgreSQL | Solo se usa en producción (Render); en local, SQLAlchemy usa el driver de SQLite que ya trae Python. |
| `pandas` + `openpyxl` | Leer/escribir Excel | `data/cargar_excel.py` importa el catálogo real de Colsubsidio desde `.xlsx`; `reportes.py` genera los consolidados descargables en el mismo formato que ya usa el equipo. |
| `rapidfuzz` | Coincidencia difusa de texto | El corazón de `servicios/conciliacion.py`: convierte «tabla para picar blanca» (como lo dice alguien en la bodega) en el nombre oficial del catálogo. Es una librería en C (vía bindings), mucho más rápida que comparar cadenas en Python puro para 1.000+ artículos. |
| `google-genai` | Cliente de Gemini | El modelo entiende la intención detrás de una frase dicha con lenguaje natural (`agente/cerebro.py`) y genera la voz neuronal de las respuestas. Se llama solo si `GOOGLE_API_KEY` está configurada — sin ella, cae al intérprete local sin romper nada (ver [El agente conversacional](#el-agente-conversacional)). |
| `python-dotenv` | Cargar `.env` en desarrollo | `load_dotenv()` en `main.py` lee variables de entorno de un archivo local; en producción (Render) esas mismas variables ya existen en el entorno del proceso, así que esta librería no hace nada allí — es puramente para no tener que exportar variables a mano en cada sesión de terminal local. |
| `pyjwt` + `bcrypt` | Sesión y contraseñas | `bcrypt` hashea el PIN (nunca se guarda en texto plano); `pyjwt` firma un token con expiración y un `perfil` embebido, que cada endpoint verifica vía `Depends(usuario_actual)`. |
| `python-multipart` | Subida de archivos | FastAPI lo exige para poder recibir `UploadFile` (la foto de perfil llega como `multipart/form-data`, no JSON). |
| `slowapi` | Límite de tasa | Protege `/api/ingresar` y otros endpoints sensibles contra fuerza bruta (`@limiter.limit("5/minute")`) sin escribir un middleware de rate-limiting a mano. |
| `webauthn` | Huella del dispositivo | Implementa el protocolo WebAuthn real (reto criptográfico, verificación de firma y `origin`) para el ingreso con Windows Hello/Touch ID/huella de Android — no es una simulación, ver `servicios/huella.py`. |

## Por qué cada librería (frontend)

| Librería | Para qué | Por qué esta y no otra |
|---|---|---|
| `react` + `react-dom` | La UI | Sin Redux ni otro gestor de estado: cada vista (`vistas/*.jsx`) maneja su propio estado con `useState`/`useEffect` porque las pantallas no comparten datos entre sí más allá del `token`/`usuario` que pasa `App.jsx`. Añadir una librería de estado global sería complejidad sin beneficio real para este tamaño de app. |
| `vite` | Bundler y servidor de desarrollo | Arranque y recarga en caliente casi instantáneos (a diferencia de Create React App/Webpack), y el build de producción (`vite build`) es el que sirve Render como Static Site. |
| `@vitejs/plugin-react` | Soporte JSX/Fast Refresh en Vite | Sin él, Vite no sabe transformar `.jsx` ni mantener el estado de un componente al guardar el archivo en desarrollo. |
| `vite-plugin-pwa` | Service worker + manifest | Genera el `sw.js` que cachea el cascarón de la app (HTML/JS/CSS/logos) la primera vez que carga con señal, para que la URL vuelva a abrir sin Wi-Fi después — ver [Modo sin conexión](#modo-sin-conexión-pwa). Sin CSS/UI framework: no hay Tailwind ni Material UI; todo el estilo vive en `index.css` a mano, con variables CSS para la paleta de marca de Colsubsidio. |

No hay librería de gráficas (los tableros de `Panel.jsx`/`Reportes.jsx`
son barras y donas hechas con `<div>` y `conic-gradient`, sin
dependencias) ni de formularios (los `<input>` son controlados a mano) —
decisiones deliberadas para mantener el bundle pequeño en una app que se
usa desde una tableta compartida.

## Mapa del backend

```
backend/
├── main.py                — todos los endpoints REST + el WebSocket del tablero. El punto de entrada.
├── bd.py                  — la conexión (SQLAlchemy engine + sessionmaker). Todo lo demás importa Sesion de aquí.
├── modelos.py              — las tablas (ver Modelo de datos).
├── seguridad.py            — hash de PIN, JWT, Depends(usuario_actual)/requiere_perfil().
├── reportes.py             — genera los .xlsx descargables (consolidado, diferencias, estado de bodegas).
│
├── agente/
│   ├── cerebro.py          — el "pensar": llama a Gemini, cae a interprete.py si no hay llave o falla.
│   └── orquestador.py      — el "actuar": procesar_turno(), la máquina de estados de la conversación
│                              (qué bodega está abierta, qué queda pendiente de confirmar, etc.)
│
└── servicios/
    ├── conciliacion.py      — buscar_articulo(): texto dicho -> artículo del catálogo oficial (rapidfuzz).
    ├── validacion.py        — las reglas duras (cantidad negativa, unidad equivocada, desviación >umbral).
    ├── interprete.py        — el intérprete local (sin IA): números en palabras + intenciones por
    │                          palabra clave, para que la demo no dependa de tener internet.
    ├── recetas.py           — calcular_pedido() (receta × porciones − stock) y comparar_legalizacion().
    ├── huella.py             — registro/verificación WebAuthn.
    └── analitica.py          — las métricas del Panel gerencial, calculadas en vivo sobre la misma base.
```

**Por qué `agente/` está separado de `servicios/`:** todo lo que vive en
`agente/` entiende de *conversación* (qué se dijo antes, qué se espera
ahora); todo lo que vive en `servicios/` es una función pura de negocio
que no sabe que existe una conversación — `orquestador.py` es el único
que conecta ambos mundos. Esta separación es la que permite que
`interpreteLocal.js` (frontend) reimplemente solo `servicios/interprete.py`
sin tener que reimplementar la máquina de estados completa.

## Mapa del frontend

```
frontend/src/
├── main.jsx                — arranca React. No tiene lógica.
├── App.jsx                 — dueño de la sesión (login/logout, qué vista se ve) y del menú lateral.
├── api.js                  — pedir(): el único punto por donde pasa cada llamada al backend
│                              (agrega el token, traduce errores de red, detecta 401).
├── voz.js                  — escuchar() (Web Speech API del navegador) y hablar() (voz neuronal
│                              vía backend, con voz del navegador de respaldo si falla).
├── webauthn.js              — el lado cliente de WebAuthn (conversión base64url <-> buffers).
├── interpreteLocal.js       — puerto a JS de servicios/interprete.py, para el modo sin conexión.
├── index.css                — todo el estilo de la app (sin framework de CSS).
├── Marco.jsx / BarraLateral.jsx / Dialogo.jsx / Iconos.jsx  — piezas de layout compartidas por
│                              todas las vistas.
└── vistas/                  — una pantalla por archivo, mapeadas en App.jsx:MENU.
    ├── Ingreso.jsx           — login (usuario/PIN o huella).
    ├── Inicio.jsx            — resumen del día según el perfil.
    ├── Pedido.jsx            — "hoy preparamos cincuenta ajiacos" -> calcula insumos.
    ├── Conteo.jsx            — el conteo físico por voz, con modo sin conexión (ver más abajo).
    ├── Legalizacion.jsx      — lo pedido contra lo usado, con sobrante y merma.
    ├── Bodegas.jsx           — tablero en vivo (WebSocket) + detalle por bodega.
    ├── Auditoria.jsx         — recuento ciego, aprobaciones, cierre con doble firma.
    ├── Reportes.jsx          — consolidados exportables y su vista previa.
    ├── Panel.jsx             — panel gerencial (solo perfil auditor).
    ├── Ajustes.jsx           — catálogo, usuarios, recetas, trazabilidad.
    ├── MiPerfil.jsx          — datos personales, cambio de PIN, huella, preferencias de voz.
    └── CerrarSesion.jsx      — modal de confirmación de salida.
```

**Por qué cada vista es un archivo:** no hay enrutador (`react-router` ni
similar) — `App.jsx` decide qué componente mostrar con un simple
`VISTAS[vista]`, porque la navegación de esta app es un menú fijo, no URLs
profundas que alguien necesite compartir o marcar como favoritas.

## Modelo de datos

17 tablas (`modelos.py`), sin nada memorable que resaltar salvo estas
decisiones de diseño:

- **Nada se borra ni se sobreescribe.** Un conteo corregido no reemplaza
  al anterior: `Conteo.corrige_a` apunta al registro original, que queda
  con `estado="corregido"` en vez de desaparecer. `Traza` es la bitácora
  de auditoría, y solo crece (ver [Seguridad](#seguridad)).
- **`AsignacionBodega`** es la tabla que decide qué bodegas ve/abre cada
  auxiliar — casi todos los bugs de autorización que se corrigieron en
  este proyecto eran endpoints que se olvidaban de consultarla.
- **`AliasArticulo`** es la memoria de `conciliacion.py`: cada vez que
  alguien confirma una coincidencia ambigua, se guarda el texto dicho
  junto al código oficial, así la próxima vez la búsqueda no necesita
  fuzzy-match para esa frase exacta.

## El agente conversacional

Tres niveles de respaldo, de más a menos capaz, todos con la misma forma
de entrada/salida (`{intencion, articulo_texto, cantidad, unidad,
respuesta_hablada, ...}`):

1. **Gemini** (`agente/cerebro.py:pensar()`) — entiende lenguaje natural
   de verdad, incluida negación ("no quiero preparar arroz") y frases
   fuera de guion. Requiere `GOOGLE_API_KEY` e internet.
2. **Intérprete local en Python** (`servicios/interprete.py`) — si
   Gemini no responde (sin llave, sin internet, error de la API),
   `pensar()` cae aquí sin que el resto del sistema lo note. Es
   reconocimiento de palabras clave y números en palabras, no NLU real —
   ver su docstring. Corre en el servidor.
3. **Intérprete local en JavaScript** (`frontend/src/interpreteLocal.js`)
   — puerto 1:1 del anterior, con sus propios 30 tests (`npm test`).
   Corre en el navegador para cuando ni siquiera el *backend* es
   alcanzable (ver [Modo sin conexión](#modo-sin-conexión-pwa)).

`agente/orquestador.py:procesar_turno()` es quien recibe el resultado de
cualquiera de los dos niveles de Python y decide qué hacer con él (abrir
bodega, dejar un conteo pendiente de confirmar, desambiguar entre dos
candidatos, etc.) — ni Gemini ni el intérprete local saben nada de la
conversación en curso, solo de la frase que se les pasó.

## Modo sin conexión (PWA)

Pensado para el escenario real de una bodega con Wi-Fi malo, no para
funcionar 100% sin datos móviles/Wi-Fi de por vida:

- **La app carga sin red** gracias al service worker
  (`vite-plugin-pwa`, configurado en `vite.config.js`) — pero necesita
  haber cargado *una vez* con señal para quedar cacheada.
- **La sesión se restaura sola** (`api.js:leerSesion()`,
  `App.jsx`) sin volver a pedir login, porque el login sí necesita
  backend.
- **Conteo.jsx** tiene una cola en `localStorage`
  (`cv_offline_<sesionId>`): lo que se cuenta sin señal se guarda ahí, un
  formulario de texto libre lo interpreta con `interpreteLocal.js`, y al
  volver la conexión se sincroniza solo, quitando de la cola únicamente
  lo que de verdad se confirmó (no todo el lote si algo falla a mitad).
- **Pedido.jsx** *no* tiene cola: calcular un pedido necesita el stock en
  vivo de la bodega, así que solo avisa que hace falta señal en vez de
  simular un cálculo con datos viejos — ver el comentario en
  `Pedido.jsx` junto a `useState(offline)`.
- El reconocimiento de **voz** (`voz.js:escuchar()`, Web Speech API del
  navegador) generalmente necesita internet — no es algo que esta app
  controle. Sin conexión, el camino confiable es texto escrito.

## Seguridad

Resumen; ver `seguridad.py`, `main.py` y los tests en
`tests/test_regresiones_seguridad.py` para el detalle.

- **Autenticación:** JWT (`pyjwt`) firmado con `SECRETO_JWT`, con un
  campo `ver` (versión) que se compara contra `Usuario.version_token` —
  subir esa versión (cambiar el PIN, "cerrar todas las sesiones")
  invalida todos los tokens anteriores sin necesidad de una lista de
  revocación.
- **Autorización por perfil y por asignación:** `requiere_perfil("auditor")`
  protege lo administrativo; `AsignacionBodega` limita a cada auxiliar a
  su zona — reforzado tanto en los endpoints REST como en el flujo de
  voz (`agente/orquestador.py:_abrir()`), que antes se lo saltaba.
- **Contraseñas:** bcrypt, nunca texto plano; cambiar el PIN exige el
  PIN vigente (no basta con tener un token abierto).
- **Sin SQL armado a mano:** todo pasa por el ORM de SQLAlchemy.
- **Cabeceras de seguridad** (`main.py:cabeceras`): `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, `Strict-Transport-Security`.
- **Límite de tasa** (`slowapi`) en login, cambio de PIN y registro de
  huella.
- **CORS** restringido a los orígenes en `ORIGEN_PERMITIDO` (el dominio
  del frontend desplegado) más los puertos de desarrollo local.
- **Usuarios de demo:** la app crea automáticamente `luis`/`diana`/etc.
  con la clave pública `StockXperts` (ver README) — es intencional para
  que cualquiera pueda probar la demo sin pedir acceso; en un despliegue
  que no sea esta demo, cámbiense esas contraseñas o desactívese ese
  arranque en `main.py:arranque()`.

## Tests

```
backend/tests/
├── test_interprete.py               — 29 tests: números en palabras, unidades, cada intención.
├── test_cerebro.py                  — limpieza de negaciones, respaldo sin Gemini.
├── test_orquestador_desambiguacion.py — _resolver_candidato/_elegir (funciones puras, sin DB).
├── test_agente_conversacion.py       — conversaciones completas de extremo a extremo vía
│                                       /api/agente/turno (abrir, contar, desambiguar, corregir...).
├── test_regresiones_seguridad.py     — autorización, sesión, IDOR, WebSocket.
└── test_regresiones_legalizacion.py  — idempotencia del cierre de servicio.

frontend/src/interpreteLocal.test.js  — 30 tests (node --test), los mismos casos que
                                        test_interprete.py, para confirmar que el puerto a JS
                                        se comporta igual que el original en Python.
```

```bash
# backend
cd backend && .venv/Scripts/python -m pytest -q

# frontend (intérprete local en JS)
cd frontend && npm test
```
