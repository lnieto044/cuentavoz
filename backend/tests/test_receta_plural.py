"""El chef nombra el plato en plural; la receta se guarda en singular."""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from servicios.recetas import _sin_plural, _sin_tildes  # noqa: E402


def _coincide(dicho: str, guardado: str) -> bool:
    """Misma comparacion que hace _buscar_receta, sin tocar la base."""
    objetivo = _sin_tildes(dicho)
    nombre = _sin_tildes(guardado)
    return objetivo in nombre or _sin_plural(objetivo) in _sin_plural(nombre)


def test_plural_encuentra_la_receta_guardada_en_singular():
    # es la frase que la propia pantalla de Pedidos sugiere como ejemplo
    assert _coincide("ajiacos", "AJIACO SANTAFEREÑO")
    assert _coincide("sancochos", "SANCOCHO DE GALLINA")


def test_plural_en_todas_las_palabras():
    assert _coincide("ajiacos santafereños", "AJIACO SANTAFEREÑO")


def test_singular_sigue_funcionando():
    assert _coincide("ajiaco", "AJIACO SANTAFEREÑO")
    assert _coincide("ajiaco santafereño", "AJIACO SANTAFEREÑO")


def test_sin_tildes_sigue_funcionando():
    assert _coincide("ajiaco santafereno", "AJIACO SANTAFEREÑO")


def test_un_plato_distinto_no_coincide():
    assert not _coincide("ajiacos", "SANCOCHO DE GALLINA")
    assert not _coincide("lasagnas", "AJIACO SANTAFEREÑO")
