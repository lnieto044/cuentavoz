<div align="center">

<img src="frontend/public/logo.png" width="72" alt="CuentaVoz" />

# CuentaVoz

### 🎙️ Plataforma inteligente para la captura de inventarios por voz

**Desarrollado por el equipo StockXperts** 🚀

<br>

[![React](https://img.shields.io/badge/React-18-149ECA?style=for-the-badge&logo=react&logoColor=white)](frontend)
[![FastAPI](https://img.shields.io/badge/FastAPI-Python-0B9260?style=for-the-badge&logo=fastapi&logoColor=white)](backend)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-produccion-336791?style=for-the-badge&logo=postgresql&logoColor=white)](backend/bd.py)
[![Gemini AI](https://img.shields.io/badge/Google_Gemini-agente_de_voz-1B3A6B?style=for-the-badge&logo=googlegemini&logoColor=white)](backend/agente)
[![AWS Cognito](https://img.shields.io/badge/AWS_Cognito-identidad-D4A017?style=for-the-badge&logo=amazoncognito&logoColor=white)](backend/seguridad.py)
[![Render](https://img.shields.io/badge/Render-despliegue-46E3B7?style=for-the-badge&logo=render&logoColor=white)](DESPLIEGUE.md)

<br>

<img src="docs/capturas/panel-principal.png" width="100%" alt="Panel principal de CuentaVoz" />

<br>

**Reto de Hotelería · Hackathon Colsubsidio × 30X · julio de 2026**

</div>

---

# 📑 Índice

- [📌 Descripción](#-descripción)
- [✨ Características principales](#-características-principales)
- [🖼️ Capturas](#️-capturas)
- [🏗️ Arquitectura](#️-arquitectura)
- [🔄 Momentos que cubre](#-los-tres-momentos-manuales-que-cubre)
- [🛡️ Validaciones inteligentes](#️-validaciones-inteligentes)
- [♿ Accesibilidad](#-accesibilidad)
- [🔐 Ingreso seguro](#-ingreso-seguro)
- [📊 Datos reales](#-datos-reales)
- [🚀 Tecnologías](#-tecnologías)
- [🔒 Seguridad](#-seguridad)
- [▶️ Ejecutar y desplegar](#️-ejecutar-y-desplegar)
- [🔑 Acceso de prueba](#-acceso-de-prueba)
- [👥 Equipo](#-equipo--stockxperts)

---

# 📌 Descripción

**CuentaVoz** es un asistente conversacional por voz diseñado para facilitar la captura de información en cocinas y bodegas de Colsubsidio.

Actualmente, gran parte de esta información puede pasar por procesos manuales:

**Papel → Digitación → Validación → Registro**

Este flujo puede generar errores como:

- Un `9` registrado como `90`.
- Una unidad incorrecta.
- Un producto confundido con otro similar.
- Diferencias entre el inventario físico y el registrado.

CuentaVoz transforma este proceso utilizando:

**🎙️ Voz + 🧠 Inteligencia Artificial + ✅ Validaciones automáticas**

La plataforma:

- 🎙️ Escucha al usuario.
- 🧠 Interpreta el lenguaje utilizado en bodega.
- 📚 Concilia la información contra el catálogo oficial.
- ✅ Valida cantidades y unidades.
- 📦 Calcula necesidades de pedido.
- 🧾 Registra la información digitalmente.
- 📊 Genera trazabilidad y reportes.

Todo dentro de una misma plataforma.

---

# 🎬 Así se ve en acción

<div align="center">

<img src="docs/capturas/pedidos-flujo.gif" width="100%" alt="Flujo de pedidos de CuentaVoz" />

<br>

<sub>

<strong>Flujo real:</strong> se selecciona un plato, se confirma la cantidad y CuentaVoz calcula únicamente lo que hace falta solicitar.

</sub>

</div>

---

# ✨ Características principales

## 🎙️ Pedidos por voz

> “Hoy preparamos cincuenta ajiacos”

CuentaVoz interpreta la solicitud, consulta la receta, descuenta el inventario disponible y calcula únicamente los ingredientes que hacen falta pedir.

---

## 🧮 Conteo conversacional

El usuario puede dictar las cantidades y el agente realiza la conciliación contra el catálogo oficial antes de registrar la información.

---

## 👩‍🍳 Recetas administrables

Permite administrar:

- Ingredientes.
- Rendimientos.
- Preparación.
- Información asociada a cada receta.

La configuración puede gestionarse desde **Ajustes**.

---

## ✅ Aprobación de pedidos

Los pedidos pueden ser revisados y aprobados por el auditor antes de continuar hacia el almacén.

---

## 🔐 Ingreso seguro

La identidad la administra AWS Cognito. La plataforma permite:

- Registro propio (queda siempre como auxiliar de inventarios).
- Ingreso con usuario + clave, con detección automática del perfil.
- Recuperar la clave por correo si se olvida.
- Verificación en dos pasos opcional (código de una app autenticadora),
  activable desde el registro o desde Mi perfil.

---

## 📊 Panel gerencial

Permite visualizar información relacionada con:

- Exactitud por bodega.
- Diferencias.
- Stock por unidad.

---

## 📁 Reportes y trazabilidad

Generación de consolidados exportables y registro de las acciones realizadas dentro de la plataforma.

---

## ☁️ Preparado para producción

Arquitectura preparada para despliegue mediante:

**Render + Static Site + Web Service + PostgreSQL**

---

# 🖼️ Capturas

La interfaz de CuentaVoz utiliza un diseño responsivo que se adapta a:


-  📲 Tablets.
-  📱 Celulares.
-  💻 Computadores.

## 🎬 Recorrido narrado, uno por rol

<sub>Es el mismo video que la aplicación abre sola la primera vez que alguien
ingresa, y que queda siempre a la mano en <b>Ayuda › Ver el recorrido en
video</b>. Cada uno recorre únicamente las pantallas de su perfil, con sus
pestañas completas y haciendo las cosas de verdad contra la aplicación: se
dicta un conteo y se confirma, se genera un reporte, se responde un mensaje.</sub>

| Rol | Duración | Qué recorre |
| --- | --- | --- |
| **[👷 Auxiliar de inventarios](frontend/public/recorrido-auxiliar.mp4)** | 5:05 | Ingreso · Inicio · Pedidos · Conteo · Legalización · Bodegas · Ayuda (escribirle al administrador y reportar un problema) · Mensajes · Mi perfil · qué pasa cuando se cae la señal en plena bodega · cerrar sesión |
| **[🧑‍💼 Administrador de bodega](frontend/public/recorrido-administrador.mp4)** | 7:20 | Todo lo anterior más Auditoría (sus 4 pestañas) · Reportes (2) · Panel (2) · Ajustes (4) · aprobar pedidos y productos · responderle al equipo · cerrar sesión |

<sub>GitHub no reproduce estos MP4 dentro de la página: dele clic al nombre del
rol para abrirlo, o descárguelo desde <code>frontend/public/</code>.</sub>

## 🎥 Recorrido animado por las 14 pantallas principales

<sub>Cada GIF recorre el menú completo (Ingreso → Inicio → Pedidos → Conteo →
Legalización → Bodegas → Auditoría → Reportes → Panel → Ajustes → Ayuda →
Mensajes → Mi perfil → Cerrar sesión) real contra producción, en el ancho
correspondiente a cada dispositivo.</sub>

<details open>
<summary><b>📲 Ver el recorrido en tablet</b></summary>

<div align="center">
<img src="docs/capturas/recorrido-tablet.gif" width="520" alt="Recorrido completo en tablet" />
</div>

</details>

<details>
<summary><b>📱 Ver el recorrido en celular</b></summary>

<div align="center">
<img src="docs/capturas/recorrido-movil.gif" width="340" alt="Recorrido completo en celular" />
</div>

</details>

<details>
<summary><b>💻 Ver el recorrido en PC</b></summary>

<div align="center">
<img src="docs/capturas/recorrido-pc.gif" width="800" alt="Recorrido completo en PC" />
</div>

</details>

<details>
<summary><b>📸 Ver cada pantalla como foto fija</b> (para revisar el detalle de una vista puntual, en vez del recorrido animado)</summary>

---

# 💻 Vista tablet

<div align="center">

## 🏠 Inicio

<img src="docs/capturas/tablet/inicio.png" width="100%" alt="Inicio de CuentaVoz en tablet" />

<br>

## 🏢 Bodegas

<img src="docs/capturas/tablet/bodegas.png" width="100%" alt="Bodegas de CuentaVoz en tablet" />

<br>

## 📊 Panel gerencial

<img src="docs/capturas/tablet/panel.png" width="100%" alt="Panel gerencial de CuentaVoz en tablet" />

</div>

---

<details>

<summary><strong>📸 Ver las otras 11 capturas de tablet</strong></summary>

<br>

### 🔑 Ingreso

Detección automática del perfil.

<img src="docs/capturas/tablet/ingreso.png" width="100%" alt="Ingreso de CuentaVoz" />

---

### 🎙️ Pedidos por voz

Receta + stock = pedido calculado.

<img src="docs/capturas/tablet/pedidos.png" width="100%" alt="Pedidos por voz" />

---

### 📦 Conteo

Tablero de bodegas listas para contar.

<img src="docs/capturas/tablet/conteo.png" width="100%" alt="Conteo de inventario" />

---

### 🧾 Legalización

Pedidos y líneas de servicio.

<img src="docs/capturas/tablet/legalizacion.png" width="100%" alt="Legalización" />

---

### 🛡️ Auditoría

Recuento ciego, aprobaciones y cierre.

<img src="docs/capturas/tablet/auditoria.png" width="100%" alt="Auditoría" />

---

### 📊 Reportes

Trazabilidad exportable.

<img src="docs/capturas/tablet/reportes.png" width="100%" alt="Reportes" />

---

### ⚙️ Ajustes

Catálogo, recetas y configuración.

<img src="docs/capturas/tablet/ajustes.png" width="100%" alt="Ajustes" />

---

### ❓ Ayuda

Preguntas frecuentes y comandos de voz.

<img src="docs/capturas/tablet/ayuda.png" width="100%" alt="Ayuda" />

---

### 👤 Mi perfil

Datos personales y seguridad de la cuenta.

<img src="docs/capturas/tablet/mi-perfil.png" width="100%" alt="Mi perfil" />

---

### 💬 Mensajes

Soporte en vivo entre auxiliares y administrador.

<img src="docs/capturas/tablet/mensajes.png" width="100%" alt="Mensajes" />

---

### 🚪 Cerrar sesión

Confirmación antes de salir si existe trabajo sin guardar.

<img src="docs/capturas/tablet/cerrar-sesion.png" width="100%" alt="Cerrar sesión" />

</details>

---

# 📱 Experiencia en celular

CuentaVoz incorpora un diseño responsivo para dispositivos móviles.

En resoluciones de **600 px o menos**, el menú lateral pasa a una barra horizontal deslizable ubicada en la parte superior.

Esto permite aprovechar mejor el espacio disponible en teléfonos.

---

## 🏠 Inicio

<div align="center">

<img src="docs/capturas/movil/inicio.png" width="360" alt="Inicio de CuentaVoz en celular" />

</div>

---

## 🎙️ Pedidos

<div align="center">

<img src="docs/capturas/movil/pedidos.png" width="360" alt="Pedidos de CuentaVoz en celular" />

</div>

---

## 🏢 Bodegas

<div align="center">

<img src="docs/capturas/movil/bodegas.png" width="360" alt="Bodegas de CuentaVoz en celular" />

</div>

> 📱 **Diseño responsive real:** la interfaz adapta navegación, contenidos y controles al tamaño de pantalla.

</details>

---

## 🏗️ Arquitectura

```mermaid
flowchart LR
    U["👤 Usuario<br/>(voz o texto)"] --> FE["React + Vite<br/>Static Site en Render"]
    FE -- "HTTPS / access token" --> API["FastAPI<br/>Web Service en Render"]
    FE -. "registro, login, clave" .-> COGNITO["AWS Cognito<br/>identidad"]
    API --> DB[("PostgreSQL<br/>(SQLite en local)")]
    API --> GEMINI["Google Gemini<br/>agente de voz"]
    API -. "respaldo sin llave" .-> INTERPRETE["Intérprete local<br/>(reglas + fuzzy match)"]
```

Frontend y backend se despliegan por separado (un "Static Site" solo sirve
archivos; el backend necesita correr código de verdad) — ver
[Arquitectura de despliegue](DESPLIEGUE.md).

## ✅ Los tres momentos manuales que cubre

| Momento | Dónde | Qué hace |
|---|---|---|
| **1. Pedido al almacén** | menú Pedidos | «hoy preparamos cincuenta ajiacos» → explota la receta, descuenta el stock y pide solo lo que falta |
| **2. Toma física** | menú Conteo y Bodegas | dicta y el agente concilia, valida y registra |
| **3. Legalización** | menú Legalización | concilia lo pedido contra lo usado, con sobrante y merma explicados |

### 🛡️ Lo que valida antes de guardar

- **Nombres que no coinciden:** «tabla para picar blanca» → `TABLA ACRILICA PICAR BLANCO 50X38CM FB` (97503004). Y cuando hay dos candidatas, pregunta.
- **Cantidades fuera de lo esperado:** «noventa cazuelas» → *«el sistema espera alrededor de 10, ¿confirma 90?»*
- **Unidades equivocadas:** «cinco kilos» no se confunde con cinco gramos.
- **Saldos imposibles:** una cantidad negativa se rechaza con explicación.

## ♿ Accesibilidad

Pensada para que la use cualquier persona, incluida gente con discapacidad —
un criterio que Colsubsidio pidió explícitamente para este reto, no un
agregado de último momento:

- **Navegación completa por teclado:** el menú principal, los modales y
  todos los campos se manejan sin mouse (Tab, Enter, Escape).
- **Etiquetas accesibles** en los controles que solo tenían un ícono:
  micrófonos, interruptores y grupos de botones usados como selectores.
- **Foco visible** en toda la aplicación, con contraste verificado contra
  el estándar WCAG AA tanto en el sidebar oscuro como en el resto de
  pantallas claras.
- **Modales semánticos** (`role="dialog"`, foco atrapado, cierre con
  Escape) en vez de simples `<div>` con estilo de ventana.
- **Regiones en vivo** (`aria-live`) para que un lector de pantalla
  anuncie las respuestas del agente sin que el usuario tenga que ir a
  buscarlas.
- **Soporte para movimiento reducido**, respetando la preferencia del
  sistema operativo.
- **Áreas táctiles** de al menos 44px, cómodas también en tablet.

Diseñada y verificada siguiendo las pautas WCAG 2.1 AA — no reemplaza una
auditoría formal con lectores de pantalla certificados, pero cubre las
fallas que hoy suelen dejar afuera a un usuario que no usa mouse.

## 🔐 Ingreso seguro

La identidad la maneja AWS Cognito: registro propio, ingreso con
usuario + clave y recuperación de clave por correo, con el perfil
(auxiliar / administrador) detectado solo al escribir — nadie tiene
que elegirlo a mano. Verificación en dos pasos opcional con app
autenticadora (Google Authenticator, Microsoft Authenticator...), que
se puede activar desde el registro o después desde Mi perfil.

## 📊 Datos reales

El prototipo carga el extracto entregado por Colsubsidio:
**54 bodegas · 1.041 artículos · 1.405 registros de stock · 79 saldos
negativos detectados** (el mini reto).

---

## 🚀 Tecnologías

<table>
<tr><td><b>Backend</b></td><td>Python · FastAPI · SQLAlchemy · SQLite (local) / PostgreSQL (producción) · AWS Cognito · Google Gemini AI</td></tr>
<tr><td><b>Frontend</b></td><td>React · Vite · CSS propio, sin framework de UI</td></tr>
<tr><td><b>Despliegue</b></td><td>Render (Static Site + Web Service) · Docker / docker-compose para desarrollo local</td></tr>
</table>

## 🔒 Seguridad

Identidad y contraseñas administradas por AWS Cognito (nunca las ve este
backend), verificación en dos pasos opcional con app autenticadora,
sesiones con access token que vence (revocable de inmediato al cerrar
todas las sesiones), permisos por perfil reforzados también por
asignación de bodega (auditados con tests de regresión), consultas por
ORM sin SQL armado a mano, límite de tasa en los endpoints sensibles,
cabeceras de seguridad (incluida HSTS), secretos fuera del repositorio y
registro de trazabilidad inmutable. Alineado con la Ley 1581 de 2012.
Detalle técnico en **[ARQUITECTURA.md](ARQUITECTURA.md#seguridad)**.

---

## 📚 Recursos del proyecto

| Recurso                      | Descripción                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| 💻 **Guía de ejecución**     | Requisitos y puesta en marcha local → **[LEEME_PRIMERO.md](LEEME_PRIMERO.md)**                           |
| ☁️ **Guía de despliegue**    | Despliegue en Render con Static Site, Web Service y PostgreSQL → **[DESPLIEGUE.md](DESPLIEGUE.md)**      |
| 🧭 **Arquitectura**          | Estructura del código, dependencias y modelo de datos → **[ARQUITECTURA.md](ARQUITECTURA.md)**           |
| 🤖 **Guía técnica**          | Manual técnico completo: arquitectura, agente de voz, modelo de datos, autenticación, pruebas, despliegue, las 14 vistas con **todas sus subvistas** (74 capturas), y **el código fuente completo** (76 archivos, 21.448 líneas), 399 pág., con índice numerado y navegable → **[PDF](docs/Guia_Tecnica_CuentaVoz_V5.pdf)** |
| 📖 **Manual de usuario**     | Guía de capacitación para el personal de bodega, en el orden del menú y con paso a paso en cada pantalla, 62 pág. y 64 capturas —cada pantalla con todas sus subvistas—, con índice numerado y navegable → **[PDF](docs/Manual_Usuario_CuentaVoz_V2.pdf)** |
| 🎬 **Recorrido en video**    | Narrado, uno por rol, el mismo que la aplicación abre al ingresar → **[ver arriba](#-recorrido-narrado-uno-por-rol)** |
| 🧪 **Recorridos completos**  | Pruebas que levantan la aplicación y la recorren entera —conteo, pedidos, auditoría y permisos— sobre una copia de la base → **[frontend/pruebas-flujo/](frontend/pruebas-flujo/LEEME.md)** |
| ♿ **Accesibilidad**         | Cómo se comprueba, y con qué: axe-core sobre las 17 pantallas más una auditoría del árbol que lee un lector de pantalla → **[docs/accesibilidad/](docs/accesibilidad/LEEME.md)** |
| 🎞️ **Presentación**         | Presentación para Colsubsidio, 16 diapositivas → **[PPTX](docs/CuentaVoz_Colsubsidio_V2.pptx)**          |
| 🌐 **Demo en línea**         | Aplicación desplegada → **https://cuentavoz.onrender.com**                                               |
| 🎥 **Video de demostración** | Recorrido y funcionamiento del proyecto → **https://www.youtube.com/watch?v=4tSRTV5POd4**                |


### 🔑 Acceso de prueba

La aplicación crea estos usuarios sola la primera vez que arranca (ver
`backend/main.py: arranque()`):

| Usuario | Código de empleado | Clave | Perfil |
|---|---|---|---|
| `luis` | `CS-48127` | `StockXperts1` | Auxiliar de inventarios |
| `diana` | `CS-48200` | `StockXperts1` | Administradora de bodega |
| `stephanie` | `CS-48311` | `StockXperts1` | Auxiliar de inventarios |
| `valentina` | `CS-48342` | `StockXperts1` | Auxiliar de inventarios |

El ingreso es con el nombre de usuario (no con el código de empleado).

---

## 👥 Equipo – StockXperts

- 👨‍💻 **Luis Guillermo Nieto Patiño** — Diseño funcional y experiencia de usuario
- 👩‍💻 **Diana Carolina Argüello Casallas** — Análisis de requerimientos y documentación
- 👩‍💻 **Valentina Burbano Salazar** — Desarrollo Full Stack, arquitectura e integración de IA
- 👩‍💻 **Luz Stephanie Puentes Morantes** — Validación funcional y apoyo al desarrollo

---
