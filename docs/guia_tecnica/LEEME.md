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
| `guia.html` | Generado, **no se versiona**. `cuerpo.html` + los estilos del manual + el apéndice de código. No lo edite: la próxima corrida lo sobrescribe. |
| `portada.html` | Generado a partir de la portada del manual, **no se versiona**. No lo edite: los textos propios de la guía están dentro de `armar.py`. |
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
python docs/guia_tecnica/armar.py         # arma guia.html y portada.html
node docs/guia_tecnica/generar_pdf.js     # los imprime a PDF
python docs/guia_tecnica/armar.py         # une el PDF final
```

`armar.py` va primero **y** al final: la primera corrida escribe el HTML que
Chromium necesita (que no está en el repositorio, se genera), y la segunda une
las dos partes impresas. Correrlo dos veces no cuesta nada — la primera vez
avisa «corra antes: node …» porque todavía no hay qué unir.

El resultado queda en `docs/Guia_Tecnica_CuentaVoz_V5.pdf` (391 páginas).

> **El código del apéndice no se transcribe: se genera.** Es la diferencia de
> fondo con la guía V4, que traía 270 páginas de código pegado a mano y quedó
> desactualizada al primer commit. Aquí basta con regenerar para que el listado
> impreso vuelva a coincidir con el repositorio.

> `armar.py` regenera `guia.html` y `portada.html` en **cada** corrida, así que
> si solo quiere revisar el HTML tras editar `cuerpo.html`, córralo suelto y
> abra `guia.html` en el navegador. Ninguno de los dos se versiona.

## Al escribir

- Una sección por `<section>`, con `<h2 class="seccion">` y su número.
- Clases disponibles: `.seccion-intro`, `.pasos` (lista numerada), `.ui`
  (nombre de un control o archivo), `.dicho` (valor literal), `.aviso dato`
  (recuadro), `.rol-tag adm` (marca de administrador).
- Si agrega figuras, escriba `<b>Figura X</b>`: `armar.py` las renumera por
  orden de aparición. No las numere a mano.
