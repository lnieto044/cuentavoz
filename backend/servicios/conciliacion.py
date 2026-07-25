"""De «tabla para picar blanca» al nombre y codigo oficiales del catalogo."""
import unicodedata
from rapidfuzz import process, fuzz
from bd import Sesion
from modelos import Articulo, AliasArticulo


# palabras que no distinguen un producto de otro
VACIAS = {"PARA", "DE", "DEL", "LA", "EL", "LOS", "LAS", "CON", "SIN",
          "POR", "EN", "Y", "A", "UN", "UNA", "UNAS", "UNOS", "AL"}


def _tokens(t: str) -> list[str]:
    return [p for p in t.split() if len(p) >= 3 and p not in VACIAS]


def _cobertura(consulta: str, candidato: str) -> float:
    """Cuantas palabras significativas de la consulta aparecen en el nombre.

    Compara por raiz de 4 letras, para que BLANCA encuentre BLANCO
    y CAZUELAS encuentre CAZUELA."""
    tc = _tokens(consulta)
    if not tc:
        return 0.0
    tn = _tokens(candidato)
    aciertos = 0
    for p in tc:
        raiz = p[:4]
        if any(q.startswith(raiz) or p.startswith(q[:4]) for q in tn):
            aciertos += 1
    return aciertos / len(tc) * 100


def puntuar(consulta: str, candidato: str) -> float:
    """Combina la forma general con la cobertura de palabras clave.

    Sin esto, «tabla para picar blanca» devuelve la AZUL: comparte
    tabla-picar y el color se diluye."""
    forma = fuzz.token_set_ratio(consulta, candidato)
    cob = _cobertura(consulta, candidato)
    return 0.45 * forma + 0.55 * cob


def normalizar(t: str) -> str:
    t = str(t).upper().strip()
    t = "".join(c for c in unicodedata.normalize("NFD", t)
                if unicodedata.category(c) != "Mn")          # sin tildes
    return t.replace("P/", "PARA ").replace("  ", " ")


def buscar_articulo(texto: str, bodega_id=None) -> list[dict]:
    consulta = normalizar(texto)
    if not consulta:
        return []
    with Sesion() as s:
        # 1) ¿ya aprendio como lo dice este equipo?
        alias = s.query(AliasArticulo).filter_by(texto_dicho=consulta).first()
        if alias:
            a = s.get(Articulo, alias.articulo_codigo)
            if a:
                return [{"codigo": a.codigo, "nombre": a.nombre_oficial,
                         "unidad": a.unidad_medida, "confianza": 100}]
        # 2) si no, compara contra todo el catalogo
        arts = s.query(Articulo).all()

    if not arts:
        return []
    puntajes = []
    for a in arts:
        p = puntuar(consulta, normalizar(a.nombre_oficial))
        if p >= 45:
            puntajes.append((p, a))
    puntajes.sort(key=lambda z: -z[0])
    return [{"codigo": a.codigo, "nombre": a.nombre_oficial,
             "unidad": a.unidad_medida, "confianza": round(p)}
            for p, a in puntajes[:3]]


def aprender_alias(texto: str, codigo: str, bodega_id=None):
    """Cada eleccion confirmada hace al agente mas preciso."""
    consulta = normalizar(texto)
    if not consulta or not codigo:
        return
    with Sesion() as s:
        ya = s.query(AliasArticulo).filter_by(texto_dicho=consulta,
                                              articulo_codigo=codigo).first()
        if not ya:
            s.add(AliasArticulo(texto_dicho=consulta,
                                articulo_codigo=codigo, bodega_id=bodega_id))
            s.commit()
