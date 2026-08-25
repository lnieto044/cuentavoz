# -*- coding: utf-8 -*-
"""Comprueba que el indice de un PDF no mienta.

Tres cosas, y las tres han fallado alguna vez mientras se construia esto:

  · que no queden huecos `@@PAG@@` sin rellenar (paso una vez, impresos en
    399 paginas);
  · que el enlace de cada fila este SOBRE esa fila y no sobre otra cosa -
    se ubicaban buscando el titulo, y el parrafo que introduce el indice
    nombra las secciones, asi que los enlaces caian ahi;
  · que el numero impreso coincida con el numero del pie de la pagina
    destino - si no, quien lea en papel se va a la pagina equivocada.

    python docs/verificar_indice.py <pdf> [pagina_indice]
"""
import re
import sys

import pymupdf

TAMANO_TITULO = 17.0


def encabezado_de(pagina):
    for bloque in pagina.get_text("dict")["blocks"]:
        for linea in bloque.get("lines", []):
            if max((s["size"] for s in linea["spans"]), default=0) >= TAMANO_TITULO:
                return "".join(s["text"] for s in linea["spans"]).strip()
    return ""


def pie_de(pagina):
    hallados = re.findall(r"(\d+)\s*/\s*\d+", pagina.get_text())
    return int(hallados[-1]) if hallados else None


def verificar(ruta, pagina_indice=2):
    doc = pymupdf.open(ruta)
    hoja = doc[pagina_indice - 1]
    fallos = []

    if "@@PAG@@" in hoja.get_text():
        fallos.append("quedan huecos @@PAG@@ sin rellenar en el indice")

    enlaces = sorted(doc[pagina_indice - 1].get_links(),
                     key=lambda x: x["from"].y0)
    enlaces = [e for e in enlaces if e.get("page", -1) >= 0]

    print("  %s  ·  %d paginas  ·  %d enlaces  ·  %d marcadores"
          % (ruta.split("/")[-1], doc.page_count, len(enlaces), len(doc.get_toc())))
    print()
    print("   indice | enlace | pie destino | encabezado destino")

    for enlace in enlaces:
        destino = enlace["page"] + 1
        # el numero impreso EN esa fila: el que cae dentro del rectangulo
        impreso, mejor = None, 1e9
        centro = (enlace["from"].y0 + enlace["from"].y1) / 2
        for bloque in hoja.get_text("dict")["blocks"]:
            for linea in bloque.get("lines", []):
                for tramo in linea["spans"]:
                    texto = tramo["text"].strip()
                    if not texto.isdigit() or tramo["bbox"][0] <= hoja.rect.x1 - 90:
                        continue
                    # el mas cercano al centro del enlace: el rectangulo se
                    # solapa con la fila de al lado y quedarse con el ultimo
                    # tomaba el numero del vecino
                    suyo = (tramo["bbox"][1] + tramo["bbox"][3]) / 2
                    if abs(suyo - centro) < mejor:
                        mejor, impreso = abs(suyo - centro), int(texto)
        pie = pie_de(doc[destino - 1])
        titulo = encabezado_de(doc[destino - 1])
        bien = impreso is not None and impreso == pie and titulo
        if not bien:
            fallos.append("fila que dice %s -> pagina %s (pie %s, %s)"
                          % (impreso, destino, pie, titulo or "sin encabezado"))
        print("   %-7s| %-7s| %-12s| %s %s"
              % (impreso, destino, pie, titulo[:46], "" if bien else "<-- MAL"))

    doc.close()
    print()
    if fallos:
        print("  %d problemas:" % len(fallos))
        for f in fallos:
            print("   · " + f)
        return 1
    print("  el indice esta bien: cada fila lleva a su seccion y el numero "
          "impreso coincide con el del pie")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    sys.exit(verificar(sys.argv[1],
                       int(sys.argv[2]) if len(sys.argv) > 2 else 2))
