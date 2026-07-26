import { useState } from "react";
import { pedir, descargarReporte } from "../api";
import Marco from "../Marco";

export default function Reportes({ token }) {
  const [archivos, setArchivos] = useState([]);
  const [analisis, setAnalisis] = useState(null);
  const [difBodega, setDifBodega] = useState(null);
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
  async function verDiferencias() {
    try { setDifBodega(await pedir("/api/reportes/diferencias-por-bodega", {}, token)); }
    catch (e) { setErr(e.message); }
  }

  const recomendacion = analisis?.subutilizados?.[0];

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
          <button className="btn gris" onClick={verDiferencias}>Diferencias por bodega</button>
        </div>
        {err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}
        {archivos.map((a, i) => (
          <div className="registro" key={i}>
            <span className="ok">✓</span>
            <span>{a.ruta.split("/").pop()}</span>
            <span className="cant">{a.formato.toUpperCase()} · {a.hora}</span>
            <button className="btn borde" style={{ padding: "6px 12px", minHeight: 0 }}
                    onClick={() => descargarReporte(a.ruta, token).catch((e) => setErr(e.message))}>
              Descargar
            </button>
          </div>
        ))}
      </div>

      {difBodega && (
        <div className="card">
          <h3>Diferencias por bodega</h3>
          {difBodega.length === 0 ? (
            <p className="vacio">Sin diferencias registradas todavía.</p>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 4 }}>
                {difBodega.map((d) => {
                  const max = difBodega[0].diferencia || 1;
                  return (
                    <div key={d.bodega} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 200, fontSize: ".83rem" }}>{d.bodega}</span>
                      <div style={{ flex: 1, background: "var(--fondo)", borderRadius: 6, height: 14 }}>
                        <div style={{ width: `${Math.max(4, d.diferencia / max * 100)}%`, height: 14,
                                      background: "var(--azul)", borderRadius: 6 }} />
                      </div>
                      <b style={{ width: 56, textAlign: "right", fontSize: ".83rem" }}>{d.diferencia}</b>
                    </div>
                  );
                })}
              </div>
              <p className="pista">Suma de |contado − sistema| sobre lo confirmado en cada bodega.</p>
            </>
          )}
        </div>
      )}

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
            <>
              <h3>Sobrepedido frente a la receta</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                {analisis.subutilizados.slice(0, 5).map((s) => (
                  <div key={s.nombre} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 160, fontSize: ".83rem" }}>{s.nombre}</span>
                    <div style={{ flex: 1, background: "var(--fondo)", borderRadius: 6, height: 14 }}>
                      <div style={{ width: `${Math.min(100, s.sobrepedido_pct)}%`, height: 14,
                                    background: "var(--amarillo)", borderRadius: 6 }} />
                    </div>
                    <b style={{ width: 44, textAlign: "right", fontSize: ".83rem" }}>{s.sobrepedido_pct}%</b>
                  </div>
                ))}
              </div>
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
              {recomendacion && (
                <div className="banner" style={{ marginTop: 14 }}>
                  <span className="ico">i</span>
                  <span>
                    <b>Recomendación automática</b>
                    <span>
                      {recomendacion.nombre} sobra en {recomendacion.veces} de los servicios
                      legalizados ({recomendacion.sobrepedido_pct}% por encima de lo usado).
                      Ajustar la receta liberaría inventario. La decisión es del chef: el
                      agente solo muestra el patrón.
                    </span>
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Marco>
  );
}
