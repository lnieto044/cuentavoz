import { useEffect, useState } from "react";
import { pedir } from "../api";
import { hablar } from "../voz";
import Marco from "../Marco";

export default function Legalizacion({ token, servicioId = 1, ir }) {
  const [comp, setComp] = useState(null);
  const [listo, setListo] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    pedir(`/api/legalizacion/${servicioId}`, {}, token)
      .then(setComp)
      .catch((e) => setErr(e.message));
  }, [servicioId, token]);

  async function confirmar() {
    try {
      await pedir("/api/legalizacion/confirmar", {
        method: "POST",
        body: JSON.stringify({ servicio_id: servicioId }),
      }, token);
      setListo(true);
      hablar("Legalización confirmada. El sobrante volvió a la bodega y la merma quedó registrada.");
    } catch (e) {
      setErr(e.message);
    }
  }

  if (err) return <Marco titulo="Legalización"><p className="error">{err}</p></Marco>;
  if (!comp) return <Marco titulo="Legalización"><p className="cargando">Cargando…</p></Marco>;

  const sobrante = comp.lineas.filter((l) => l.diferencia < 0);
  const merma = comp.lineas.filter((l) => l.diferencia > 0);

  if (listo) {
    const kgSobrante = sobrante.reduce((a, l) => a + Math.abs(l.diferencia), 0);
    const kgMerma = merma.reduce((a, l) => a + l.diferencia, 0);
    return (
      <Marco titulo="Legalización  ·  ajuste confirmado" chip={{ texto: "LEGALIZADO", tipo: "verde" }}>
        <div className="banner ok">
          <span className="ico">✓</span>
          <span>
            <b>Legalización confirmada — servicio del {new Date().toLocaleDateString("es-CO")}</b>
            <span>El consumo real quedó registrado y el inventario de la cocina ya refleja los ajustes.</span>
          </span>
        </div>
        <div className="kpis">
          <div className="kpi verde">
            <small>Devuelto a bodega</small>
            <b>{Math.round(kgSobrante * 100) / 100}</b>
            <i>{sobrante.length} insumos con sobrante</i>
          </div>
          <div className="kpi oro">
            <small>Merma registrada</small>
            <b>{Math.round(kgMerma * 100) / 100}</b>
            <i>{merma.length} insumos con nota del chef</i>
          </div>
          <div className="kpi">
            <small>Histórico actualizado</small>
            <b>{comp.lineas.length}</b>
            <i>consumo real por porción</i>
          </div>
        </div>
        <div className="card">
          <h3>Qué pasa ahora con esta información</h3>
          <div className="registro"><span className="ok">✓</span>
            <span>El archivo de ajuste queda listo para cargarse a My Inventory con los nombres y códigos oficiales.</span></div>
          <div className="registro"><span className="ok">✓</span>
            <span>El consumo real alimenta el histórico: si el plato gasta siempre más de un insumo que lo que dice la receta, el sistema lo detecta.</span></div>
          <div className="registro"><span className="ok">✓</span>
            <span>La merma queda trazada con responsable y hora: la revisión ya no depende de la memoria de nadie.</span></div>
          <div className="grilla-botones">
            <button className="btn" onClick={() => ir && ir("reportes")}>Ver el reporte del servicio</button>
          </div>
        </div>
      </Marco>
    );
  }

  return (
    <Marco titulo="Legalización  ·  servicio de almuerzo"
           chip={{ texto: "MOMENTO 3 DEL RETO", tipo: "azul" }}>
      <div className="chips">
        <span className="chip">{comp.lineas.length} insumos</span>
        <span className="chip verde">{sobrante.length} con sobrante</span>
        <span className="chip oro">{merma.length} con merma</span>
      </div>

      <div className="card">
        <h3>Lo pedido contra lo realmente usado</h3>
        {comp.lineas.length === 0 ? (
          <p className="vacio">
            No hay líneas de servicio todavía. Genere un pedido en el menú Pedidos.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Insumo</th><th>Pedido</th><th>Usado</th>
                <th>Diferencia</th><th>Qué significa</th>
              </tr>
            </thead>
            <tbody>
              {comp.lineas.map((l) => (
                <tr key={l.codigo}>
                  <td>{l.nombre}</td>
                  <td>{l.pedido}</td>
                  <td>{l.usado}</td>
                  <td className="dif">
                    {l.diferencia > 0 ? `+${l.diferencia}` : l.diferencia}
                  </td>
                  <td>{l.lectura}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="pista" style={{ marginTop: 10 }}>
          El sobrante vuelve a la bodega y suma al stock; la merma no vuelve y
          queda registrada con responsable y hora.
        </p>
        {!listo && comp.lineas.length > 0 && (
          <div className="grilla-botones">
            <button className="btn verde" onClick={confirmar}>
              Confirmar legalización
            </button>
          </div>
        )}
      </div>
    </Marco>
  );
}
