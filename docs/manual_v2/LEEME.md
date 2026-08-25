# Cómo se regenera el manual de usuario

Un solo comando, desde la raíz del repositorio:

```
python docs/manual_v2/armar.py
```

El resultado queda en `docs/Manual_Usuario_CuentaVoz_V2.pdf` (43 páginas).

## Los archivos

| Archivo | Qué es |
| --- | --- |
| `manual.html` | **Lo único que se edita a mano.** Las 16 secciones: texto, tablas, pasos y figuras. Trae también la hoja de estilos que hereda la guía técnica. |
| `portada.html` | La portada, a sangre completa. |
| `*.png` | Las capturas, 1440×900. Se refrescan con `node docs/capturas/recapturar.js`. |
| `generar_pdf.js` | Imprime portada y cuerpo con Chromium. Lo llama `armar.py`. |
| `armar.py` | El procedimiento completo: las dos pasadas, el índice y el PDF final. |
| `_build/` | Intermedios. No se versiona. |

## Por qué hacen falta dos impresiones

El índice muestra el número de página de cada sección, y ese número solo se
sabe cuando el PDF ya está armado — pero tiene que salir impreso **dentro**
del índice. Así que:

1. El HTML lleva un hueco `@@PAG@@` en cada fila, ya con su estilo final.
2. Se imprime una vez y se mide en qué página cayó cada sección.
3. Se rellenan los huecos y se vuelve a imprimir.
4. Sobre el PDF final se agregan los enlaces del índice y los marcadores.

Así el número sale en Barlow, como el resto del documento, en vez de
estamparlo encima con otra fuente. `armar.py` hace los cuatro pasos.

**Ojo:** el número que se imprime es el del **pie de página**, no el del
PDF. La portada no lleva número, así que el pie de la página 3 del PDF dice
«2». Si el índice mostrara la del PDF, quien lea en papel se iría una página
más adelante cada vez.

## Qué hace falta instalado

- **Python** con `pymupdf` — ya viene en `backend/.venv`.
- **Playwright** con Chromium: `npm install playwright && npx playwright install chromium`.

## Comprobar que el índice no miente

```
python docs/verificar_indice.py docs/Manual_Usuario_CuentaVoz_V2.pdf
```

Revisa tres cosas, y las tres fallaron mientras se construía esto: que no
queden huecos sin rellenar, que el enlace de cada fila esté sobre esa fila
—se ubicaban buscando el título, y el párrafo que introduce el índice
nombra las secciones—, y que el número impreso coincida con el del pie de la
página destino.

## Al escribir

- Una sección por `<section>`, con `<h2 class="seccion">` y su número.
- Si agrega una sección, agréguela también al `<div class="indice">` con su
  `<span class="pag">@@PAG@@</span>` al final del `<li>`. `armar.py` pone el
  número.
- Clases disponibles: `.seccion-intro`, `.pasos`, `.ui` (nombre de un
  control), `.dicho` (valor literal), `.aviso dato`, `.rol-tag adm`.
