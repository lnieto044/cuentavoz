import { useEffect, useState } from "react";
import { pedir, BASE, leerToken, descargarReporte } from "../api";
import { escuchar, hablar } from "../voz";
import Marco from "../Marco";
import Dialogo from "../Dialogo";

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
  const [escuchando, setEscuchando] = useState(false);
  const [movimientos, setMovimientos] = useState(null);
  const [enRecetas, setEnRecetas] = useState(null);
  const [msg, setMsg] = useState("");
  const [pedirMotivo, setPedirMotivo] = useState(false);
  const [asignando, setAsignando] = useState(false);
  const [auditores, setAuditores] = useState([]);
  const [bodegaAsignar, setBodegaAsignar] = useState("");
  const [auditorAsignar, setAuditorAsignar] = useState("");
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
  async function buscarArticulo(codigo = "", texto = busca) {
    if (!texto.trim()) return;
    setBusca(texto);
    setMovimientos(null);
    setEnRecetas(null);
    const r = await pedir(
      `/api/articulos/consulta?q=${encodeURIComponent(texto)}&codigo=${codigo}`, {}, token);
    setConsulta(r);
    hablar(r.resumen);
  }
  function buscarPorVoz() {
    escuchar({
      alTexto: (t) => buscarArticulo("", t),
      alEstado: (e) => setEscuchando(e === "escuchando"),
      alError: setMsg,
    });
  }
  function volverAlTablero() {
    setConsulta(null);
    setBusca("");
  }
  async function verMovimientos() {
    setMovimientos(await pedir(`/api/articulos/${consulta.codigo}/movimientos`, {}, token));
  }
  async function verEnRecetas() {
    setEnRecetas(await pedir(`/api/articulos/${consulta.codigo}/en-recetas`, {}, token));
  }
  async function generarReporteArticulo() {
    setMsg("");
    try {
      const r = await pedir("/api/reportes?formato=xlsx", { method: "POST" }, token);
      await descargarReporte(r.archivo, token);
      setMsg("Reporte generado y descargado.");
    } catch (e) { setMsg(e.message); }
  }
  async function reabrir(motivo) {
    setPedirMotivo(false);
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

  async function exportarEstado() {
    setMsg("");
    try {
      const r = await pedir("/api/bodegas/exportar-estado?formato=xlsx", { method: "POST" }, token);
      await descargarReporte(r.archivo, token);
      setMsg("Estado del tablero exportado y descargado.");
    } catch (e) { setMsg(e.message); }
  }

  async function abrirAsignarAuditor() {
    setBodegaAsignar(detalleId || lista[0]?.id || "");
    const usuarios = await pedir("/api/usuarios", {}, token).catch(() => []);
    const soloAuditores = usuarios.filter((x) => x.perfil === "auditor");
    setAuditores(soloAuditores);
    setAuditorAsignar(soloAuditores[0]?.id || "");
    setAsignando(true);
  }

  async function guardarAsignacionAuditor() {
    if (!bodegaAsignar || !auditorAsignar) return;
    setAsignando(false);
    try {
      const actuales = await pedir(`/api/usuarios/${auditorAsignar}/bodegas`, {}, token);
      const nuevas = [...new Set([...actuales, Number(bodegaAsignar)])];
      await pedir(`/api/usuarios/${auditorAsignar}/bodegas`, {
        method: "PUT", body: JSON.stringify({ bodega_ids: nuevas }),
      }, token);
      const bodega = lista.find((b) => b.id === Number(bodegaAsignar));
      const auditor = auditores.find((a) => a.id === Number(auditorAsignar));
      setMsg(`${bodega?.bodega || "Bodega"} asignada a ${auditor?.nombre || "auditor"}.`);
    } catch (e) { setMsg(e.message); }
  }

  return (
    <Marco titulo={consulta ? "Bodegas  ·  consulta de artículo" : "Bodegas  ·  estado en vivo"}
           chip={consulta ? { texto: "BÚSQUEDA GLOBAL", tipo: "" }
                          : { texto: "EN VIVO", tipo: "verde" }}>

      <div className="card">
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ color: "var(--grafito)" }}>🔍</span>
          <input value={busca} onChange={(e) => setBusca(e.target.value)}
                 onKeyDown={(e) => e.key === "Enter" && buscarArticulo()}
                 placeholder="arroz, aceite, cazuela…"
                 style={{ flex: 1, minWidth: 200, padding: "13px 14px", fontSize: "1rem",
                          border: "1px solid var(--borde)", borderRadius: 12 }} />
          <button className={`mic-btn ${escuchando ? "escuchando" : ""}`}
                  style={{ width: 46, height: 46, fontSize: "1.2rem" }}
                  onClick={buscarPorVoz} title="o pregunte por voz">🎤</button>
          <button className="btn" onClick={() => buscarArticulo()}>Buscar</button>
        </div>
        {!consulta && <p className="pista" style={{ marginTop: 8 }}>o pregunte por voz</p>}

        {consulta && (
          <>
            <p className="rotulo" style={{ marginTop: 14 }}>CuentaVoz responde</p>
            <p className="burbuja">{consulta.resumen}</p>
            {consulta.ambiguo && consulta.alternativas?.length > 0 && (
              <div className="chips" style={{ marginTop: 10 }}>
                <span className="pista" style={{ width: "100%" }}>¿Era este otro?</span>
                {consulta.alternativas.map((a) => (
                  <button key={a.codigo} className="chip oro"
                          onClick={() => buscarArticulo(a.codigo)}>
                    {a.nombre}
                  </button>
                ))}
              </div>
            )}

            {consulta.bodegas?.length > 0 && (
              <>
                <div className="kpis" style={{ marginTop: 14 }}>
                  <div className="kpi">
                    <small>Total en el sistema</small>
                    <b>{consulta.total.toLocaleString("es-CO", { maximumFractionDigits: 1 })} {consulta.unidad}</b>
                    <i>en {consulta.bodegas.length} bodegas</i>
                  </div>
                  <div className="kpi">
                    <small>Consumo del mes</small>
                    <b>{consulta.consumo_mes} {consulta.unidad}</b>
                    <i>{consulta.servicios_mes} servicios</i>
                  </div>
                  <div className="kpi verde">
                    <small>Cobertura estimada</small>
                    <b>{consulta.cobertura_dias != null ? `${consulta.cobertura_dias} días` : "—"}</b>
                    <i>{consulta.cobertura_dias != null ? "al ritmo actual" : "sin consumo reciente"}</i>
                  </div>
                </div>

                <table style={{ marginTop: 6 }}>
                  <thead><tr><th>Bodega</th><th>Cantidad</th><th>Última toma</th><th>Estado</th></tr></thead>
                  <tbody>
                    {consulta.bodegas.map((b, i) => (
                      <tr key={i}>
                        <td>{b.bodega}</td><td>{b.cantidad} {consulta.unidad}</td>
                        <td>{b.ultima_toma}</td><td>{ETIQUETA[b.estado]?.[0] || b.estado}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="grilla-botones">
                  <button className="btn" onClick={generarReporteArticulo}>Generar reporte</button>
                  <button className="btn borde" onClick={verMovimientos}>Ver movimientos</button>
                  <button className="btn borde" onClick={verEnRecetas}>Comparar con la receta</button>
                  <button className="btn gris" onClick={volverAlTablero}>← Volver al tablero</button>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {msg && <p className="msg-ok">{msg}</p>}

      {!consulta && (
        <>
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
                  <button className="btn oro" onClick={() => setPedirMotivo(true)}>Reabrir la bodega</button>
                )}
                <button className="btn" onClick={() => ir && ir("panel")}>Ver en el panel gerencial</button>
              </div>
            </div>
          )}

          <div className="grid-bodegas">
            {vistas.map((b) => {
              const [txt, cls] = ETIQUETA[b.estado] || ["?", "gris"];
              let detalleLinea;
              if (b.estado === "en_conteo" && b.persona) {
                detalleLinea = `${b.persona} · ${b.avance_pct ?? 0}%`;
              } else if (b.estado === "en_auditoria" && b.persona) {
                detalleLinea = `${b.persona} · ${b.diferencias ?? 0} dif.`;
              } else if (b.estado === "cerrada" && b.hora_cierre) {
                detalleLinea = `${b.referencias} refs · ${b.hora_cierre}`;
              } else if (b.estado === "pendiente") {
                detalleLinea = "sin iniciar";
              } else {
                detalleLinea = `${b.referencias} referencias`;
              }
              return (
                <button key={b.id} className={`tarjeta-bodega ${b.estado}`}
                        onClick={() => verDetalle(b.id)}>
                  <b>{b.bodega}</b>
                  <span className={`chip ${cls} est`}>{txt}</span>
                  <small>{detalleLinea}</small>
                </button>
              );
            })}
          </div>
          <p className="pista" style={{ marginTop: 12 }}>
            Cada tarjeta se actualiza al instante por WebSocket. Toque una para ver su detalle.
          </p>

          <div className="grilla-botones">
            <button className="btn borde"
                    onClick={() => detalleId ? verDetalle(detalleId)
                                  : setMsg("Toque primero una tarjeta para ver su detalle.")}>
              Ver detalle
            </button>
            <button className="btn borde" onClick={exportarEstado}>Exportar estado</button>
            {esAuditor && (
              <button className="btn" onClick={abrirAsignarAuditor}>Asignar auditor</button>
            )}
          </div>
        </>
      )}

      {asignando && (
        <div className="overlay" onClick={() => setAsignando(false)}>
          <div className="modal" style={{ maxWidth: 460, textAlign: "left" }}
               onClick={(e) => e.stopPropagation()}>
            <h2>Asignar auditor</h2>
            <label className="pista">Bodega</label>
            <select value={bodegaAsignar} onChange={(e) => setBodegaAsignar(e.target.value)}
                    style={{ width: "100%", padding: "10px 12px", marginTop: 6, marginBottom: 14,
                             border: "1px solid var(--borde)", borderRadius: 10 }}>
              {lista.map((b) => <option key={b.id} value={b.id}>{b.bodega}</option>)}
            </select>
            <label className="pista">Auditor</label>
            <select value={auditorAsignar} onChange={(e) => setAuditorAsignar(e.target.value)}
                    style={{ width: "100%", padding: "10px 12px", marginTop: 6,
                             border: "1px solid var(--borde)", borderRadius: 10,
                             textTransform: "capitalize" }}>
              {auditores.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
            {auditores.length === 0 && (
              <p className="pista" style={{ marginTop: 10 }}>No hay usuarios con perfil administrador.</p>
            )}
            <div className="botones" style={{ marginTop: 18 }}>
              <button className="btn borde" onClick={() => setAsignando(false)}>Cancelar</button>
              <button className="btn" onClick={guardarAsignacionAuditor}>Asignar</button>
            </div>
          </div>
        </div>
      )}

      {pedirMotivo && (
        <Dialogo titulo="Reabrir bodega cerrada"
                 mensaje="Esta acción exige una justificación escrita y queda registrada en el historial. Motivo:"
                 conCampo multilinea placeholder="revisión solicitada por el chef"
                 textoAceptar="Reabrir" peligro
                 onAceptar={reabrir}
                 onCancelar={() => setPedirMotivo(false)} />
      )}

      {movimientos && (
        <Dialogo titulo="Movimientos recientes"
                 mensaje={movimientos.length
                   ? movimientos.map((m) => `${m.hora} · ${m.bodega} · ${m.persona}: ${m.cantidad} ${m.unidad}`).join("\n")
                   : "Sin conteos registrados todavía para este artículo."}
                 textoAceptar="Cerrar" onAceptar={() => setMovimientos(null)}
                 onCancelar={() => setMovimientos(null)} />
      )}

      {enRecetas && (
        <Dialogo titulo="En qué recetas aparece"
                 mensaje={enRecetas.length
                   ? enRecetas.map((r) => `${r.receta}: ${r.por_porcion} por porción (rinde ${r.rendimiento})`).join("\n")
                   : "Este artículo no aparece en ninguna receta cargada."}
                 textoAceptar="Cerrar" onAceptar={() => setEnRecetas(null)}
                 onCancelar={() => setEnRecetas(null)} />
      )}
    </Marco>
  );
}
