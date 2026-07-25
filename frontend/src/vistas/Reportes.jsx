import { useState } from "react";
import { pedir, BASE, leerToken } from "../api";
import Marco from "../Marco";

export default function Reportes({ token }) {
  const [archivos, setArchivos] = useState([]);
  const [analisis, setAnalisis] = useState(null);
  const [err, setErr] = useState("");

  async function generar(formato) {
    setErr("");
    try {
      const d = await pedir(`/api/reportes?formato=${formato}`, { method: "POST" }, token);
      setArchivos((a) => [{ ruta: d.archivo, formato, hora: new Date()
        .toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }) }, ...a]);
    } catch (e) { setErr(e.message); }
  }
  async function verAnalisis() {
    try { setAnalisis(await pedir("/api/analisis/consumo", {}, token)); }
    catch (e) { setErr(e.message); }
  }

  return (
    <Marco titulo="Reportes  ·  consolidado y análisis"
           chip={{ texto: `${archivos.length} ARCHIVOS`, tipo: "azul" }}>
      <div className="card">
        <h3>Consolidado para My Inventory</h3>
        <p className="pista">
          Sale con los nombres y códigos oficiales de la base: información limpia
          lista para cargar al ERP.
        </p>
        <div className="grilla-botones">
          <button className="btn" onClick={() => generar("xlsx")}>Generar XLSX</button>
          <button className="btn borde" onClick={() => generar("csv")}>Generar CSV</button>
          <button className="btn oro" onClick={verAnalisis}>Análisis de consumo</button>
        </div>
        {err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}
        {archivos.map((a, i) => (
          <div className="registro" key={i}>
            <span className="ok">✓</span>
            <span>{a.ruta.split("/").pop()}</span>
            <span className="cant">{a.formato.toUpperCase()} · {a.hora}</span>
            <a className="btn borde" style={{ padding: "6px 12px", minHeight: 0,
               textDecoration: "none" }}
               href={`${BASE}/api/reportes/descargar?archivo=${encodeURIComponent(a.ruta)}`}>
              Descargar
            </a>
          </div>
        ))}
      </div>

      {analisis && (
        <div className="card">
          <h3>Lo pedido contra lo usado</h3>
          <div className="kpis">
            <div className="kpi"><small>Pedido en el período</small>
              <b>{analisis.pedido_total}</b></div>
            <div className="kpi"><small>Usado realmente</small>
              <b>{analisis.usado_total}</b>
              <i>{analisis.aprovechamiento} % de aprovechamiento</i></div>
            <div className="kpi oro"><small>Insumos subutilizados</small>
              <b>{analisis.subutilizados.length}</b><i>se piden y sobran</i></div>
          </div>
          {analisis.subutilizados.length === 0 ? (
            <p className="vacio">
              Sin servicios legalizados todavía: legalice uno para ver el análisis.
            </p>
          ) : (
            <table>
              <thead><tr><th>Insumo</th><th>Sobra</th><th>Sobrepedido</th><th>Servicios</th></tr></thead>
              <tbody>
                {analisis.subutilizados.map((s, i) => (
                  <tr key={i}>
                    <td>{s.nombre}</td><td>{s.sobra}</td>
                    <td className="dif">{s.sobrepedido_pct} %</td><td>{s.veces}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Marco>
  );
}
