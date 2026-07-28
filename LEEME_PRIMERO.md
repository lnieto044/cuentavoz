# CuentaVoz — arranque en 5 minutos

> Asistente por voz para la toma de inventarios · Hackathon Colsubsidio × 30X
> **Todo lo que necesita es gratis.** El proyecto ya viene con el extracto real
> de Colsubsidio cargado y probado. Estos pasos estan verificados de punta a
> punta (backend + frontend + datos reales) antes de subirse al repositorio.

---

## Requisitos (revisar antes de empezar)

| Necesita | Version | Verificar con |
|---|---|---|
| **Python** | **3.12** exacto | `python --version` (Windows: `py -3.12 --version`) |
| **Node.js** | 20 o superior | `node --version` |
| **Git** | cualquiera reciente | `git --version` |

> ⚠️ Si su equipo tiene varias versiones de Python instaladas, use siempre
> `py -3.12` (Windows) o `python3.12` (Mac/Linux) en los comandos de abajo,
> nunca `python` a secas — una version distinta a 3.12 puede fallar al
> instalar `pandas`/`sqlalchemy` o dar errores de sintaxis raros.
>
> ¿No tiene Python 3.12? Instalelo con:
> - **Windows:** `winget install --id Python.Python.3.12 -e`
> - **Mac:** `brew install python@3.12`
> - **Linux:** `sudo apt install python3.12 python3.12-venv`

---

## 1. Clonar y entrar al proyecto

```bash
git clone <url-del-repositorio> cuentavoz
cd cuentavoz
```

## 2. Backend

**Windows (PowerShell):**
```powershell
cd backend
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

**Mac/Linux:**
```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 3. Cargar los datos de Colsubsidio

```bash
cd ../data
python cargar_excel.py          # usa el mismo entorno activado arriba
```

Debe imprimir algo así:

```
  Bodegas en total:                 53
  Articulos del catalogo:           1040
  Registros de stock cargados:      1405
  SALDOS NEGATIVOS DETECTADOS:      79   <- el mini reto
```

> No importa desde que carpeta corra este paso o el siguiente: la base de
> datos SQLite siempre queda anclada a `backend/cuentavoz.db`.

## 4. Levantar la API

```bash
cd ../backend
uvicorn main:app --reload
```

Verifique en el navegador: **http://localhost:8000/api/salud**
Debe responder `{"api":"ok","bodegas":53,"articulos":1040,...}` — si ve
`"bodegas":0`, el paso 3 no se ejecuto contra esta misma base (vea la tabla
de fallos al final).

## 5. Frontend (abra otra terminal)

```bash
cd frontend
npm install
npm run dev
```

Abra **http://localhost:5173** en **Chrome o Edge** (Firefox no reconoce voz).

**Usuarios de prueba:** `luis` (auxiliar) y `diana` (administradora).
**PIN:** `StockXperts`

---

## La llave de Gemini (opcional pero recomendada)

La aplicación **funciona sin llave**: trae un intérprete local que entiende las
frases del guion. Con la llave entiende muchas más variantes.

1. Entre a **aistudio.google.com** con cualquier cuenta de Google.
2. **Get API key → Create API key in new project**. Es gratis, no pide tarjeta.
3. Copie la clave (empieza por `AIza`) y péguela en el archivo `.env` (cópielo
   primero desde `.env.ejemplo` si no existe todavía):

```
GOOGLE_API_KEY=AIza...su_llave
```

4. Reinicie la API. En el menú Ayuda verá «Agente Gemini: operativo».

---

## El guion del pitch — ya probado, funciona

Entre como `luis`, vaya a **Conteo**, abra `almacen suministros` y diga:

| Diga esto | Debe pasar esto |
|---|---|
| «tres tablas para picar blancas» | Ofrece las **dos** tablas blancas con su código |
| «la FB» | Elige la 97503004 y pide confirmación |
| «confirmo» | Guarda y anuncia el avance |
| «noventa cazuelas» | Ofrece las dos cazuelas |
| «la primera» | **«El sistema espera alrededor de 10. ¿Confirma 90?»** |
| «uy no son nueve» | Corrige a 9 sin borrar nada |
| «confirmo» | Guarda |
| «menos dos kilos de arroz» | Rechaza: una cantidad no puede ser negativa |
| «cuánto arroz hay y en qué bodegas» | Responde el total y dónde está |

Después vaya a **Pedidos**, escriba `ajiaco` y `50`, y pulse **Calcular el
pedido**: explota la receta y muestra solo lo que falta.

---

## Con Docker (si prefiere)

```bash
docker compose up --build
docker compose exec api python ../data/cargar_excel.py
```

Igual: API en `:8000`, aplicación en `:5173`, PostgreSQL en `:5432`
(para que Power BI pueda conectarse).

---

## Si algo falla

| Lo que ve | Qué significa | Solución |
|---|---|---|
| «no se encontró Python... Microsoft Store» | El alias de Windows Store tapa el `python` real, o no hay 3.12 instalado | Instale con `winget install --id Python.Python.3.12 -e` y use `py -3.12` |
| `No module named 'sqlalchemy'` | El entorno virtual no está activo | Active `.venv` y repita `pip install -r requirements.txt` |
| Falla al compilar una dependencia (`Visual C++ 14.0 required`, etc.) | Esta usando una version de Python de 32 bits o muy antigua | Reinstale con Python **3.12 de 64 bits** desde winget/python.org |
| `salud` responde `bodegas: 0` | Faltó cargar el Excel, o se cargó apuntando a otra base | `cd data && python cargar_excel.py` con el mismo entorno del backend |
| El micrófono no hace nada | El navegador no es Chrome/Edge, o falta permiso | Use Chrome y acepte el permiso |
| «Agente: Local» en Ayuda | No hay llave de Gemini | Es normal; el flujo funciona igual |
| `port is already allocated` | Otro programa usa el 8000 | `uvicorn main:app --port 8001` y ajuste `VITE_API_URL` |
| `npm install` falla con `ENOSPC` | Sin espacio en disco | Libere espacio (`npm cache clean --force` ayuda) y repita |

---

## Cómo está organizado

```
backend/
  main.py                  la API: 27 endpoints
  modelos.py               las 12 tablas
  bd.py                    conexion a la base (ruta SQLite fija a backend/)
  seguridad.py             bcrypt, token JWT, permisos por perfil, rate limit
  agente/cerebro.py        Gemini (con respaldo local)
  agente/orquestador.py    intención → herramienta → validación
  servicios/
    conciliacion.py        «tabla blanca» → código oficial
    validacion.py          negativos, unidades, el 9 vs 90
    recetas.py             pedido por receta y legalización
    interprete.py          respaldo sin internet
data/
  BODEGAS_Y_STOCK.xlsx     el extracto real de Colsubsidio
  cargar_excel.py          lo carga a la base
frontend/src/
  App.jsx                  el enrutador y el menú
  vistas/                  13 pantallas
  voz.js                   escuchar y hablar (es-CO)
  index.css                paleta oficial de Colsubsidio
```

---

## Qué falta y qué está listo

**Listo y probado de punta a punta:** ingreso con perfiles, apertura de bodega
con candado de sesión (por botón y por voz), conciliación de nombres contra el
catálogo real, validación de negativos y unidades, la alerta del 9 vs 90,
corrección sin borrar, consulta hablada, consolidado XLSX para My Inventory,
pedido por receta, legalización, análisis de subutilización, registro de
trazabilidad, límite de intentos de ingreso y tablero en vivo por WebSocket.

**Falta, si le queda tiempo:** cargar el archivo oficial de recetas de
Colsubsidio (hoy hay dos de ejemplo armadas con artículos reales del
catálogo), y publicar el informe de Power BI para insertarlo en el menú Panel.
