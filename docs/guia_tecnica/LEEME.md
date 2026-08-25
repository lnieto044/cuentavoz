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

Un solo comando, desde la raíz del repositorio:

```
python docs/guia_tecnica/publicar.py
```

El resultado queda en `docs/Guia_Tecnica_CuentaVoz_V5.pdf` (399 páginas).

Hace falta un solo comando porque el índice numerado obliga a **dos
impresiones**: el número de página solo se sabe con el PDF ya armado, pero
tiene que salir impreso dentro del índice. Encadenar eso a mano es como se
imprimieron 399 páginas con `@@PAG@@` en el índice. El guion hace:

1. `armar.py` → `guia.html` + `portada.html`, con los huecos del índice
2. imprimir → PDF con huecos
3. medir en qué página cayó cada sección y rellenar `cuerpo.html`
4. `armar.py` otra vez → ahora con los números de verdad
5. imprimir el PDF definitivo
6. enlazar cada fila del índice y agregar los marcadores del lector

Para comprobar que el índice no miente:

```
python docs/verificar_indice.py docs/Guia_Tecnica_CuentaVoz_V5.pdf
```

Revisa que no queden huecos sin rellenar, que el enlace de cada fila esté
sobre esa fila y no sobre otra cosa, y que el número impreso coincida con el
del pie de la página destino. Las tres han fallado alguna vez.

## Al escribir

- Una sección por `<section>`, con `<h2 class="seccion">` y su número.
- Clases disponibles: `.seccion-intro`, `.pasos` (lista numerada), `.ui`
  (nombre de un control o archivo), `.dicho` (valor literal), `.aviso dato`
  (recuadro), `.rol-tag adm` (marca de administrador).
- Si agrega figuras, escriba `<b>Figura X</b>`: `armar.py` las renumera por
  orden de aparición. No las numere a mano.
