import { useEffect, useState } from "react";
import { pedir } from "../api";
import { hablar } from "../voz";
import Marco from "../Marco";

export default function Legalizacion({ token, servicioId = 1 }) {
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

  const sobrante = comp.lineas.filter((l) => l.diferencia < 0).length;
  const merma = comp.lineas.filter((l) => l.diferencia > 0).length;

  return (
    <Marco titulo="Legalización  ·  servicio de almuerzo"
           chip={listo ? { texto: "LEGALIZADO", tipo: "verde" }
                       : { texto: "MOMENTO 3 DEL RETO", tipo: "azul" }}>
      {listo && (
        <div className="banner ok">
          <span className="ico">✓</span>
          <span>
            <b>Legalización confirmada</b>
            <span>El consumo real quedó registrado y el inventario ya refleja los ajustes.</span>
          </span>
        </div>
      )}

      <div className="chips">
        <span className="chip">{comp.lineas.length} insumos</span>
        <span className="chip verde">{sobrante} con sobrante</span>
        <span className="chip oro">{merma} con merma</span>
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
