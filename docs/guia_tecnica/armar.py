# -*- coding: utf-8 -*-
"""Arma la guia tecnica con el MISMO estilo del manual de usuario.

La hoja de estilos no se copia a mano: se toma del propio manual.html, de
modo que los dos documentos no puedan separarse con el tiempo. Si alguien
ajusta la tipografia del manual, la guia la hereda al regenerarse.

Entrada : docs/manual_v2/manual.html  (estilos y portada de referencia)
          docs/guia_tecnica/cuerpo.html (solo el contenido)
Salida  : docs/guia_tecnica/guia.html
          docs/guia_tecnica/portada.html
"""
import io
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))   # docs/guia_tecnica
RAIZ = os.path.dirname(AQUI)                        # docs
MANUAL = os.path.join(RAIZ, "manual_v2", "manual.html")
PORTADA_MANUAL = os.path.join(RAIZ, "manual_v2", "portada.html")
DESTINO = AQUI

manual = io.open(MANUAL, encoding="utf-8").read()

# ── el bloque de estilos del manual, tal cual ──
m = re.search(r"<style>.*?</style>", manual, re.S)
assert m, "no encuentro los estilos del manual"
estilos = m.group(0)

# ── las fuentes ──
fuentes = "\n".join(re.findall(r'<link[^>]*>', manual[:m.start()]))

cuerpo = io.open(os.path.join(DESTINO, "cuerpo.html"), encoding="utf-8").read()

# ── el apendice de codigo, leido del repositorio en esta misma corrida ──
# No se transcribe: se genera. Es lo que impide que el listado impreso se
# separe del codigo real, que es exactamente lo que le paso a la V4.
sys.path.insert(0, DESTINO)
import codigo as _codigo

REPO = os.path.dirname(RAIZ)                       # la raiz del repositorio
apendice, n_archivos, n_lineas = _codigo.generar(REPO)
cuerpo = cuerpo.rstrip() + "\n\n" + apendice

# El manual limita las figuras a 104 mm de alto para que una captura muy
# vertical no empuje a la pagina siguiente el texto que la explica. En la
# guia tecnica la captura ES el contenido, y las de tablet son altas: con
# ese tope salian encogidas y centradas, con franjas blancas a los lados.
ESTILO_FIGURAS = """
  /* ── figuras de la guia: mas altas que en el manual ──────────────── */
  figure img{ max-height:168mm; }
"""
estilos = estilos.replace("</style>", _codigo.ESTILO + ESTILO_FIGURAS + "</style>")

guia = ("<!doctype html>\n<html lang=\"es\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<title>Guía técnica · CuentaVoz</title>\n"
        + fuentes + "\n" + estilos + "\n</head>\n<body>\n\n"
        + cuerpo.rstrip() + "\n\n</body>\n</html>\n")

# ── numerar las figuras si el cuerpo llegara a traerlas ──
n = 0


def renumerar(mm):
    global n
    n += 1
    return "<b>Figura %d</b>" % n


guia = re.sub(r"<b>Figura [^<]*</b>", renumerar, guia)

io.open(os.path.join(DESTINO, "guia.html"), "w", encoding="utf-8",
        newline="\n").write(guia)

# ── portada: la del manual, con los textos de la guia ──
# Se deriva del manual en cada corrida, asi que el cambio de titulo,
# version y destinatario tiene que estar AQUI y no editado a mano en
# portada.html: de lo contrario la proxima corrida lo borraria.
portada = io.open(PORTADA_MANUAL, encoding="utf-8").read()
cambios = [
    ("Portada · Manual CuentaVoz", "Portada · Guía técnica CuentaVoz"),
    ("Manual de usuario", "Guía técnica"),
    ("<p class=\"bajada\">Guía práctica para la captura de inventarios por voz "
     "en las bodegas de Colsubsidio.</p>",
     "<p class=\"bajada\">Cómo está construido CuentaVoz por dentro: arquitectura, "
     "agente de voz, modelo de datos, pruebas y despliegue.</p>"),
    ("Versión <b>2.0</b>", "Versión <b>5.0</b>"),
    ("Dirigido a <b>auxiliares de inventarios<br>y administradores de bodega</b>",
     "Dirigido al <b>equipo técnico</b><br>que mantiene la plataforma"),
]
for viejo, nuevo in cambios:
    assert viejo in portada, "la portada del manual cambio: " + viejo[:50]
    portada = portada.replace(viejo, nuevo)
io.open(os.path.join(DESTINO, "portada.html"), "w", encoding="utf-8",
        newline="\n").write(portada)

secciones = len(re.findall(r'<h2 class="seccion"><span class="num">', guia))
print("guia.html armada: %d secciones, %d figuras" % (secciones, n))
print("apendice de codigo: %d archivos, %d lineas" % (n_archivos, n_lineas))
print("portada.html armada")

# ── unir el PDF, si los intermedios ya estan generados ──
partes = [os.path.join(DESTINO, "_build", f)
          for f in ("_g_portada.pdf", "_g_cuerpo.pdf")]
if all(os.path.exists(f) for f in partes):
    import pymupdf
    salida = os.path.join(RAIZ, "Guia_Tecnica_CuentaVoz_V5.pdf")
    out = pymupdf.open()
    for f in partes:
        d = pymupdf.open(f)
        out.insert_pdf(d)
        d.close()
    out.save(salida, garbage=4, deflate=True)
    print("PDF: %d paginas -> %s" % (out.page_count, salida))
    out.close()
else:
    print("(corra antes: node docs/guia_tecnica/generar_pdf.js)")
