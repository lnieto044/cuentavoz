# -*- coding: utf-8 -*-
"""Arma los cuatro GIF del README a partir de los cuadros capturados.

No son video: son una presentacion de una imagen por pantalla, a 0,62
cuadros por segundo (~1,6 s cada una), que es como estaban hechos los
originales. Asi se leen nitidos y pesan menos de un megabyte, en vez de
los cuatro o cinco que costaba convertir un video de la misma duracion.

Se genera una paleta propia por GIF: con la paleta generica de ffmpeg los
azules planos de la interfaz salen con bandas.
"""
import glob
import os
import subprocess

import imageio_ffmpeg
FF = imageio_ffmpeg.get_ffmpeg_exe()

# Rutas relativas a este archivo: el script tiene que servir en cualquier
# clon del repositorio.
AQUI = os.path.dirname(os.path.abspath(__file__))   # docs/capturas
CUADROS = os.path.join(AQUI, "_cuadros")            # intermedios, no se versiona
DESTINO = AQUI

# (carpeta de cuadros, nombre del gif, ancho de salida, cuadros/seg)
TRABAJOS = [
    ("pc", "recorrido-pc.gif", 1000, 0.62),
    ("tablet", "recorrido-tablet.gif", 700, 0.62),
    ("movil", "recorrido-movil.gif", 380, 0.62),
    ("pedidos", "pedidos-flujo.gif", 700, 0.50),
]


def armar(carpeta, nombre, ancho, fps):
    dir_cuadros = os.path.join(CUADROS, carpeta)
    n = len(glob.glob(os.path.join(dir_cuadros, "*.png")))
    if not n:
        print("  (sin cuadros en %s)" % carpeta)
        return
    patron = os.path.join(dir_cuadros, "%03d.png")
    paleta = os.path.join(dir_cuadros, "paleta.png")
    filtro = "scale=%d:-1:flags=lanczos" % ancho

    r = subprocess.run([FF, "-v", "error", "-framerate", str(fps), "-i", patron,
                        "-vf", filtro + ",palettegen=max_colors=200:stats_mode=full",
                        "-y", paleta], capture_output=True, text=True)
    if r.returncode:
        print("  FALLO la paleta de %s: %s" % (nombre, r.stderr[-300:]))
        return

    salida = os.path.join(DESTINO, nombre)
    r = subprocess.run([FF, "-v", "error", "-framerate", str(fps), "-i", patron,
                        "-i", paleta,
                        # sin dither: son capturas de interfaz, con colores
                        # planos; el tramado solo agrega ruido y peso.
                        "-lavfi", filtro + " [x]; [x][1:v] paletteuse=dither=none",
                        "-loop", "0", "-y", salida], capture_output=True, text=True)
    if r.returncode:
        print("  FALLO %s: %s" % (nombre, r.stderr[-300:]))
        return
    print("  ok %-22s %4d cuadros  %5d KB"
          % (nombre, n, os.path.getsize(salida) // 1024))


for carpeta, nombre, ancho, fps in TRABAJOS:
    armar(carpeta, nombre, ancho, fps)
