# -*- coding: utf-8 -*-
"""Le pone numero de pagina al indice, y lo vuelve navegable.

El problema: el numero de pagina solo se sabe cuando el PDF ya esta
armado, pero tiene que aparecer impreso DENTRO del indice. Se resuelve en
dos pasadas:

  1. El HTML trae un hueco `@@PAG@@` en cada fila del indice (con el
     estilo definitivo ya puesto, ver `.indice .pag`).
  2. Se imprime el PDF con los huecos, se mide en que pagina empieza cada
     seccion, se rellenan los huecos en el HTML y se vuelve a imprimir.

Asi el numero sale con la misma tipografia que el resto del documento, en
vez de estamparlo encima con otra fuente.

Despues, sobre el PDF final, se agregan dos cosas que no salen de imprimir
un HTML:

  · un enlace en cada fila del indice, que salta a esa pagina;
  · el indice lateral del lector de PDF (marcadores), que es lo que
    permite moverse por el documento sin volver al principio.

Como se miden las paginas: buscando los encabezados de seccion por su
TAMANO de letra. `h2.seccion` se imprime a 22pt y nada mas en el documento
llega a ese tamano, asi que no hay forma de confundir un titulo con una
mencion del mismo texto en un parrafo - que es justo lo que pasaria
buscando por texto.
"""
import io
import os
import re
import sys

import pymupdf

MARCA = "@@PAG@@"
TAMANO_MINIMO_TITULO = 17.0     # h2.seccion va a 22pt; el cuerpo, a 10-11


def _normalizar(t):
    return re.sub(r"\s+", " ", (t or "")).strip().lower()


def titulos_del_indice(html):
    """Los titulos tal como estan escritos en el indice, en orden."""
    inicio = html.index('<div class="indice">')
    fin = html.index("</ol>", inicio)
    bloque = html[inicio:fin]
    crudos = re.findall(r'<span class="t">(.*?)</span>', bloque)
    titulos = []
    for x in crudos:
        # el <em class="menu-ref"> es una pista ("Menú: Inicio"), no parte
        # del titulo: dejarla dentro hacia que no calzara con el encabezado
        x = re.sub(r"<em[^>]*>.*?</em>", "", x, flags=re.S)
        titulos.append(re.sub(r"<[^>]+>", "", x).strip())
    return titulos


def paginas_de_secciones(doc, titulos, desde=1):
    """En que pagina (1..n) empieza cada titulo. None si no aparece."""
    encontrados = {}
    pendientes = {_normalizar(t): t for t in titulos}
    for numero in range(desde, doc.page_count):
        pagina = doc[numero]
        for bloque in pagina.get_text("dict")["blocks"]:
            for linea in bloque.get("lines", []):
                texto = "".join(s["text"] for s in linea["spans"])
                grande = max((s["size"] for s in linea["spans"]), default=0)
                if grande < TAMANO_MINIMO_TITULO:
                    continue
                # el encabezado trae el numero de seccion pegado al titulo
                limpio = _normalizar(re.sub(r"^\s*\d+\s*", "", texto))
                for clave in list(pendientes):
                    if clave and (limpio == clave or limpio.startswith(clave)):
                        encontrados[pendientes[clave]] = numero + 1
                        del pendientes[clave]
                        break
    return encontrados


def rellenar_huecos(ruta_html, titulos, paginas, desfase=0):
    """Cambia cada @@PAG@@ por su numero, en el orden del indice.

    `desfase` traduce la pagina del PDF al numero IMPRESO en el pie. La
    portada va sin numerar, asi que el pie de la pagina 3 del PDF dice "2":
    si el indice mostrara la del PDF, quien lea en papel se iria una pagina
    mas adelante cada vez. El enlace, en cambio, sigue apuntando a la
    pagina del PDF, que es lo que entiende el lector."""
    t = io.open(ruta_html, encoding="utf-8").read()
    if MARCA not in t:
        return 0
    faltan = []
    for titulo in titulos:
        n = paginas.get(titulo)
        if n is None:
            faltan.append(titulo)
            n = ""
        else:
            n = n + desfase
        t = t.replace(MARCA, str(n), 1)
    io.open(ruta_html, "w", encoding="utf-8").write(t)
    if faltan:
        print("  sin numero (no se encontro el encabezado): %s" % ", ".join(faltan))
    return len(titulos) - len(faltan)


def _filas_del_indice(hoja):
    """Las filas del indice, por el numero de pagina impreso a la derecha.

    Ubicarlas por su titulo no sirve: search_for devuelve la primera
    aparicion del texto en la pagina, y el parrafo que introduce el indice
    nombra las secciones. Los numeros de la derecha, en cambio, solo
    existen en las filas."""
    borde = hoja.rect.x1 - 90
    filas = []
    for bloque in hoja.get_text("dict")["blocks"]:
        for linea in bloque.get("lines", []):
            for tramo in linea["spans"]:
                texto = tramo["text"].strip()
                if texto.isdigit() and tramo["bbox"][0] > borde:
                    filas.append((tramo["bbox"][1], int(texto), tramo["bbox"]))
    filas.sort()
    return filas


def enlazar_y_marcar(ruta_pdf, titulos, paginas, pagina_indice=2, desfase=-1):
    """Enlaces en las filas del indice + marcadores del lector de PDF."""
    doc = pymupdf.open(ruta_pdf)
    hoja = doc[pagina_indice - 1]
    izq, der = hoja.rect.x0 + 40, hoja.rect.x1 - 30

    filas = _filas_del_indice(hoja)
    con_pagina = [t for t in titulos if paginas.get(t)]
    if len(filas) != len(con_pagina):
        print("  aviso: %d filas en la hoja pero %d secciones con pagina"
              % (len(filas), len(con_pagina)))

    enlaces, descuadres = 0, []
    for (y, impreso, caja), titulo in zip(filas, con_pagina):
        destino = paginas[titulo]
        if impreso != destino + desfase:
            descuadres.append((titulo, impreso, destino + desfase))
            continue
        fila = pymupdf.Rect(izq, caja[1] - 6, der, caja[3] + 6)
        hoja.insert_link({"kind": pymupdf.LINK_GOTO, "from": fila,
                          "page": destino - 1, "to": pymupdf.Point(0, 0)})
        enlaces += 1

    if descuadres:
        for titulo, impreso, esperado in descuadres:
            print("  sin enlazar (el indice dice %s y deberia decir %s): %s"
                  % (impreso, esperado, titulo))

    marcadores = [[1, t, paginas[t]] for t in titulos if paginas.get(t)]
    if marcadores:
        doc.set_toc([[1, "Contenido", pagina_indice]] + marcadores)

    # A un archivo aparte y luego reemplazar: pymupdf no deja reescribir
    # de cero el PDF que tiene abierto.
    temporal = ruta_pdf + ".tmp"
    doc.save(temporal, garbage=4, deflate=True)
    doc.close()
    os.replace(temporal, ruta_pdf)
    return enlaces, len(marcadores)


def medir(ruta_pdf, ruta_html, desde=1):
    """Pasada 1: cuantas paginas ocupa cada seccion."""
    html = io.open(ruta_html, encoding="utf-8").read()
    titulos = titulos_del_indice(html)
    doc = pymupdf.open(ruta_pdf)
    paginas = paginas_de_secciones(doc, titulos, desde=desde)
    doc.close()
    return titulos, paginas


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print(__doc__)
        print("uso: numerar_indice.py <medir|enlazar> <pdf> <html> [pagina_indice]")
        sys.exit(1)
    accion, pdf, html = sys.argv[1], sys.argv[2], sys.argv[3]
    pagina_indice = int(sys.argv[4]) if len(sys.argv) > 4 else 2
    # -1 por defecto: la portada no lleva numero impreso
    desfase = int(sys.argv[5]) if len(sys.argv) > 5 else -1

    titulos, paginas = medir(pdf, html, desde=pagina_indice)
    if accion == "medir":
        n = rellenar_huecos(html, titulos, paginas, desfase)
        print("  %d de %d secciones numeradas en %s"
              % (n, len(titulos), os.path.basename(html)))
    elif accion == "enlazar":
        enlaces, marcas = enlazar_y_marcar(pdf, titulos, paginas, pagina_indice)
        print("  %d filas enlazadas, %d marcadores en %s"
              % (enlaces, marcas, os.path.basename(pdf)))
