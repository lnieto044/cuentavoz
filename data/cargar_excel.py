"""Carga el extracto real de Colsubsidio y unas recetas de ejemplo.

Uso:  cd data && python cargar_excel.py
"""
import os
import re
import sys
import unicodedata
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
from bd import Sesion, iniciar_bd                      # noqa: E402
from modelos import (Bodega, Articulo, StockSistema,    # noqa: E402
                     Receta, RecetaIngrediente, LineaServicio)

ARCHIVO = os.path.join(os.path.dirname(__file__), "BODEGAS_Y_STOCK.xlsx")


def _norm(t: str) -> str:
    """Compara nombres de bodega sin tildes ni variantes de A y B."""
    t = str(t).upper()
    t = "".join(c for c in unicodedata.normalize("NFD", t)
                if unicodedata.category(c) != "Mn")
    t = t.replace("A Y B", "AYB").replace("&", "Y")
    t = re.sub(r"[^A-Z0-9]+", " ", t)
    return " ".join(t.split())


def cargar_inventario():
    iniciar_bd()
    xl = pd.ExcelFile(ARCHIVO)
    s = Sesion()

    # 1) las bodegas disponibles (la hoja trae encabezado en la fila 2)
    bod = pd.read_excel(xl, "BODEGAS DISPONIBLES", header=1)
    col = "BODEGAS" if "BODEGAS" in bod.columns else bod.columns[-1]
    nuevas = 0
    for n in bod[col].dropna().astype(str).str.strip().unique():
        nombre = re.sub(r"\s+", " ", n.upper()).strip()
        if not nombre or nombre == "NAN":
            continue
        if not s.query(Bodega).filter_by(nombre_oficial=nombre).first():
            s.add(Bodega(nombre_oficial=nombre))
            nuevas += 1
    s.commit()

    # 2) el stock hoja por hoja (una hoja = una bodega con su corte)
    sin_codigo = 0
    solo_en_stock = []
    filas_vacias = 0
    listadas = {_norm(x.nombre_oficial): x for x in s.query(Bodega).all()}

    for hoja in [h for h in xl.sheet_names if h != "BODEGAS DISPONIBLES"]:
        nombre_b = re.sub(r"\s+", " ", hoja.replace("STOCK", "", 1).strip().upper())
        clave = _norm(nombre_b)
        b = listadas.get(clave)
        if b is None and clave:
            # coincidencia parcial: solo si es inequivoca (un unico candidato).
            # con dos candidatos ambiguos (p.ej. "ZOOLOGICO" hoja suelta vs
            # "ZOOLOGICO SUMINISTROS" y "ZOOLOGICO PISCILAGO" en el listado)
            # es mejor crear una bodega nueva que adivinar mal y mezclar stock.
            candidatos = [v for k, v in listadas.items() if clave in k or k in clave]
            if len(candidatos) == 1:
                b = candidatos[0]
        if b is None:                       # bodega que solo existe como hoja
            b = Bodega(nombre_oficial=nombre_b)
            s.add(b)
            s.commit()
            s.refresh(b)
            listadas[clave] = b
            solo_en_stock.append(nombre_b)

        df = pd.read_excel(xl, hoja)
        df.columns = [str(c).strip() for c in df.columns]
        for _, fila in df.iterrows():
            nombre = str(fila.get("Artículo", "")).strip()
            if not nombre or nombre.lower() == "nan":
                filas_vacias += 1
                continue
            cod = fila.get("Nr.Artículo")
            if pd.isna(cod):
                sin_codigo += 1
                cod = f"SIN-{sin_codigo:04d}"       # ningun dato se pierde
            else:
                cod = str(cod).split(".")[0].strip()

            if s.get(Articulo, cod) is None:
                unidad = str(fila.get("Unidad", "Unidad")).strip()
                s.add(Articulo(codigo=cod, nombre_oficial=nombre.upper(),
                               unidad_medida=unidad if unidad != "nan" else "Unidad"))
                s.commit()

            sd = fila.get("SD", 0)
            s.add(StockSistema(articulo_codigo=cod, bodega_id=b.id,
                               cantidad_sd=float(sd) if not pd.isna(sd) else 0))
        s.commit()

    tot_b = s.query(Bodega).count()
    tot_a = s.query(Articulo).count()
    tot_s = s.query(StockSistema).count()
    neg = s.query(StockSistema).filter(StockSistema.cantidad_sd < 0).count()
    print(f"  Bodegas listadas en la hoja:      {nuevas}")
    print(f"  Bodegas solo en hojas de stock:   {len(solo_en_stock)}  {solo_en_stock}")
    print(f"  Bodegas en total:                 {tot_b}")
    print(f"  Articulos del catalogo:           {tot_a}")
    print(f"  Registros de stock cargados:      {tot_s}")
    print(f"  Filas sin nombre de articulo:     {filas_vacias} (omitidas)")
    print(f"  Registros sin codigo (SIN-####):  {sin_codigo}")
    print(f"  SALDOS NEGATIVOS DETECTADOS:      {neg}   <- el mini reto")
    s.close()


def cargar_recetas():
    """Recetas de ejemplo. Reemplace por el archivo oficial cuando llegue."""
    s = Sesion()
    if s.query(Receta).count() > 0:
        print("  Recetas ya cargadas.")
        s.close()
        return

    # descarta lo que no es alimento (empaques, aseo, medicamentos)
    NO_ALIMENTO = ("BOLSA", "CAJA", "VASO", "TAPA", "SERVILLETA", "GUANTE",
                   "PAPEL", "MECHERO", "CREMA TBOX", "BETAMETASONA", "JABON",
                   "DESINFECT", "TOALLA", "CUBIERTO", "PLATO", "EMPAQUE",
                   "CONTENEDOR", "PITILLO", "TENEDOR", "CUCHARA")

    def art(*claves):
        """Busca un alimento del catalogo comparando PALABRAS completas.

        Sin esto, «PAPA» encuentra «PAPAYA» y la receta queda absurda."""
        candidatos = []
        for a in s.query(Articulo).all():
            if any(x in a.nombre_oficial for x in NO_ALIMENTO):
                continue
            palabras = re.findall(r"[A-ZÁÉÍÓÚÑ]+", a.nombre_oficial.upper())
            if all(k.upper() in palabras for k in claves):
                candidatos.append(a)
        if not candidatos:
            return None
        # el nombre mas corto suele ser el ingrediente base, no una variante
        return sorted(candidatos, key=lambda a: len(a.nombre_oficial))[0]

    RECETAS = {
        "AJIACO SANTAFERENO": [(("POLLO",), 0.250), (("PAPA",), 0.200),
                               (("ARROZ",), 0.080), (("SAL",), 0.005),
                               (("ACEITE",), 0.010)],
        "SANCOCHO DE GALLINA": [(("POLLO",), 0.300), (("PAPA",), 0.250),
                                (("YUCA",), 0.150), (("ARROZ",), 0.100),
                                (("ACEITE",), 0.015)],
    }
    creadas = 0
    for nombre, ings in RECETAS.items():
        encontrados = [(art(*c), q) for c, q in ings]
        encontrados = [(a, q) for a, q in encontrados if a is not None]
        if not encontrados:
            continue
        r = Receta(nombre=nombre, rendimiento=1)
        s.add(r)
        s.commit()
        s.refresh(r)
        for a, q in encontrados:
            s.add(RecetaIngrediente(receta_id=r.id, articulo_codigo=a.codigo,
                                    cantidad_por_porcion=q))
        s.commit()
        creadas += 1
        print(f"  Receta «{nombre}»: {len(encontrados)} ingredientes")

    # un servicio de ejemplo ya legalizado, para que el analisis tenga datos
    if s.query(LineaServicio).count() == 0 and creadas:
        r = s.query(Receta).first()
        for ing in s.query(RecetaIngrediente).filter_by(receta_id=r.id).all():
            a = s.get(Articulo, ing.articulo_codigo)
            pedido = round(ing.cantidad_por_porcion * 50, 3)
            usado = round(pedido * 0.9, 3)          # sobro un 10 %
            s.add(LineaServicio(servicio_id=1, articulo_codigo=a.codigo,
                                nombre=a.nombre_oficial, pedido=pedido,
                                usado=usado, estado="legalizado"))
        s.commit()
        print("  Servicio de ejemplo creado (para el analisis de consumo)")
    s.close()


if __name__ == "__main__":
    print("Cargando el extracto de Colsubsidio...")
    cargar_inventario()
    print("\nCargando recetas...")
    cargar_recetas()
    print("\nListo. Ya puede abrir http://localhost:5173")
