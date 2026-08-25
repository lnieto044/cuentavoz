# Cómo se comprueba la accesibilidad

Dos herramientas que miden cosas distintas. Las dos recorren la aplicación
**de verdad**, en los dos roles, con la app corriendo.

| Archivo | Qué mide |
| --- | --- |
| `auditar-wcag.js` | Las reglas WCAG 2.1 A/AA con **axe-core**, el mismo motor que usan las auditorías profesionales, sobre las 17 pantallas. |
| `auditar-lector.js` | Lo que axe **no** puede medir: el árbol de accesibilidad que lee un lector de pantalla, el recorrido con teclado, el foco en los diálogos y las regiones que se anuncian solas. |

La segunda existe porque cumplir todas las reglas de axe no garantiza que la
aplicación se pueda usar sin ver. Un botón puede pasar todas las reglas y
anunciarse «botón» a secas; un diálogo puede cerrarse con Escape y dejar el
foco tirado en el `<body>`. Eso solo aparece mirando el árbol y tabulando.

## Qué hace falta

```
npm install playwright axe-core
npx playwright install chromium
```

Playwright y axe-core **no** son dependencias del proyecto: solo hacen falta
para correr esto, igual que para las capturas de `docs/capturas/`.

## Cómo se corre

Con el backend y el frontend levantados:

```
# backend
cd backend
ORIGEN_PERMITIDO="http://localhost:5183,http://127.0.0.1:5183" \
  python -m uvicorn main:app --port 8001

# frontend, en otra terminal
cd frontend
VITE_API_URL=http://127.0.0.1:8001 npx vite --port 5183 --strictPort
```

Y entonces:

```
node docs/accesibilidad/auditar-wcag.js
node docs/accesibilidad/auditar-lector.js
```

Las dos salen con código 0 si no hay hallazgos. Usan las cuentas de prueba
(`stephanie` y `diana`) y desactivan el tutorial de bienvenida para poder
recorrer las pantallas sin interrupciones.

## Estado a 2026-08-25

Las dos limpias: **cero incumplimientos WCAG A/AA** en las 17 pantallas, y
sin hallazgos en el árbol de accesibilidad (265 controles con nombre, foco
visible, diálogos que devuelven el foco, jerarquía de encabezados sin
saltos).

## Una advertencia sobre estas herramientas

Al escribirlas, dos comprobaciones daban **falso positivo** por estar mal
planteadas: el foco se medía con `.focus()` por programa, y el navegador solo
aplica `:focus-visible` cuando el foco llega por teclado; y las regiones
`aria-live` de Conteo se miraban en la pantalla de selección de bodega, donde
todavía no existen. Las dos decían «FALLA» sobre cosas que funcionaban.

Están corregidas, pero vale como aviso: **antes de arreglar lo que reporten,
compruebe que el hallazgo es real**. Una herramienta que avisa de problemas
que no existen se deja de mirar, y entonces no sirve para los que sí.

## Lo que esto NO reemplaza

Un lector de pantalla real (NVDA en Windows, VoiceOver en Mac). Estas
herramientas miden **la estructura** que el lector va a leer; no miden cómo
suena ni si la secuencia tiene sentido para quien la escucha. Con todo esto
en verde la base está puesta, pero afirmar «es compatible con lectores de
pantalla» sin matices exige media hora con NVDA abierto.
