# Cómo se regenera la guía técnica

La guía se escribe en HTML y se imprime a PDF con Chromium, igual que el
manual de usuario. **La hoja de estilos no se duplica**: `armar.py` la toma
de `docs/manual_v2/manual.html`, de modo que los dos documentos no puedan
separarse con el tiempo. Si alguien ajusta la tipografía del manual, la
guía la hereda en la siguiente corrida.

## Los archivos

| Archivo | Qué es |
| --- | --- |
| `cuerpo.html` | **Lo único que se edita a mano.** Las secciones 1 a 16: texto, tablas y avisos. |
| `codigo.py` | Genera la sección 17 (el código completo) **leyendo los archivos reales** del repositorio. Para agregar o quitar un archivo del apéndice, edite la lista `GRUPOS` de aquí. |
| capturas | Las figuras salen de `docs/capturas/`. Para refrescarlas: `node docs/capturas/recapturar.js`. |
| `guia.html` | Generado. `cuerpo.html` + los estilos del manual. No lo edite. |
| `portada.html` | Generado a partir de la portada del manual. No lo edite: los textos propios de la guía están dentro de `armar.py`. |
| `armar.py` | Arma `guia.html` y `portada.html`, y une el PDF final. |
| `generar_pdf.js` | Imprime portada y cuerpo a PDF con Chromium. |
| `_build/` | Intermedios. No se versiona. |

## Qué hace falta instalado

- **Python** con `pymupdf` — ya viene en `backend/.venv`.
- **Playwright** con Chromium:
  ```
  npm install playwright
  npx playwright install chromium
  ```

## Regenerar

Desde la raíz del repositorio, en este orden:

```
node docs/guia_tecnica/generar_pdf.js     # imprime portada y cuerpo
python docs/guia_tecnica/armar.py         # arma el HTML y une el PDF
```

El resultado queda en `docs/Guia_Tecnica_CuentaVoz_V5.pdf` (unas 390 páginas).

> **El código del apéndice no se transcribe: se genera.** Es la diferencia de
> fondo con la guía V4, que traía 270 páginas de código pegado a mano y quedó
> desactualizada al primer commit. Aquí basta con regenerar para que el listado
> impreso vuelva a coincidir con el repositorio.

> `armar.py` regenera `guia.html` y `portada.html` **antes** de unir, así que
> si cambió `cuerpo.html` puede correrlo primero para ver el HTML, y después
> el par completo para sacar el PDF.

## Al escribir

- Una sección por `<section>`, con `<h2 class="seccion">` y su número.
- Clases disponibles: `.seccion-intro`, `.pasos` (lista numerada), `.ui`
  (nombre de un control o archivo), `.dicho` (valor literal), `.aviso dato`
  (recuadro), `.rol-tag adm` (marca de administrador).
- Si agrega figuras, escriba `<b>Figura X</b>`: `armar.py` las renumera por
  orden de aparición. No las numere a mano.
