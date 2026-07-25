# CuentaVoz · «Tu voz cuenta»

Asistente conversacional por voz para la captura de información en las cocinas
y bodegas de Colsubsidio.
**Reto de Hotelería · Hackathon Colsubsidio × 30X · julio de 2026**

> **Arranque rápido: lea [LEEME_PRIMERO.md](LEEME_PRIMERO.md)**

---

## El problema

Hoy la información entra al sistema pasando por papel: alguien escribe, otro
digita. Ahí nacen los errores — un «9» que se vuelve «90», una unidad mal
leída, un producto confundido con otro parecido.

## La solución

Un agente que escucha, entiende cómo habla la bodega, concilia contra el
catálogo oficial, valida al instante y registra directo en digital.

## Los tres momentos manuales que cubre

| Momento | Dónde | Qué hace |
|---|---|---|
| **1. Pedido al almacén** | menú Pedidos | «hoy preparamos cincuenta ajiacos» → explota la receta, descuenta el stock y pide solo lo que falta |
| **2. Toma física** | menú Conteo y Bodegas | dicta y el agente concilia, valida y registra |
| **3. Legalización** | menú Legalización | lo pedido contra lo usado, con sobrante y merma explicados |

## Lo que valida antes de guardar

- **Nombres que no coinciden:** «tabla para picar blanca» → `TABLA ACRILICA PICAR BLANCO 50X38CM FB` (97503004). Y cuando hay dos candidatas, pregunta.
- **Cantidades fuera de lo esperado:** «noventa cazuelas» → *«el sistema espera alrededor de 10, ¿confirma 90?»*
- **Unidades equivocadas:** «cinco kilos» no se confunde con cinco gramos.
- **Saldos imposibles:** una cantidad negativa se rechaza con explicación.

## Datos reales

El prototipo carga el extracto entregado por Colsubsidio:
**53 bodegas · 1.040 artículos · 1.405 registros de stock · 79 saldos
negativos detectados** (el mini reto).

## Stack

React (PWA) · FastAPI · PostgreSQL · Gemini vía Google AI Studio · Power BI ·
Docker. Todo gratuito.

## Seguridad

Contraseñas con bcrypt, sesiones con token JWT que vence, permisos por perfil,
consultas por ORM, secretos fuera del repositorio y registro de trazabilidad
inmutable. Alineado con la Ley 1581 de 2012.

## Equipo

Luis Guillermo Nieto Patiño · Valentina Burbano Salazar · Stephanie · Diana
