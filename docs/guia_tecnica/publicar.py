# -*- coding: utf-8 -*-
"""Publica la guia tecnica completa, de una sola corrida.

Antes habia que encadenar a mano `armar.py`, `generar_pdf.js` y otra vez
`armar.py`, y el orden importaba. Con el indice numerado se volvio peor,
porque hacen falta DOS impresiones: una para medir en que pagina cae cada
seccion y otra ya con los numeros escritos. Encadenar eso a mano es como
se imprimieron 399 paginas con "@@PAG@@" en el indice.

Aqui queda el procedimiento entero:

  1. armar.py  -> guia.html + portada.html (con los huecos del indice)
  2. imprimir  -> PDF con huecos
  3. medir     -> en que pagina empieza cada seccion; rellenar cuerpo.html
  4. armar.py  -> guia.html con los numeros de verdad
  5. imprimir  -> PDF definitivo
  6. enlazar   -> clic en cada fila del indice + marcadores del lector

    python docs/guia_tecnica/publicar.py
"""
import io
import os
import re
import subprocess
import sys

import pymupdf

AQUI = os.path.dirname(os.path.abspath(__file__))     # docs/guia_tecnica
DOCS = os.path.dirname(AQUI)
RAIZ = os.path.dirname(DOCS)

CUERPO = os.path.join(AQUI, "cuerpo.html")
ARMAR = os.path.join(AQUI, "armar.py")
IMPRESOR = os.path.join(AQUI, "generar_pdf.js")
BUILD = os.path.join(AQUI, "_build")
SALIDA = os.path.join(DOCS, "Guia_Tecnica_CuentaVoz_V5.pdf")

sys.path.insert(0, DOCS)
import numerar_indice as ix                            # noqa: E402

PAGINA_INDICE = 2
DESFASE = -1        # la portada no lleva numero impreso en el pie


def restaurar_huecos():
    t = io.open(CUERPO, encoding="utf-8").read()
    nuevo, n = re.subn(r'(<span class="pag">)[^<]*(</span>)',
                       r"\g<1>%s\g<2>" % ix.MARCA, t)
    if n:
        io.open(CUERPO, "w", encoding="utf-8").write(nuevo)
    return n


def armar():
    subprocess.run([sys.executable, ARMAR], cwd=RAIZ, check=True,
                   stdout=subprocess.DEVNULL)


def imprimir():
    subprocess.run(["node", IMPRESOR], cwd=RAIZ, check=True,
                   stdout=subprocess.DEVNULL)
    partes = [os.path.join(BUILD, f) for f in ("_g_portada.pdf", "_g_cuerpo.pdf")]
    faltan = [p for p in partes if not os.path.exists(p)]
    if faltan:
        raise SystemExit("no se generaron: %s" % ", ".join(faltan))
    doc = pymupdf.open()
    for p in partes:
        con = pymupdf.open(p)
        doc.insert_pdf(con)
        con.close()
    doc.save(SALIDA, garbage=4, deflate=True)
    total = doc.page_count
    doc.close()
    return total


print("  indice: %d huecos listos" % restaurar_huecos())

print("  pasada 1 (medir)...")
armar()
imprimir()
titulos, paginas = ix.medir(SALIDA, CUERPO, desde=PAGINA_INDICE)
puestos = ix.rellenar_huecos(CUERPO, titulos, paginas, DESFASE)
print("  %d de %d secciones numeradas" % (puestos, len(titulos)))

print("  pasada 2 (definitiva)...")
armar()
total = imprimir()
enlaces, marcas = ix.enlazar_y_marcar(SALIDA, titulos, paginas, PAGINA_INDICE)
print("  %d filas enlazadas, %d marcadores" % (enlaces, marcas))
print("PDF: %d paginas -> %s" % (total, SALIDA))
