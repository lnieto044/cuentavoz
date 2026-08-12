"""De «tabla para picar blanca» al nombre y codigo oficiales del catalogo."""
import re
import unicodedata
from rapidfuzz import process, fuzz
from bd import Sesion
from modelos import Articulo, AliasArticulo, Bodega


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
    t = t.replace("P/", "PARA ")
    # el reconocimiento de voz del navegador suele cerrar la frase con un
    # punto ("Zoológico.") aunque nadie lo haya dicho - sin quitarlo, una
    # bodega real dejaba de encontrarse por un simple "." de mas.
    t = re.sub(r"[.,;:!¿?¡]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def buscar_bodegas_candidatas(s, texto: str) -> list[Bodega]:
    """Todas las bodegas razonables para lo dicho/escrito, de más a menos
    específica - vacía si no hay ninguna, un solo elemento si es
    inequívoco, varios si es ambiguo ("restaurante" a secas encaja por
    igual en "RESTAURANTE FUENTES AYB" y "RESTAURANTE FUENTES SUMIN": ahí
    quien llama debe ofrecer las opciones, no adivinar cuál de las dos)."""
    clave = normalizar(texto)
    if not clave:
        return []
    exacta = s.query(Bodega).filter(Bodega.nombre_oficial == clave).first()
    if exacta:
        return [exacta]
    # coincidencia parcial: "kiosco" a secas es substring de "KIOSCO 2
    # SUMINISTROS", "KIOSCO TAQUILLA AYB" y varias más - todas cuentan.
    contienen = s.query(Bodega).filter(Bodega.nombre_oficial.contains(clave)).all()
    if contienen:
        return contienen
    # ultimo recurso: cuantas palabras dichas (de mas de 3 letras) tiene
    # cada bodega - "autoservicios las fuentes" perdia "fuentes" antes y
    # se quedaba con la primera bodega que solo compartiera
    # "autoservicios"; ahora esa comparte 1 palabra y "AUTOSERVICIOS LAS
    # FUENTES" comparte 2, así que gana sola. Un empate real (dos
    # candidatas con el mismo máximo) se devuelve como ambigüedad.
    palabras = [p for p in clave.split() if len(p) > 3]
    if not palabras:
        return []
    candidatas = [(sum(1 for p in palabras if p in c.nombre_oficial), c)
                  for c in s.query(Bodega).all()]
    candidatas = [(n, c) for n, c in candidatas if n > 0]
    if not candidatas:
        return []
    maximo = max(n for n, _ in candidatas)
    return [c for n, c in candidatas if n == maximo]


def buscar_bodega(s, texto: str) -> Bodega | None:
    """La misma bodega para el nombre dicho o escrito, en un solo lugar
    (antes /api/bodegas/abrir y el agente conversacional cada uno tenia
    su propia version, y se desincronizaban). Nunca adivina entre varias
    candidatas igual de buenas: mejor decir "no la encuentro" (o, para
    quien necesite las opciones, ver buscar_bodegas_candidatas) que abrir
    la bodega equivocada."""
    candidatas = buscar_bodegas_candidatas(s, texto)
    return candidatas[0] if len(candidatas) == 1 else None


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
