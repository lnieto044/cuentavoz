import { useEffect, useState } from "react";
import { pedir, BASE, leerToken } from "../api";
import Marco from "../Marco";

const ETIQUETA = {
  pendiente: ["PENDIENTE", "gris"], en_conteo: ["EN CONTEO", "azul"],
  en_auditoria: ["EN AUDITORÍA", "oro"], cerrada: ["CERRADA", "verde"],
};

export default function Bodegas({ token, usuario, ir }) {
  const [lista, setLista] = useState([]);
  const [filtro, setFiltro] = useState("todas");
  const [detalle, setDetalle] = useState(null);
  const [detalleId, setDetalleId] = useState(null);
  const [busca, setBusca] = useState("");
  const [consulta, setConsulta] = useState(null);
  const [msg, setMsg] = useState("");
  const esAuditor = usuario?.perfil === "auditor";

  useEffect(() => {
    pedir("/api/bodegas", {}, token).then(setLista).catch(() => {});
    /* tablero en vivo: el WebSocket avisa a todas las tabletas */
    const ws = new WebSocket(
      BASE.replace("http", "ws") + "/api/bodegas/estado?token=" + (token || leerToken())
    );
    ws.onmessage = (e) => {
      const estados = JSON.parse(e.data);
      setLista((prev) =>
        prev.map((b) => {
          const n = estados.find((x) => x.id === b.id);
          return n ? { ...b, estado: n.estado } : b;
        })
      );
    };
    return () => ws.close();
  }, [token]);

  const vistas = lista.filter((b) => filtro === "todas" || b.estado === filtro);
  const cuenta = (e) => lista.filter((b) => b.estado === e).length;

  async function verDetalle(id) {
    setDetalleId(id);
    setDetalle(await pedir(`/api/bodegas/${id}/detalle`, {}, token));
  }
  async function buscarArticulo() {
    if (!busca.trim()) return;
    setConsulta(await pedir(`/api/articulos/consulta?q=${encodeURIComponent(busca)}`, {}, token));
  }
  async function reabrir() {
    const motivo = window.prompt("Motivo para reabrir esta bodega cerrada (obligatorio):");
    if (!motivo || !motivo.trim()) return;
    try {
      await pedir(`/api/bodegas/${detalleId}/reabrir`, {
        method: "POST", body: JSON.stringify({ motivo }),
      }, token);
      setMsg("Bodega reabierta: queda registrada la justificación.");
      verDetalle(detalleId);
      pedir("/api/bodegas", {}, token).then(setLista).catch(() => {});
    } catch (e) { setMsg(e.message); }
  }

  return (
    <Marco titulo="Bodegas  ·  estado en vivo" chip={{ texto: "EN VIVO", tipo: "verde" }}>
      <div className="chips">
        {[["todas", `${lista.length} bodegas`, ""],
          ["cerrada", `${cuenta("cerrada")} cerradas`, "verde"],
          ["en_conteo", `${cuenta("en_conteo")} en conteo`, ""],
          ["en_auditoria", `${cuenta("en_auditoria")} en auditoría`, "oro"],
          ["pendiente", `${cuenta("pendiente")} pendientes`, "gris"]].map(([k, t, c]) => (
          <button key={k} className={`chip ${filtro === k ? "azul" : c}`}
                  onClick={() => setFiltro(k)}>{t}</button>
        ))}
      </div>

      <div className="card">
        <h3>Consulta de artículo: dónde está y cuánto hay</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input value={busca} onChange={(e) => setBusca(e.target.value)}
                 onKeyDown={(e) => e.key === "Enter" && buscarArticulo()}
                 placeholder="arroz, aceite, cazuela…"
                 style={{ flex: 1, minWidth: 200, padding: "11px 13px",
                          border: "1px solid var(--borde)", borderRadius: 12 }} />
          <button className="btn" onClick={buscarArticulo}>Buscar</button>
        </div>
        {consulta && (
          <>
            <p className="burbuja" style={{ marginTop: 12 }}>{consulta.resumen}</p>
            {consulta.bodegas?.length > 0 && (
              <table style={{ marginTop: 12 }}>
                <thead><tr><th>Bodega</th><th>Cantidad</th><th>Estado</th></tr></thead>
                <tbody>
                  {consulta.bodegas.map((b, i) => (
                    <tr key={i}><td>{b.bodega}</td><td>{b.cantidad}</td><td>{b.estado}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {msg && <p className="msg-ok">{msg}</p>}
      {detalle && (
        <div className="card">
          <h3>{detalle.bodega} · detalle</h3>
          <div className="chips">
            <span className="chip">{detalle.contadas} de {detalle.referencias} referencias</span>
            {detalle.duracion_min != null && (
              <span className="chip">Duración del conteo: {detalle.duracion_min} min</span>
            )}
            {detalle.ultima_toma_anterior && (
              <span className="chip gris">
                Última toma anterior: {detalle.ultima_toma_anterior.exactitud}% ·{" "}
                {detalle.ultima_toma_anterior.fecha}
              </span>
            )}
          </div>
          <div className="kpis">
            <div className="kpi verde"><small>Exactitud de esta bodega</small><b>{detalle.exactitud}</b></div>
            <div className="kpi"><small>Referencias</small><b>{detalle.referencias}</b></div>
            <div className="kpi"><small>Contadas</small><b>{detalle.contadas}</b></div>
            <div className="kpi oro"><small>Con diferencia</small><b>{detalle.diferencias.length}</b></div>
          </div>
          {detalle.diferencias.length > 0 && (
            <table>
              <thead><tr><th>Artículo</th><th>Contado</th><th>Sistema</th><th>Dif.</th></tr></thead>
              <tbody>
                {detalle.diferencias.map((d, i) => (
                  <tr key={i}><td>{d.articulo}</td><td>{d.contado}</td>
                      <td>{d.sistema}</td><td className="dif">{d.diferencia}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {detalle.hitos.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>Línea de tiempo</h3>
              {detalle.hitos.map((h, i) => (
                <div className="registro" key={i}>
                  <b style={{ color: "var(--grafito)" }}>{h.hora}</b>
                  <span>{h.texto}</span>
                </div>
              ))}
            </>
          )}
          <div className="grilla-botones">
            <button className="btn borde" onClick={() => setDetalle(null)}>Cerrar detalle</button>
            {esAuditor && detalle.estado === "cerrada" && (
              <button className="btn oro" onClick={reabrir}>Reabrir la bodega</button>
            )}
            <button className="btn" onClick={() => ir && ir("panel")}>Ver en el panel gerencial</button>
          </div>
        </div>
      )}

      <div className="grid-bodegas">
        {vistas.map((b) => {
          const [txt, cls] = ETIQUETA[b.estado] || ["?", "gris"];
          return (
            <button key={b.id} className={`tarjeta-bodega ${b.estado}`}
                    onClick={() => verDetalle(b.id)}>
              <b>{b.bodega}</b>
              <span className={`chip ${cls} est`}>{txt}</span>
              <small>{b.referencias} referencias</small>
            </button>
          );
        })}
      </div>
      <p className="pista" style={{ marginTop: 12 }}>
        Cada tarjeta se actualiza al instante por WebSocket. Toque una para ver su detalle.
      </p>
    </Marco>
  );
}
