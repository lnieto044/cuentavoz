# -*- coding: utf-8 -*-
"""Arma el manual de usuario completo, con el indice numerado y navegable.

Hasta ahora el manual se imprimia a mano desde un script suelto que vivia
fuera del repositorio. Aqui queda el procedimiento entero, que ademas
necesita DOS pasadas de impresion:

  1. Se imprime con los huecos `@@PAG@@` del indice.
  2. Se mide en que pagina cayo cada seccion, se rellenan los huecos y se
     vuelve a imprimir - ahora con los numeros de verdad.
  3. Sobre el PDF final se agregan los enlaces del indice y los marcadores
     del lector.

Antes de imprimir se restauran los huecos, para que correrlo dos veces
seguidas no acumule numeros viejos.

    node docs/manual_v2/generar_pdf.js   (lo llama este script)
    python docs/manual_v2/armar.py
"""
import io
import os
import re
import subprocess
import sys

import pymupdf

AQUI = os.path.dirname(os.path.abspath(__file__))     # docs/manual_v2
DOCS = os.path.dirname(AQUI)                          # docs
RAIZ = os.path.dirname(DOCS)

HTML = os.path.join(AQUI, "manual.html")
SALIDA = os.path.join(DOCS, "Manual_Usuario_CuentaVoz_V2.pdf")
BUILD = os.path.join(AQUI, "_build")
IMPRESOR = os.path.join(AQUI, "generar_pdf.js")

sys.path.insert(0, DOCS)
import numerar_indice as ix                            # noqa: E402

PAGINA_INDICE = 2        # 1 es la portada
DESFASE = -1             # la portada no lleva numero impreso en el pie


def restaurar_huecos():
    """Deja el indice como estaba: <span class="pag">@@PAG@@</span>.

    Sin esto, una segunda corrida encontraria numeros en vez de huecos y
    no tendria donde escribir los nuevos."""
    t = io.open(HTML, encoding="utf-8").read()
    nuevo, n = re.subn(r'(<span class="pag">)[^<]*(</span>)',
                       r"\g<1>%s\g<2>" % ix.MARCA, t)
    if n:
        io.open(HTML, "w", encoding="utf-8").write(nuevo)
    return n


def imprimir():
    subprocess.run(["node", IMPRESOR], cwd=RAIZ, check=True)
    partes = [os.path.join(BUILD, f) for f in ("_portada.pdf", "_cuerpo.pdf")]
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


huecos = restaurar_huecos()
print("  indice: %d huecos listos" % huecos)

print("  pasada 1 (medir)...")
imprimir()
titulos, paginas = ix.medir(SALIDA, HTML, desde=PAGINA_INDICE)
puestos = ix.rellenar_huecos(HTML, titulos, paginas, DESFASE)
print("  %d de %d secciones numeradas" % (puestos, len(titulos)))

print("  pasada 2 (definitiva)...")
total = imprimir()
enlaces, marcas = ix.enlazar_y_marcar(SALIDA, titulos, paginas, PAGINA_INDICE)
print("  %d filas enlazadas, %d marcadores" % (enlaces, marcas))
print("PDF: %d paginas -> %s" % (total, SALIDA))
