"""Las reglas duras. Codigo determinista: se comporta igual siempre."""
import os
from bd import Sesion
from modelos import Articulo, StockSistema, ConfigClave

UMBRAL_DEFECTO = float(os.getenv("UMBRAL_ANOMALIA", 0.5))


def umbral_actual() -> float:
    """El umbral puede ajustarse desde Ajustes; si no, manda el .env."""
    with Sesion() as s:
        c = s.get(ConfigClave, "umbral_anomalia")
        return float(c.valor) if c else UMBRAL_DEFECTO


def validar_conteo(codigo: str, cantidad: float, unidad: str, bodega_id) -> dict:
    UMBRAL = umbral_actual()
    with Sesion() as s:
        art = s.get(Articulo, codigo)
        if art is None:
            return {"ok": False, "tipo": "inexistente",
                    "mensaje": "Ese articulo no esta en el catalogo. "
                               "¿Lo creamos? Quedara pendiente de aprobacion."}

        if cantidad is None:
            return {"ok": False, "tipo": "vacio",
                    "mensaje": "No entendi la cantidad. ¿Me la repite?"}

        # mini reto de Colsubsidio: un saldo fisico nunca baja de cero
        if cantidad < 0:
            return {"ok": False, "tipo": "negativo",
                    "mensaje": "Una cantidad no puede ser negativa: un saldo "
                               "fisico nunca baja de cero. Digame el valor correcto."}

        # «cinco kilos» no se confunde con «cinco gramos»
        if unidad and unidad.strip().lower() != art.unidad_medida.strip().lower():
            return {"ok": False, "tipo": "unidad",
                    "mensaje": f"Ese articulo se maneja en {art.unidad_medida}, "
                               f"no en {unidad}. ¿Cual es la cantidad "
                               f"en {art.unidad_medida}?"}

        stock = s.query(StockSistema).filter_by(
            articulo_codigo=codigo, bodega_id=bodega_id).first()
        esperado = stock.cantidad_sd if stock else None

    # el famoso 9 contra 90
    if esperado is not None and esperado > 0:
        desvio = abs(cantidad - esperado) / esperado
        if desvio > UMBRAL:
            return {"ok": False, "tipo": "desviacion", "esperado": esperado,
                    "mensaje": f"El sistema espera alrededor de {esperado:g}. "
                               f"¿Confirma {cantidad:g}?"}
    # el sistema SI tiene una expectativa aqui (una fila real de
    # StockSistema, no la ausencia de dato que ya cubre "esperado is
    # None" arriba) y esa expectativa es CERO - "esperado > 0" arriba
    # evita dividir por cero para calcular el porcentaje de desviacion,
    # pero de paso dejaba sin ninguna alerta el caso de contar algo
    # donde el sistema no esperaba nada: encontrar existencia donde
    # deberia haber cero es tan anomalo como el 9 contra 90 de arriba,
    # solo que no tiene un "%" que calcular.
    elif esperado == 0 and cantidad > 0:
        return {"ok": False, "tipo": "desviacion", "esperado": esperado,
                "mensaje": f"El sistema no tiene existencia registrada aqui para este articulo. "
                           f"¿Confirma {cantidad:g}?"}

    return {"ok": True, "esperado": esperado}
