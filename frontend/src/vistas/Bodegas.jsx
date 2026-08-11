import { useEffect, useState } from "react";
import { pedir, BASE, leerToken, descargarReporte } from "../api";
import { escuchar, hablar } from "../voz";
import Marco from "../Marco";
import Dialogo from "../Dialogo";

const ETIQUETA = {
  pendiente: ["PENDIENTE", "gris"], en_conteo: ["EN CONTEO", "azul"],
  en_auditoria: ["EN AUDITORÍA", "oro"], cerrada: ["CERRADA", "verde"],
};
const ICONO_ESTADO = {
  pendiente: "🕗", en_conteo: "🎙️", en_auditoria: "🔍", cerrada: "✅",
};

export default function Bodegas({ token, usuario, ir }) {
  const [lista, setLista] = useState(null);
  const [filtro, setFiltro] = useState("todas");
  const [detalle, setDetalle] = useState(null);
  const [detalleId, setDetalleId] = useState(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [busca, setBusca] = useState("");
  const [consulta, setConsulta] = useState(null);
  const [escuchando, setEscuchando] = useState(false);
  const [movimientos, setMovimientos] = useState(null);
  const [enRecetas, setEnRecetas] = useState(null);
  const [articulosBodega, setArticulosBodega] = useState(null);
  const [buscaArticuloBodega, setBuscaArticuloBodega] = useState("");
  const [escuchandoBodega, setEscuchandoBodega] = useState(false);
  const [msg, setMsg] = useState("");
  const [pedirMotivo, setPedirMotivo] = useState(false);
  const esAuditor = usuario?.perfil === "auditor";

  useEffect(() => {
    pedir("/api/bodegas?propias=1", {}, token).then(setLista).catch(() => {});
    /* tablero en vivo: el WebSocket avisa a todas las tabletas */
    const ws = new WebSocket(
      BASE.replace("http", "ws") + "/api/bodegas/estado?token=" + (token || leerToken())
    );
    ws.onmessage = (e) => {
      const estados = JSON.parse(e.data);
      setLista((previa) => {
        const prev = previa || [];
        const hayNuevas = estados.some((x) => !prev.some((b) => b.id === x.id));
        if (hayNuevas) {
          // bodega creada despues de cargar el tablero: se necesita el
          // listado completo (referencias, persona, avance) que el
          // WebSocket no manda, no solo el id/estado.
          pedir("/api/bodegas?propias=1", {}, token).then(setLista).catch(() => {});
          return prev;
        }
        return prev.map((b) => {
          const n = estados.find((x) => x.id === b.id);
          return n ? { ...b, estado: n.estado } : b;
        });
      });
    };
    return () => ws.close();
  }, [token]);

  const vistas = (lista || []).filter((b) => filtro === "todas" || b.estado === filtro);
  const cuenta = (e) => (lista || []).filter((b) => b.estado === e).length;

  async function verDetalle(id) {
    setDetalleId(id);
    setArticulosBodega(null);
    setBuscaArticuloBodega("");
    setCargandoDetalle(true);
    try {
      setDetalle(await pedir(`/api/bodegas/${id}/detalle`, {}, token));
    } finally {
      setCargandoDetalle(false);
    }
  }
  async function verTodosLosArticulos() {
    if (articulosBodega) { setArticulosBodega(null); return; }
    setArticulosBodega(await pedir(`/api/bodegas/${detalleId}/articulos`, {}, token));
  }
  async function buscarEnBodega(texto) {
    setBuscaArticuloBodega(texto);
    if (texto && !articulosBodega) {
      setArticulosBodega(await pedir(`/api/bodegas/${detalleId}/articulos`, {}, token));
    }
  }
  function buscarEnBodegaPorVoz() {
    escuchar({
      alTexto: buscarEnBodega,
      alEstado: (e) => setEscuchandoBodega(e === "escuchando"),
      alError: setMsg,
    });
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
      pedir("/api/bodegas?propias=1", {}, token).then(setLista).catch(() => {});
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

  async function exportarDetalle() {
    setMsg("");
    try {
      const r = await pedir(`/api/bodegas/${detalleId}/exportar-detalle?formato=xlsx`,
                            { method: "POST" }, token);
      await descargarReporte(r.archivo, token);
      setMsg("Detalle de la bodega exportado y descargado.");
    } catch (e) { setMsg(e.message); }
  }

  const tituloDetalle = detalle ? `Bodegas  ·  ${detalle.bodega.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}` : "";
  const chipDetalle = detalle ? (ETIQUETA[detalle.estado] || [detalle.estado?.toUpperCase(), ""]) : null;

  return (
    <Marco titulo={consulta ? "Bodegas  ·  consulta de artículo" : detalle ? tituloDetalle : "Bodegas  ·  estado en vivo"}
           chip={consulta ? { texto: "BÚSQUEDA GLOBAL", tipo: "borde azul" }
                          : detalle ? { texto: chipDetalle[0], tipo: `borde ${chipDetalle[1]}` }
                          : { texto: "EN VIVO", tipo: "verde" }}>

      {cargandoDetalle && <p className="cargando">Cargando…</p>}

      {!detalle && !cargandoDetalle && (
      <div className="card">
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
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
                    <div className="kpi-cabeza">
                      <span className="icono-kpi">📦</span>
                      <small>Total en el sistema</small>
                    </div>
                    <b>{consulta.total.toLocaleString("es-CO", { maximumFractionDigits: 1 })} {consulta.unidad}</b>
                    <i>en {consulta.bodegas.length} bodegas</i>
                  </div>
                  <div className="kpi">
                    <div className="kpi-cabeza">
                      <span className="icono-kpi">🍽️</span>
                      <small>Consumo del mes</small>
                    </div>
                    <b>{consulta.consumo_mes} {consulta.unidad}</b>
                    <i>{consulta.servicios_mes} servicios</i>
                  </div>
                  <div className="kpi verde">
                    <div className="kpi-cabeza">
                      <span className="icono-kpi">📈</span>
                      <small>Cobertura estimada</small>
                    </div>
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
                  {esAuditor && (
                    <button className="btn" onClick={generarReporteArticulo}>Generar reporte</button>
                  )}
                  <button className="btn borde" onClick={verMovimientos}>Ver movimientos</button>
                  <button className="btn borde" onClick={verEnRecetas}>Comparar con la receta</button>
                  <button className="btn gris" onClick={volverAlTablero}>← Volver al tablero</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
      )}

      {msg && <p className="msg-ok">{msg}</p>}

      {!consulta && detalle && (
        <div className="card">
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: "var(--grafito)" }}>🔍</span>
            <input value={buscaArticuloBodega}
                   onChange={(e) => buscarEnBodega(e.target.value)}
                   placeholder="buscar un artículo en esta bodega…"
                   style={{ flex: 1, minWidth: 200, padding: "13px 14px", fontSize: "1rem",
                            border: "1px solid var(--borde)", borderRadius: 12 }} />
            <button className={`mic-btn ${escuchandoBodega ? "escuchando" : ""}`}
                    style={{ width: 46, height: 46, fontSize: "1.2rem" }}
                    onClick={buscarEnBodegaPorVoz} title="o pregunte por voz">🎤</button>
          </div>
          <p className="pista" style={{ marginTop: 8, marginBottom: 14 }}>o pregunte por voz</p>

          <div className="chips">
            <span className="chip">{detalle.referencias} referencias</span>
            {detalle.estado === "cerrada" && detalle.hora_cierre && (
              <span className="chip verde">Cerrada {detalle.hora_cierre}</span>
            )}
            {detalle.personas && <span className="chip azul">{detalle.personas}</span>}
            {detalle.alertas_resueltas > 0 && (
              <span className="chip oro">
                {detalle.alertas_resueltas} alerta{detalle.alertas_resueltas === 1 ? "" : "s"} resuelta
                {detalle.alertas_resueltas === 1 ? "" : "s"}
              </span>
            )}
          </div>

          <div className="kpis">
            <div className="kpi verde">
              <div className="kpi-cabeza">
                <span className="icono-kpi">✅</span>
                <small>Exactitud de esta bodega</small>
              </div>
              <b>{detalle.exactitud}</b>
              <i>{detalle.diferencias.length} diferencias de {detalle.referencias}</i>
            </div>
            <div className="kpi">
              <div className="kpi-cabeza">
                <span className="icono-kpi">⏱️</span>
                <small>Duración del conteo</small>
              </div>
              <b>{detalle.duracion_min != null ? `${detalle.duracion_min} min` : "—"}</b>
              <i>{detalle.tiempo_papel_min
                ? `frente a ~${detalle.tiempo_papel_min} min en papel (estimado)`
                : "conteo aún en curso"}</i>
            </div>
            <div className="kpi">
              <div className="kpi-cabeza">
                <span className="icono-kpi">📦</span>
                <small>Unidades en stock</small>
              </div>
              <b>{detalle.unidades_stock.toLocaleString("es-CO")}</b>
              <i>sumadas todas las referencias</i>
            </div>
            <div className="kpi oro">
              <div className="kpi-cabeza">
                <span className="icono-kpi">🕘</span>
                <small>Última toma anterior</small>
              </div>
              <b>{detalle.ultima_toma_anterior
                ? new Date(detalle.ultima_toma_anterior.fecha).toLocaleDateString("es-CO", { day: "numeric", month: "short" })
                : "—"}</b>
              <i>{detalle.ultima_toma_anterior ? `exactitud ${detalle.ultima_toma_anterior.exactitud}%` : "sin cierres previos"}</i>
            </div>
          </div>

          <div className="dos-columnas" style={{ gap: 16, marginTop: 4 }}>
            <div>
              <h3>Referencias con diferencia</h3>
              {detalle.diferencias.length > 0 ? (
                <table>
                  <thead><tr><th>Artículo</th><th>Contado</th><th>Sistema</th><th>Dif.</th></tr></thead>
                  <tbody>
                    {detalle.diferencias.map((d, i) => (
                      <tr key={i}><td>{d.articulo}</td><td>{d.contado}</td>
                          <td>{d.sistema}</td><td className="dif">{d.diferencia}</td></tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="vacio">Todas las referencias cuadraron exactas.</p>}
              {detalle.diferencias.length > 0 && detalle.diferencias.length < detalle.referencias && (
                <p className="pista" style={{ marginTop: 8 }}>
                  Las otras {detalle.referencias - detalle.diferencias.length} referencias cuadraron exactas.
                </p>
              )}
              {detalle.diferencias.length > 0 && detalle.revisor && (
                <p className="pista">
                  Las {detalle.diferencias.length} diferencias fueron revisadas por {detalle.revisor} al cierre.
                </p>
              )}
            </div>

            <div>
              <h3>Línea de tiempo de la toma</h3>
              {detalle.hitos.length > 0 ? detalle.hitos.map((h, i) => (
                <div className="registro" key={i}>
                  <span style={{
                    width: 10, height: 10, borderRadius: "50%", flex: "none",
                    background: h.tipo === "verde" ? "var(--verde)"
                              : h.tipo === "oro" ? "var(--amarillo)" : "var(--azul)",
                  }} />
                  <b style={{ color: "var(--grafito)" }}>{h.hora}</b>
                  <span>{h.texto}</span>
                </div>
              )) : <p className="vacio">Sin movimientos registrados todavía.</p>}
            </div>
          </div>

          {articulosBodega && (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ margin: 0 }}>
                {buscaArticuloBodega
                  ? `Artículos que coinciden con "${buscaArticuloBodega}"`
                  : `Todos los artículos (${articulosBodega.length})`}
              </h3>
              <div style={{ maxHeight: 420, overflowY: "auto", marginTop: 10 }}>
                <table>
                  <thead><tr><th>Código</th><th>Artículo</th><th>Unidad</th><th>SD</th></tr></thead>
                  <tbody>
                    {articulosBodega
                      .filter((a) => {
                        const palabras = buscaArticuloBodega.toLowerCase()
                          .replace(/[,;.]/g, " ").split(/\s+/).filter(Boolean);
                        if (!palabras.length) return true;
                        const nombre = a.articulo.toLowerCase();
                        return palabras.every((p) => nombre.includes(p));
                      })
                      .map((a) => (
                        <tr key={a.codigo}>
                          <td>{a.codigo}</td><td>{a.articulo}</td>
                          <td>{a.unidad}</td><td>{a.sd.toLocaleString("es-CO")}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="grilla-botones">
            {esAuditor && detalle.estado === "cerrada" && (
              <button className="btn borde" onClick={() => setPedirMotivo(true)}>Reabrir la bodega</button>
            )}
            <button className="btn borde" onClick={verTodosLosArticulos}>
              {articulosBodega ? "Ocultar artículos" : `Ver todos los artículos (${detalle.referencias})`}
            </button>
            {esAuditor && (
              <button className="btn borde" onClick={exportarDetalle}>Descargar detalle</button>
            )}
            {esAuditor && (
              <button className="btn" onClick={() => ir && ir("panel")}>Ver en el panel gerencial</button>
            )}
            <button className="btn gris" onClick={() => { setDetalle(null); setDetalleId(null); }}>
              Cerrar detalle
            </button>
          </div>
          {esAuditor && detalle.estado === "cerrada" && (
            <p className="pista" style={{ marginTop: 10 }}>
              Reabrir una bodega cerrada exige justificación escrita y queda en el registro de trazabilidad.
            </p>
          )}
        </div>
      )}

      {!consulta && !detalle && !cargandoDetalle && lista === null && (
        <p className="cargando">Cargando…</p>
      )}

      {!consulta && !detalle && !cargandoDetalle && lista !== null && (
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

          {lista.length === 0 ? (
            <p className="vacio">No hay bodegas para mostrar.</p>
          ) : (
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
                  <b><span className="icono-tarjeta">{ICONO_ESTADO[b.estado] || "🏬"}</span>{b.bodega}</b>
                  <span className={`chip ${cls} est`}>{txt}</span>
                  <small>{detalleLinea}</small>
                </button>
              );
            })}
          </div>
          )}
          <p className="pista" style={{ marginTop: 12 }}>
            Cada tarjeta se actualiza al instante por WebSocket cuando alguien abre o cierra una bodega.
          </p>

          <div className="grilla-botones">
            <button className="btn borde"
                    onClick={() => detalleId ? verDetalle(detalleId)
                                  : setMsg("Toque primero una tarjeta para ver su detalle.")}>
              Ver detalle
            </button>
            {esAuditor && (
              <button className="btn borde" onClick={exportarEstado}>Exportar estado</button>
            )}
            {esAuditor && (
              <button className="btn" onClick={() => ir && ir("ajustes")}>
                Asignar personas a bodegas
              </button>
            )}
          </div>
        </>
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
