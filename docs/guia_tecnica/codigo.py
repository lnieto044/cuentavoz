# -*- coding: utf-8 -*-
"""Genera el apendice de codigo de la guia tecnica LEYENDO LOS ARCHIVOS
REALES en cada corrida.

Es la diferencia de fondo con la guia V4. Aquella traia 270 paginas de
codigo pegado a mano: quedo desactualizada al primer commit, y nadie iba
a rehacer a mano un apendice de ese tamaño. Aqui el listado no se escribe,
se genera — asi que regenerar la guia basta para que el codigo impreso
vuelva a coincidir con el repositorio.

Cada archivo entra con su ruta, su tamaño y una linea que dice de que
responde, y despues el listado numerado.
"""
import html
import io
import os

# Cada entrada: (ruta relativa a la raiz del repo, de que responde)
GRUPOS = [
    ("17.1", "Backend · el nucleo", [
        ("backend/main.py",
         "La aplicacion FastAPI entera: los 90 endpoints, el orquestador del "
         "agente, los middlewares de CORS y cabeceras, y el arranque."),
        ("backend/modelos.py",
         "Las 18 tablas en SQLAlchemy. Es el mapa del dominio."),
        ("backend/bd.py",
         "La conexion y la sesion. Lo unico que cambia entre SQLite y "
         "PostgreSQL vive aqui."),
        ("backend/seguridad.py",
         "Verificacion del access token de Cognito y el gate por perfil."),
        ("backend/reportes.py",
         "Armado de los archivos XLSX con los codigos oficiales."),
        ("backend/horario.py",
         "La hora local de la operacion, en un solo sitio."),
    ]),
    ("17.2", "Backend · servicios", [
        ("backend/servicios/interprete.py",
         "El interprete local: numeros en palabras, unidades e intenciones. "
         "Es el que permite que la plataforma funcione sin Gemini."),
        ("backend/servicios/recetas.py",
         "Calculo del pedido desde la receta y comparacion de la "
         "legalizacion."),
        ("backend/servicios/conciliacion.py",
         "Emparejar lo dictado con el catalogo, y las alertas cuando algo "
         "no cuadra."),
        ("backend/servicios/analitica.py",
         "Los indicadores del Panel y el analisis de consumo."),
        ("backend/servicios/validacion.py",
         "Las reglas que se aplican antes de guardar."),
        ("backend/servicios/archivos.py",
         "Escritura y lectura de los archivos generados."),
    ]),
    ("17.3", "Frontend · nucleo", [
        ("frontend/src/main.jsx", "El punto de entrada."),
        ("frontend/src/App.jsx",
         "El menu, la vista activa, la sesion y el contexto. Agregar una "
         "pantalla empieza aqui."),
        ("frontend/src/api.js",
         "Todas las llamadas al backend, y esFalloRed, que distingue un "
         "fallo de red de un error del servidor."),
        ("frontend/src/cognito.js",
         "Registro, ingreso, clave y verificacion en dos pasos. La clave "
         "nunca sale de aqui hacia el backend."),
        ("frontend/src/voz.js", "Escuchar y hablar."),
        ("frontend/src/interpreteLocal.js",
         "El mismo interprete del backend, pero dentro del navegador, para "
         "el modo sin conexion."),
        ("frontend/src/colaOffline.js",
         "La cola de conteos pendientes de sincronizar."),
        ("frontend/src/accesibilidad.js", "Alto contraste y tamaño de letra."),
        ("frontend/src/confirmacionVoz.js", "Que cuenta como un si hablado."),
        ("frontend/src/tutorial.js", "Si el recorrido en video se abre solo."),
        ("frontend/src/correoAdmin.js", "El respaldo de envio por correo."),
    ]),
    ("17.4", "Frontend · componentes compartidos", [
        ("frontend/src/BarraLateral.jsx",
         "El menu lateral, el avatar y el aviso de cola sin conexion."),
        ("frontend/src/Marco.jsx", "El encabezado comun de cada pantalla."),
        ("frontend/src/Dialogo.jsx",
         "El cuadro modal: trampa de foco, cierre con Escape, campo con voz."),
        ("frontend/src/AsistenteVoz.jsx", "El agente flotante de cada vista."),
        ("frontend/src/ChecklistClave.jsx",
         "Los cuatro requisitos reales de la politica de clave."),
        ("frontend/src/ConfigurarMFA.jsx", "El QR del segundo factor."),
        ("frontend/src/VideoRecorrido.jsx", "El recorrido narrado por perfil."),
        ("frontend/src/Iconos.jsx", "Los iconos, en SVG."),
    ]),
    ("17.5", "Frontend · las catorce vistas", [
        ("frontend/src/vistas/Ingreso.jsx", "Ingreso, registro y recuperacion."),
        ("frontend/src/vistas/Inicio.jsx", "El resumen del dia."),
        ("frontend/src/vistas/Pedido.jsx", "Del plato a los insumos."),
        ("frontend/src/vistas/Conteo.jsx",
         "El corazon del sistema: dictar, confirmar, corregir, y el modo "
         "sin conexion."),
        ("frontend/src/vistas/Legalizacion.jsx", "Lo pedido contra lo usado."),
        ("frontend/src/vistas/Bodegas.jsx", "El parque en vivo y su detalle."),
        ("frontend/src/vistas/Auditoria.jsx", "Las cuatro pestañas del control."),
        ("frontend/src/vistas/Reportes.jsx", "La salida hacia My Inventory."),
        ("frontend/src/vistas/Panel.jsx", "La vista gerencial."),
        ("frontend/src/vistas/Ajustes.jsx", "Configuracion, usuarios, recetas y traza."),
        ("frontend/src/vistas/Ayuda.jsx", "Preguntas, agente y soporte."),
        ("frontend/src/vistas/Mensajes.jsx", "La bandeja del equipo."),
        ("frontend/src/vistas/MiPerfil.jsx", "La cuenta propia."),
        ("frontend/src/vistas/CerrarSesion.jsx", "Salir sin dejar nada a medias."),
    ]),
    ("17.6", "Pruebas", [
        ("backend/tests/conftest.py", "La base en memoria que usan todas."),
        ("backend/tests/test_cerebro.py", "El orquestador del agente."),
        ("backend/tests/test_interprete.py", "El interprete local."),
        ("backend/tests/test_agente_conversacion.py", "Conversaciones completas."),
        ("backend/tests/test_conciliacion.py", "Emparejamiento y alertas."),
        ("backend/tests/test_regresiones_seguridad.py",
         "Fallos de seguridad que ya ocurrieron una vez."),
        ("backend/tests/test_regresiones_legalizacion.py",
         "Fallos de legalizacion que ya ocurrieron una vez."),
        ("frontend/src/interpreteLocal.test.js", "El interprete del navegador."),
        ("frontend/src/colaOffline.test.js", "La cola sin conexion."),
        ("frontend/src/accesibilidad.test.js", "Contraste y tamaño de letra."),
        ("frontend/src/confirmacionVoz.test.js", "Que cuenta como un si."),
        ("frontend/src/tutorial.test.js", "Cuando se abre el recorrido."),
    ]),
]

ESTILO = """
  /* ── apendice de codigo ─────────────────────────────────────────── */
  .codigo-cabeza{ margin:6mm 0 0; padding:2.4mm 3mm; background:var(--tinte);
    border-left:2.6pt solid var(--azul); border-radius:0 2mm 2mm 0;
    break-inside:avoid; }
  .codigo-cabeza .ruta{ font-family:"Consolas","DejaVu Sans Mono",monospace;
    font-size:8.4pt; font-weight:700; color:var(--navy); }
  .codigo-cabeza .tam{ float:right; font-size:7.4pt; letter-spacing:.06em;
    text-transform:uppercase; color:var(--pizarra); }
  .codigo-cabeza p{ margin:1.2mm 0 0; font-size:8.2pt; color:var(--pizarra);
    line-height:1.35; }
  pre.codigo{ margin:2mm 0 0; font-family:"Consolas","DejaVu Sans Mono",monospace;
    font-size:6.5pt; line-height:1.32; color:var(--tinta);
    white-space:pre-wrap; word-break:break-word; }
  pre.codigo .ln{ display:inline-block; width:7mm; text-align:right;
    margin-right:2.2mm; color:#A9B7C7; user-select:none; }
"""


def _listado(ruta_abs):
    texto = io.open(ruta_abs, encoding="utf-8", errors="replace").read()
    filas = []
    for i, linea in enumerate(texto.rstrip("\n").split("\n"), start=1):
        filas.append('<span class="ln">%d</span>%s' % (i, html.escape(linea)))
    return "<pre class=\"codigo\">" + "\n".join(filas) + "</pre>"


def generar(raiz_repo):
    """Devuelve (html_de_la_seccion, archivos, lineas)."""
    partes = ['<!-- ══════════ 17 ══════════ -->\n<section>\n'
              '  <h2 class="seccion"><span class="num">17</span>El código completo</h2>\n'
              '  <p class="seccion-intro">El proyecto entero, archivo por archivo. '
              'Este apéndice <b>se genera leyendo el repositorio</b> cada vez que se '
              'compila la guía: no está transcrito a mano, así que no puede quedar '
              'desfasado del código real.</p>\n']
    n_arch = n_lin = 0
    for num, titulo, archivos in GRUPOS:
        partes.append("  <h3>%s %s</h3>\n" % (num, titulo))
        for rel, para_que in archivos:
            ruta = os.path.join(raiz_repo, rel.replace("/", os.sep))
            if not os.path.exists(ruta):
                print("  (falta y se omite: %s)" % rel)
                continue
            lineas = sum(1 for _ in io.open(ruta, encoding="utf-8", errors="replace"))
            n_arch += 1
            n_lin += lineas
            partes.append(
                '  <div class="codigo-cabeza"><span class="tam">%d líneas</span>'
                '<span class="ruta">%s</span><p>%s</p></div>\n'
                % (lineas, html.escape(rel), html.escape(para_que)))
            partes.append("  " + _listado(ruta) + "\n")
    partes.append("</section>\n")
    return "".join(partes), n_arch, n_lin
