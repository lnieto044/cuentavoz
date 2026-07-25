import { useEffect, useState } from "react";
import { pedir } from "../api";
import Marco from "../Marco";

export default function Auditoria({ token, usuario }) {
  const [alertas, setAlertas] = useState([]);
  const [bodegas, setBodegas] = useState([]);
  const [msg, setMsg] = useState("");
  const esAuditor = usuario?.perfil === "auditor";

  function cargar() {
    pedir("/api/alertas?resueltas=0", {}, token).then(setAlertas).catch(() => {});
    pedir("/api/bodegas", {}, token).then(setBodegas).catch(() => {});
  }
  useEffect(cargar, [token]);

  async function resolver(id) {
    try {
      await pedir(`/api/alertas/${id}/resolver`, { method: "POST" }, token);
      setMsg("Alerta resuelta.");
      cargar();
    } catch (e) { setMsg(e.message); }
  }
  async function cerrarBodega(id, nombre) {
    if (!window.confirm(`¿Cerrar ${nombre} con doble firma?`)) return;
    try {
      await pedir(`/api/bodegas/${id}/cerrar`, { method: "POST" }, token);
      setMsg(`${nombre} cerrada con doble firma.`);
      cargar();
    } catch (e) { setMsg(e.message); }
  }

  const abiertas = bodegas.filter((b) => b.estado === "en_conteo");

  return (
    <Marco titulo="Auditoría  ·  alertas y cierre"
           chip={{ texto: `${alertas.length} ALERTAS ABIERTAS`,
                   tipo: alertas.length ? "oro" : "verde" }}>
      {!esAuditor && (
        <div className="banner">
          <span className="ico">!</span>
          <span>
            <b>Su perfil es auxiliar</b>
            <span>Resolver alertas y cerrar bodegas requiere perfil de administrador.
                  Ingrese como «diana» para probarlo.</span>
          </span>
        </div>
      )}
      {msg && <p className="msg-ok">{msg}</p>}

      <div className="card">
        <h3>Bandeja de alertas</h3>
        {alertas.length === 0 ? (
          <p className="vacio">No hay alertas abiertas.</p>
        ) : (
          alertas.map((a) => (
            <div className="registro" key={a.id}>
              <span className="chip oro">{a.tipo}</span>
              <span>{a.articulo || "—"} · {a.detalle}</span>
              <span className="cant">{a.hora}</span>
              {esAuditor && (
                <button className="btn" style={{ padding: "6px 12px", minHeight: 0 }}
                        onClick={() => resolver(a.id)}>Resolver</button>
              )}
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h3>Bodegas listas para cerrar con doble firma</h3>
        {abiertas.length === 0 ? (
          <p className="vacio">Ninguna bodega en conteo en este momento.</p>
        ) : (
          abiertas.map((b) => (
            <div className="registro" key={b.id}>
              <span className="chip azul">EN CONTEO</span>
              <span>{b.bodega}</span>
              <span className="cant">{b.referencias} refs</span>
              {esAuditor && (
                <button className="btn verde" style={{ padding: "6px 12px", minHeight: 0 }}
                        onClick={() => cerrarBodega(b.id, b.bodega)}>
                  Cerrar con doble firma
                </button>
              )}
            </div>
          ))
        )}
        <p className="pista" style={{ marginTop: 10 }}>
          Ninguna bodega se cierra con una sola firma: es la garantía de trazabilidad.
        </p>
      </div>
    </Marco>
  );
}
