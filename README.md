<div align="center">

<img src="frontend/public/logo.png" width="72" alt="CuentaVoz" />

# CuentaVoz

### 🎙️ Plataforma inteligente para la captura de inventarios por voz

**Desarrollado por el equipo StockXperts** 🚀

<br>

[![React](https://img.shields.io/badge/React-18-149ECA?style=for-the-badge&logo=react&logoColor=white)](frontend)
[![FastAPI](https://img.shields.io/badge/FastAPI-Python-0B9260?style=for-the-badge&logo=fastapi&logoColor=white)](backend)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Producción-336791?style=for-the-badge&logo=postgresql&logoColor=white)](backend/bd.py)
[![Gemini AI](https://img.shields.io/badge/Google_Gemini-Agente_de_voz-1B3A6B?style=for-the-badge&logo=googlegemini&logoColor=white)](backend/agente)
[![WebAuthn](https://img.shields.io/badge/WebAuthn-Ingreso_seguro-D4A017?style=for-the-badge)](backend/servicios/huella.py)
[![Render](https://img.shields.io/badge/Render-Despliegue-46E3B7?style=for-the-badge&logo=render&logoColor=white)](DESPLIEGUE.md)

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

La plataforma permite:

- Usuario o código de empleado.
- PIN.
- Detección automática del perfil.
- Autenticación mediante WebAuthn.
- Windows Hello.
- Touch ID.
- Huella compatible del dispositivo.

---

## 📊 Panel gerencial

Permite visualizar información relacionada con:

- Exactitud por bodega.
- Diferencias.
- Stock por unidad.
- Información preparada para análisis en Power BI.

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

- 💻 Computadores.
- 📱 Celulares.
- 📲 Tablets.

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

---

# 🏗️ Arquitectura

```mermaid
flowchart LR
    U["👤 Usuario<br/>(voz o texto)"] --> FE["React + Vite<br/>Static Site en Render"]

    FE -- "HTTPS / JWT" --> API["FastAPI<br/>Web Service en Render"]

    FE -. WebAuthn .-> BIO["Windows Hello / Touch ID<br/>del dispositivo"]

    API --> DB[("PostgreSQL<br/>(SQLite en local)")]

    API --> GEMINI["Google Gemini<br/>agente de voz"]

    API -. "respaldo sin llave" .-> INTERPRETE["Intérprete local<br/>(reglas + fuzzy match)"]
