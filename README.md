<div align="center">

<img width="72" alt="CuentaVoz" src="frontend/public/logo.png" />

# CuentaVoz

### Plataforma inteligente para la captura de inventarios por voz

**Desarrollado por el equipo StockXperts** 🚀

[![React](https://img.shields.io/badge/React-18-149ECA?style=for-the-badge&logo=react&logoColor=white)](frontend)
[![FastAPI](https://img.shields.io/badge/FastAPI-Python-0B9260?style=for-the-badge&logo=fastapi&logoColor=white)](backend)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-produccion-336791?style=for-the-badge&logo=postgresql&logoColor=white)](backend/bd.py)
[![Gemini AI](https://img.shields.io/badge/Google_Gemini-agente_de_voz-1B3A6B?style=for-the-badge&logo=googlegemini&logoColor=white)](backend/agente)
[![WebAuthn](https://img.shields.io/badge/WebAuthn-ingreso_con_huella-D4A017?style=for-the-badge)](backend/servicios/huella.py)
[![Render](https://img.shields.io/badge/Render-despliegue-46E3B7?style=for-the-badge&logo=render&logoColor=white)](DESPLIEGUE.md)

<br/>

<img width="900" alt="Panel principal de CuentaVoz" src="docs/capturas/panel-principal.png" />

<sub>*Reto de Hotelería · Hackathon Colsubsidio × 30X · julio de 2026*</sub>

</div>

<br/>

## Índice

[Descripción](#-descripción) · [Características](#-características-principales) · [Capturas](#️-capturas) ·
[Arquitectura](#-arquitectura) · [Momentos que cubre](#-los-tres-momentos-manuales-que-cubre) ·
[Ingreso seguro](#-ingreso-seguro) · [Datos reales](#-datos-reales) · [Tecnologías](#-tecnologías) ·
[Seguridad](#-seguridad) · [Ejecutar / Desplegar](#️-ejecutar-y-desplegar) · [Equipo](#-equipo--stockxperts)

---

## 📌 Descripción

CuentaVoz es un asistente conversacional por voz para la captura de
información en las cocinas y bodegas de Colsubsidio. Hoy esa información
entra al sistema pasando por papel — alguien escribe, otro digita — y ahí
nacen los errores: un «9» que se vuelve «90», una unidad mal leída, un
producto confundido con otro parecido.

CuentaVoz escucha, entiende cómo habla la bodega, concilia contra el
catálogo oficial, valida al instante y registra directo en digital —
integrando pedidos, conteos, legalización, auditoría, recetas y reportes en
una sola plataforma, con datos reales de Colsubsidio desde el primer
momento.

## ✨ Características principales

| | |
|---|---|
| 🎙️ **Pedidos por voz** | «hoy preparamos cincuenta ajiacos» → explota la receta, descuenta el stock y calcula solo lo que falta pedir |
| 🧮 **Conteo conversacional** | dicta las cantidades, el agente concilia contra el catálogo oficial y valida en el momento |
| 👩‍🍳 **Recetas administrables** | ingredientes, rendimiento y preparación paso a paso, editables desde Ajustes |
| ✅ **Aprobación de pedidos** | el auditor revisa y aprueba antes de que el pedido salga al almacén |
| 🔐 **Ingreso seguro** | usuario o código de empleado, perfil detectado solo, y huella del dispositivo (WebAuthn) |
| 📊 **Panel gerencial** | exactitud por bodega, diferencias, stock por unidad, listo para Power BI |
| 📁 **Reportes y trazabilidad** | consolidados exportables y bitácora inmutable de cada acción |
| ☁️ **Listo para producción** | Render (Static Site + Web Service + PostgreSQL), documentado paso a paso |

## 🖼️ Capturas

<sub>Todas las vistas funcionando en **modo tablet** (el diseño responsivo real de la aplicación, no un mockup de escritorio).</sub>

<table>
<tr>
<td width="50%"><img src="docs/capturas/tablet/ingreso.png" alt="Ingreso" /><br/><sub>Ingreso con detección automática de perfil</sub></td>
<td width="50%"><img src="docs/capturas/tablet/inicio.png" alt="Inicio" /><br/><sub>Inicio: lo que hay para hoy, según el perfil</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/capturas/tablet/pedidos.png" alt="Pedidos por voz" /><br/><sub>Pedidos por voz: receta + stock = pedido calculado</sub></td>
<td width="50%"><img src="docs/capturas/tablet/conteo.png" alt="Conteo" /><br/><sub>Conteo: tablero de bodegas listas para contar</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/capturas/tablet/legalizacion.png" alt="Legalización" /><br/><sub>Legalización de pedidos y líneas de servicio</sub></td>
<td width="50%"><img src="docs/capturas/tablet/bodegas.png" alt="Bodegas" /><br/><sub>Bodegas: estado en vivo, filtros y doble firma</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/capturas/tablet/auditoria.png" alt="Auditoría" /><br/><sub>Auditoría: recuento ciego, aprobaciones y cierre</sub></td>
<td width="50%"><img src="docs/capturas/tablet/reportes.png" alt="Reportes" /><br/><sub>Reportes y trazabilidad exportable</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/capturas/tablet/panel.png" alt="Panel gerencial" /><br/><sub>Panel gerencial: exactitud, diferencias y stock</sub></td>
<td width="50%"><img src="docs/capturas/tablet/ajustes.png" alt="Ajustes" /><br/><sub>Ajustes: catálogo, recetas y configuración</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/capturas/tablet/ayuda.png" alt="Ayuda" /><br/><sub>Ayuda: preguntas frecuentes y comandos de voz</sub></td>
<td width="50%"><img src="docs/capturas/tablet/mi-perfil.png" alt="Mi perfil" /><br/><sub>Mi perfil: datos personales y seguridad de la cuenta</sub></td>
</tr>
</table>

## 🏗️ Arquitectura

```mermaid
flowchart LR
    U["👤 Usuario<br/>(voz o texto)"] --> FE["React + Vite<br/>Static Site en Render"]
    FE -- "HTTPS / JWT" --> API["FastAPI<br/>Web Service en Render"]
    FE -. WebAuthn .-> BIO["Windows Hello / Touch ID<br/>del dispositivo"]
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
| **3. Legalización** | menú Legalización | lo pedido contra lo usado, con sobrante y merma explicados |

### 🛡️ Lo que valida antes de guardar

- **Nombres que no coinciden:** «tabla para picar blanca» → `TABLA ACRILICA PICAR BLANCO 50X38CM FB` (97503004). Y cuando hay dos candidatas, pregunta.
- **Cantidades fuera de lo esperado:** «noventa cazuelas» → *«el sistema espera alrededor de 10, ¿confirma 90?»*
- **Unidades equivocadas:** «cinco kilos» no se confunde con cinco gramos.
- **Saldos imposibles:** una cantidad negativa se rechaza con explicación.

## 🔐 Ingreso seguro

Usuario o código de empleado + PIN, con el perfil (auxiliar / administrador)
detectado solo al escribir — nadie tiene que elegirlo a mano. Cada persona
puede además registrar la huella de su propio dispositivo (WebAuthn: Windows
Hello, Touch ID o huella de Android) para entrar sin volver a teclear el PIN
en ese equipo.

## 📊 Datos reales

El prototipo carga el extracto entregado por Colsubsidio:
**53 bodegas · 1.041 artículos · 1.405 registros de stock · 79 saldos
negativos detectados** (el mini reto).

---

## 🚀 Tecnologías

<table>
<tr><td><b>Backend</b></td><td>Python · FastAPI · SQLAlchemy · SQLite (local) / PostgreSQL (producción) · JWT + bcrypt · WebAuthn · Google Gemini AI</td></tr>
<tr><td><b>Frontend</b></td><td>React · Vite · CSS propio, sin framework de UI</td></tr>
<tr><td><b>Despliegue</b></td><td>Render (Static Site + Web Service) · Docker / docker-compose para desarrollo local</td></tr>
</table>

## 🔒 Seguridad

Contraseñas con bcrypt, sesiones con token JWT que vence, ingreso opcional
con huella del dispositivo (WebAuthn), permisos por perfil, consultas por
ORM, secretos fuera del repositorio y registro de trazabilidad inmutable.
Alineado con la Ley 1581 de 2012.

---

## ▶️ Ejecutar y desplegar

| | |
|---|---|
| 💻 **Local** | Requisitos, pasos verificados de punta a punta → **[LEEME_PRIMERO.md](LEEME_PRIMERO.md)** |
| ☁️ **Render** | Static Site + Web Service + PostgreSQL, paso a paso → **[DESPLIEGUE.md](DESPLIEGUE.md)** |
| 🤖 **El agente** | Manual técnico de construcción → **[Guía técnica del agente]([docs/capturas/Guia_Tecnica_Agente_CuentaVoz_V3.1.pdf])** |
| 🌐 **Demo** | **https://cuentavoz.onrender.com**  |
| 🎥 **Video** | *Próximamente* |

### 🔑 Acceso de prueba

La aplicación crea estos usuarios sola la primera vez que arranca (ver
`backend/main.py: arranque()`):

| Usuario | Código de empleado | PIN | Perfil |
|---|---|---|---|
| `luis` | `CS-48127` | `StockXperts` | Auxiliar de inventarios |
| `diana` | `CS-48200` | `StockXperts` | Administradora de bodega |
| `stephanie` | `CS-48311` | `StockXperts` | Auxiliar de inventarios |
| `valentina` | `CS-48342` | `StockXperts` | Auxiliar de inventarios |

Se puede entrar con el usuario o con el código de empleado, indistintamente.

---

## 👥 Equipo – StockXperts

- 👨‍💻 **Luis Guillermo Nieto Patiño** — Diseño funcional y experiencia de usuario
- 👩‍💻 **Diana Carolina Argüello Casallas** — Análisis de requerimientos y documentación
- 👩‍💻 **Valentina Burbano Salazar** — Desarrollo Full Stack, arquitectura e integración de IA
- 👩‍💻 **Luz Stephanie Puentes Morantes** — Validación funcional y apoyo al desarrollo

---

<div align="center">

Proyecto desarrollado para la **Hackatón Colsubsidio × 30X**.

© 2026 — **Equipo StockXperts**

</div>
