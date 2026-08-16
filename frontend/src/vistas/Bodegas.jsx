import { useEffect, useState, useRef } from "react";
import { pedir, BASE, leerToken, descargarReporte, preguntarAsistente } from "../api";
import { escuchar, hablar, esAfirmacion, esNegacion, quitarTildes } from "../voz";
import Marco from "../Marco";
import Dialogo from "../Dialogo";
import Icono from "../Iconos";

const ETIQUETA = {
  pendiente: ["PENDIENTE", "gris"], en_conteo: ["EN CONTEO", "azul"],
  en_auditoria: ["EN AUDITORÍA", "oro"], cerrada: ["CERRADA", "verde"],
};
const ICONO_ESTADO = {
  pendiente: "🕗", en_conteo: "🎙️", en_auditoria: "🔍", cerrada: "✅",
};

// Frases que este buscador ya entiende sin pasar por el agente general -
// se resuelven de una en el propio frontend (_accionLocalDeLista /
// _accionLocalDeResultado más abajo). Documentarlas aquí es lo mismo que
// el desplegable "Ver frases exactas" de las demás pantallas.
function _ejemplosLista(esAuditor) {
  return [
    "arroz, aceite, tres tablas para picar…",
    "bodega nueva",
    ...(esAuditor ? ["exportar estado", "asignar personas a bodegas"] : []),
    "ver movimientos", "comparar con la receta",
    ...(esAuditor ? ["generar reporte"] : []),
    "volver al tablero",
  ];
}
function _ejemplosDetalle(esAuditor, estado) {
  return [
    "un artículo de esta bodega",
    ...(estado === "pendiente" || estado === "en_conteo" ? ["seguir contando"] : []),
    ...(esAuditor && estado === "cerrada" ? ["reabrir"] : []),
    "todos los artículos",
    ...(esAuditor ? ["descargar", "ver en el panel gerencial"] : []),
    "cerrar detalle",
  ];
}

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
  // Cuando lo buscado en el detalle no es ningún artículo de ESTA bodega,
  // la respuesta del agente general (pregunta suelta u orden de navegar)
  // - mismo patrón que "consulta" en la lista principal.
  const [respuestaAgenteDetalle, setRespuestaAgenteDetalle] = useState(null);
  const [msg, setMsg] = useState("");
  const [pedirMotivo, setPedirMotivo] = useState(false);
  const [pidiendoBodegaNueva, setPidiendoBodegaNueva] = useState(false);
  const esAuditor = usuario?.perfil === "auditor";
  const rec = useRef(null);
  // Igual que en el selector de bodega de Conteo: cada escucha de esta
  // búsqueda lleva su propio número, y si el micrófono anterior entrega
  // su resultado tarde (mientras todavía se está diciendo la sugerencia)
  // se descarta en vez de procesarse como una búsqueda nueva.
  const idEscuchaBusqueda = useRef(0);

  useEffect(() => {
    // si falla, resuelve a [] en vez de dejar lista en null para siempre:
    // sin esto, un fallo de red aquí dejaba el tablero mostrando
    // "Cargando…" sin fin, sin manera de saber que algo salió mal.
    pedir("/api/bodegas?propias=1", {}, token).then(setLista)
      .catch((e) => { setLista([]); setMsg(e.message); });
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
    // Si se llega desde la sugerencia de bodega del buscador de
    // ingredientes, "consulta" sigue puesto - sin limpiarlo, la sección
    // de detalle no se muestra (su condición exige "!consulta").
    setConsulta(null);
    setDetalleId(id);
    setArticulosBodega(null);
    setBuscaArticuloBodega("");
    setRespuestaAgenteDetalle(null);
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
    setRespuestaAgenteDetalle(null);
    if (texto && !articulosBodega) {
      setArticulosBodega(await pedir(`/api/bodegas/${detalleId}/articulos`, {}, token));
    }
  }
  function _filtrarArticulosBodega(texto, lista) {
    const palabras = texto.toLowerCase().replace(/[,;.]/g, " ").split(/\s+/).filter(Boolean);
    if (!palabras.length) return lista || [];
    return (lista || []).filter((a) => {
      const nombre = a.articulo.toLowerCase();
      return palabras.every((p) => nombre.includes(p));
    });
  }
  // Al confirmar (Enter, o al terminar de dictar): si lo escrito/dicho no
  // encuentra ningún artículo DENTRO de esta bodega, cae al mismo agente
  // general que ya usa la lista principal - un solo cuadro para todo,
  // también aquí, en vez de un segundo "Pregúntele al agente" aparte.
  // Igual que _accionLocalDeResultado, pero para los botones del DETALLE
  // de una bodega (Cerrar detalle, Seguir contando...) - se revisan antes
  // que la búsqueda de artículo/el agente general, porque esos botones
  // no tienen equivalente en ningún otro lado: decir "cerrar detalle" sin
  // esto caía en el agente general, que ni sabe qué botones hay en esta
  // pantalla en particular ("Esa opción no la puedo hacer por voz").
  function _accionLocalDeDetalle(texto) {
    const t = quitarTildes(texto.toLowerCase()).replace(/[.,;:!¿?¡]/g, "").trim();
    if (/\b(cerrar|cierra|salir)\b/.test(t)) return "cerrar";
    if (/\b(seguir|sigue|continu\w*|contar|cuenta)\b/.test(t)
        && (detalle?.estado === "pendiente" || detalle?.estado === "en_conteo")) return "contar";
    if (/\b(reabrir|reabre)\b/.test(t) && esAuditor && detalle?.estado === "cerrada") return "reabrir";
    if (/\barticulos?\b/.test(t)) return "articulos";
    if (/\bdescargar\b/.test(t) && esAuditor) return "descargar";
    if (/\bpanel\b/.test(t) && esAuditor) return "panel";
    return null;
  }
  async function confirmarBusquedaEnBodega(texto, miId) {
    if (!texto || !texto.trim()) return;
    if (miId === undefined) miId = ++idEscuchaBusqueda.current;
    const accion = _accionLocalDeDetalle(texto);
    if (accion === "cerrar") { setDetalle(null); setDetalleId(null); return; }
    if (accion === "contar") { ir && ir("conteo", { bodegaSugerida: detalle.bodega }); return; }
    if (accion === "reabrir") { setPedirMotivo(true); return; }
    if (accion === "articulos") { verTodosLosArticulos(); return; }
    if (accion === "descargar") { exportarDetalle(); return; }
    if (accion === "panel") { ir && ir("panel"); return; }
    setBuscaArticuloBodega(texto);
    let lista = articulosBodega;
    if (!lista) {
      lista = await pedir(`/api/bodegas/${detalleId}/articulos`, {}, token);
      if (miId !== idEscuchaBusqueda.current) return;
      setArticulosBodega(lista);
    }
    if (_filtrarArticulosBodega(texto, lista).length > 0) {
      setRespuestaAgenteDetalle(null);
      return;
    }
    const r = await preguntarAsistente(texto, "bodegas", token);
    if (miId !== idEscuchaBusqueda.current) return;
    setRespuestaAgenteDetalle(r);
    hablar(r.respuesta_hablada);
    if (r.accion === "navegar" && r.destino && ir) {
      ir(r.destino, { tabInicial: r.pestana || undefined, bodegaSugerida: r.bodega || undefined });
    }
  }
  function buscarEnBodegaPorVoz() {
    setMsg("");
    const miId = ++idEscuchaBusqueda.current;
    rec.current = escuchar({
      alTexto: (t) => {
        if (miId !== idEscuchaBusqueda.current) return;
        confirmarBusquedaEnBodega(t, miId);
      },
      alEstado: (e) => setEscuchandoBodega(e === "escuchando"),
      alError: setMsg,
    });
  }
  // Frases que activan un botón YA VISIBLE en el resultado de una
  // búsqueda anterior ("volver al tablero", "ver movimientos"...), en
  // vez de tratarse como una búsqueda nueva. Van ANTES que cualquier
  // otra cosa: "tablero" es también parte de un producto real
  // ("BORRADOR PARA TABLERO FELPA"), así que sin este chequeo "volver al
  // tablero" perdía contra ese artículo en la búsqueda por palabras y
  // nunca se reconocía como la orden que era.
  function _accionLocalDeResultado(texto) {
    const t = quitarTildes(texto.toLowerCase()).replace(/[.,;:!¿?¡]/g, "").trim();
    if (/\b(volver|tablero|atras|regresar)\b/.test(t)) return "volver";
    if (/\bmovimientos?\b/.test(t)) return "movimientos";
    if (/\brecetas?\b/.test(t)) return "receta";
    if (/\breporte\b/.test(t)) return "reporte";
    return null;
  }
  // "miId" solo llega cuando la búsqueda vino de buscarPorVoz() (ver ese
  // comentario) - una búsqueda escrita y con clic en "Buscar" no debe
  // quedarse esperando una respuesta hablada que nadie va a dar.
  // Órdenes sobre los botones de la lista principal ("+ Bodega nueva",
  // "Exportar estado", "Asignar personas a bodegas") - mismo patrón que
  // _accionLocalDeResultado/_accionLocalDeDetalle: se revisan antes que
  // cualquier búsqueda, porque el agente general no sabe qué botones hay
  // en esta pantalla en particular.
  function _accionLocalDeLista(texto) {
    const t = quitarTildes(texto.toLowerCase()).replace(/[.,;:!¿?¡]/g, "").trim();
    if (/\bbodega\b/.test(t) && /\b(nueva|crear|solicitar)\b/.test(t)) return "nueva";
    if (/\bexportar\b/.test(t) && esAuditor) return "exportar";
    if (/\basignar\b/.test(t) && esAuditor) return "asignar";
    return null;
  }
  async function buscarArticulo(codigo = "", texto = busca, miId) {
    if (!texto.trim()) return;
    if (!consulta && !detalle) {
      const accionLista = _accionLocalDeLista(texto);
      if (accionLista === "nueva") { setPidiendoBodegaNueva(true); return; }
      if (accionLista === "exportar") { exportarEstado(); return; }
      if (accionLista === "asignar") { ir && ir("ajustes", { tabInicial: "usuarios" }); return; }
    }
    // Si queda una sugerencia de bodega pendiente en pantalla, un "sí"/
    // "no" nuevo la responde - sin importar si llegó como continuación
    // de la misma escucha o como una búsqueda nueva escrita/hablada
    // aparte (tocando "Buscar" de nuevo, por ejemplo). Antes, un "sí"
    // que no llegara EXACTAMENTE como respuesta de esa misma escucha se
    // trataba como una búsqueda nueva de "sí" a secas, y el agente
    // general (que no tiene ni idea de la sugerencia pendiente)
    // respondía cualquier cosa en vez de abrir el detalle.
    if (consulta?.sugerencia_bodega_id) {
      if (esAfirmacion(texto, ["ver"])) { verDetalle(consulta.sugerencia_bodega_id); return; }
      if (esNegacion(texto)) {
        setConsulta(null);
        setBusca("");
        const msg = "Listo, queda ahí. Puede seguir buscando cuando quiera.";
        setMsg(msg);
        hablar(msg);
        return;
      }
    }
    if (consulta?.bodegas?.length > 0) {
      const accion = _accionLocalDeResultado(texto);
      if (accion === "volver") { volverAlTablero(); return; }
      if (accion === "movimientos") { verMovimientos(); return; }
      if (accion === "receta") { verEnRecetas(); return; }
      if (accion === "reporte" && esAuditor) { generarReporteArticulo(); return; }
    }
    setBusca(texto);
    setMovimientos(null);
    setEnRecetas(null);
    const r = await pedir(
      `/api/articulos/consulta?q=${encodeURIComponent(texto)}&codigo=${codigo}`, {}, token);
    if (miId !== undefined && miId !== idEscuchaBusqueda.current) return;
    setConsulta(r);
    // Un solo buscador para todo: si ni fue un artículo ni una bodega,
    // el backend ya lo intentó como pregunta suelta o como orden de
    // navegar ("llévame a reportes", "abra kiosco taquilla ayb") - si
    // trae una acción, se seguía igual que hace AsistenteVoz.
    if (r.accion === "navegar" && r.destino && ir) {
      hablar(r.resumen);
      ir(r.destino, { tabInicial: r.pestana || undefined, bodegaSugerida: r.bodega || undefined });
      return;
    }
    // Si la búsqueda fue por voz y salió una bodega sugerida, no basta
    // con decir la sugerencia y dejarla ahí esperando un clic: se
    // pregunta y se escucha la respuesta, igual que ya hace Conteo al
    // confirmar una bodega - "tocar el botón" no debería ser la única
    // forma de seguir cuando se llegó hasta aquí hablando.
    if (miId !== undefined && r.sugerencia_bodega_id) {
      await hablar(`${r.resumen} Diga «sí» para ver el detalle.`);
      if (miId !== idEscuchaBusqueda.current) return;
      rec.current = escuchar({
        alTexto: (respuesta) => {
          if (miId !== idEscuchaBusqueda.current) return;
          if (esAfirmacion(respuesta, ["ver"])) {
            verDetalle(r.sugerencia_bodega_id);
          } else if (esNegacion(respuesta)) {
            const msg = "Listo, queda ahí. Puede seguir buscando cuando quiera.";
            setMsg(msg);
            hablar(msg);
          } else {
            setMsg("No le entendí un «sí» o un «no». Use el botón «Ver esta bodega».");
          }
        },
        alEstado: (e) => setEscuchando(e === "escuchando"),
        alError: setMsg,
      });
      return;
    }
    hablar(r.resumen);
  }
  function buscarPorVoz() {
    setMsg("");
    const miId = ++idEscuchaBusqueda.current;
    rec.current = escuchar({
      alTexto: (t) => {
        if (miId !== idEscuchaBusqueda.current) return;
        buscarArticulo("", t, miId);
      },
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

  async function solicitarBodegaNueva(nombre) {
    setPidiendoBodegaNueva(false);
    if (!nombre || !nombre.trim()) return;
    try {
      const r = await pedir("/api/bodegas/crear-pendiente", {
        method: "POST", body: JSON.stringify({ nombre }),
      }, token);
      setMsg(r.respuesta_hablada || "Solicitud enviada.");
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
  // solo bloquea la pantalla con "Cargando…" en la primera carga de un
  // detalle: si ya había uno (ej. reabrir() refrescando el mismo), se deja
  // ver el dato viejo mientras llega el nuevo, en vez de taparlo con un
  // aviso de carga que compite con el detalle todavía visible.
  const mostrarCargandoDetalle = cargandoDetalle && !detalle;

  return (
    <Marco titulo={consulta ? "Bodegas  ·  consulta de artículo" : detalle ? tituloDetalle : "Bodegas  ·  estado en vivo"}
           chip={consulta ? { texto: "BÚSQUEDA GLOBAL", tipo: "borde azul" }
                          : detalle ? { texto: chipDetalle[0], tipo: `borde ${chipDetalle[1]}` }
                          : { texto: "EN VIVO", tipo: "verde" }}>

      {mostrarCargandoDetalle && <p className="cargando">Cargando…</p>}

      {!detalle && !mostrarCargandoDetalle && (
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
                  onClick={buscarPorVoz} title="o pregunte por voz"><Icono nombre="microfono" tam={22} /></button>
        </div>
        {!consulta && (
          <>
            <p className="pista" style={{ marginTop: 8 }}>o pregunte por voz</p>
            <details style={{ marginTop: 4 }}>
              <summary className="pista" style={{ cursor: "pointer" }}>
                Ver frases exactas que entiende el agente aquí
              </summary>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {_ejemplosLista(esAuditor).map((ej, i) => (
                  <li key={i} className="pista" style={{ marginBottom: 4 }}>«{ej}»</li>
                ))}
              </ul>
            </details>
          </>
        )}

        {consulta && (
          <>
            <p className="rotulo" style={{ marginTop: 14 }}>CuentaVoz responde</p>
            <p className="burbuja">{consulta.resumen}</p>
            {consulta.sugerencia_bodega && (
              <div className="banner" style={{ marginTop: 10 }}>
                <span className="ico">💡</span>
                <span>
                  <b>{consulta.sugerencia_bodega}</b> es el nombre de una bodega, no de un artículo.
                  <span> Este buscador es para ingredientes — vea su detalle para
                        revisarla antes de abrirla.</span>
                </span>
                <button className="btn" style={{ flex: "none" }}
                        onClick={() => verDetalle(consulta.sugerencia_bodega_id)}>
                  Ver esta bodega
                </button>
              </div>
            )}
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
                   onKeyDown={(e) => e.key === "Enter" && confirmarBusquedaEnBodega(buscaArticuloBodega)}
                   placeholder="artículo en esta bodega, o pregúntele algo al agente…"
                   style={{ flex: 1, minWidth: 200, padding: "13px 14px", fontSize: "1rem",
                            border: "1px solid var(--borde)", borderRadius: 12 }} />
            <button className={`mic-btn ${escuchandoBodega ? "escuchando" : ""}`}
                    style={{ width: 46, height: 46, fontSize: "1.2rem" }}
                    onClick={buscarEnBodegaPorVoz} title="o pregunte por voz"><Icono nombre="microfono" tam={22} /></button>
          </div>
          <p className="pista" style={{ marginTop: 8, marginBottom: 4 }}>
            o pregunte por voz - si no es un artículo de esta bodega, se lo pregunta al agente
          </p>
          <details style={{ marginBottom: 14 }}>
            <summary className="pista" style={{ cursor: "pointer" }}>
              Ver frases exactas que entiende el agente aquí
            </summary>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {_ejemplosDetalle(esAuditor, detalle.estado).map((ej, i) => (
                <li key={i} className="pista" style={{ marginBottom: 4 }}>«{ej}»</li>
              ))}
            </ul>
          </details>
          {respuestaAgenteDetalle && (
            <>
              <p className="rotulo">CuentaVoz responde</p>
              <p className="burbuja" style={{ marginBottom: 14 }}>{respuestaAgenteDetalle.respuesta_hablada}</p>
            </>
          )}

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

          {articulosBodega && !respuestaAgenteDetalle && (
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
                    {_filtrarArticulosBodega(buscaArticuloBodega, articulosBodega).map((a) => (
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
            {(detalle.estado === "pendiente" || detalle.estado === "en_conteo") && (
              // Este detalle es solo de lectura (estado/historial) - para
              // de verdad contar hay que ir a Conteo. Sin este atajo,
              // alguien que llega aquí buscando "abrir la bodega" se
              // queda sin poder hacerlo y tiene que volver a decir/buscar
              // el nombre desde cero en otra pantalla.
              <button className="btn" onClick={() => ir && ir("conteo", { bodegaSugerida: detalle.bodega })}
                      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Icono nombre="conteo" tam={18} />
                {detalle.estado === "en_conteo" ? "Seguir contando" : "Contar esta bodega"}
              </button>
            )}
            {esAuditor && detalle.estado === "cerrada" && (
              <button className="btn borde" onClick={() => setPedirMotivo(true)}
                      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Icono nombre="candado" tam={18} />
                Reabrir la bodega
              </button>
            )}
            <button className="btn borde" onClick={verTodosLosArticulos}
                    style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Icono nombre="reportes" tam={18} />
              {articulosBodega ? "Ocultar artículos" : `Ver todos los artículos (${detalle.referencias})`}
            </button>
            {esAuditor && (
              <button className="btn borde" onClick={exportarDetalle}
                      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Icono nombre="descargar" tam={18} />
                Descargar detalle
              </button>
            )}
            {esAuditor && (
              <button className="btn" onClick={() => ir && ir("panel")}
                      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Icono nombre="panel" tam={18} />
                Ver en el panel gerencial
              </button>
            )}
            <button className="btn gris" onClick={() => { setDetalle(null); setDetalleId(null); }}
                    style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Icono nombre="salir" tam={18} />
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

      {!consulta && !detalle && !mostrarCargandoDetalle && lista === null && (
        <p className="cargando">Cargando…</p>
      )}

      {!consulta && !detalle && !mostrarCargandoDetalle && lista !== null && (
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

          {/* Arriba, junto a los filtros, y no al final de las 54 tarjetas -
              son acciones de la pantalla completa, no de una bodega en
              particular, así que no tiene sentido obligar a bajar todo el
              tablero para encontrarlas. */}
          <div className="grilla-botones" style={{ marginBottom: 16 }}>
            {esAuditor && (
              <button className="btn borde" onClick={exportarEstado}
                      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Icono nombre="descargar" tam={18} />
                Exportar estado
              </button>
            )}
            {esAuditor && (
              <button className="btn"
                      onClick={() => ir && ir("ajustes", { tabInicial: "usuarios" })}
                      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Icono nombre="perfil" tam={18} />
                Asignar personas a bodegas
              </button>
            )}
            {/* Sin esAuditor a proposito: quien suele topar con una bodega
                que no esta en el catalogo es el auxiliar en el terreno, no
                el administrador desde su escritorio. */}
            <button className="btn borde" onClick={() => setPidiendoBodegaNueva(true)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Icono nombre="bodegas" tam={18} />
              Bodega nueva
            </button>
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
        </>
      )}

      {pidiendoBodegaNueva && (
        <Dialogo titulo={esAuditor ? "Bodega nueva" : "Solicitar bodega nueva"}
                 mensaje={esAuditor
                   ? "Como administrador, la bodega entra directo al catálogo: no necesita otra aprobación."
                   : "Queda pendiente de aprobación: no entra al catálogo hasta que un administrador la confirme desde Auditoría → Aprobaciones."}
                 conCampo conVoz placeholder="nombre de la bodega"
                 textoAceptar={esAuditor ? "Crear" : "Solicitar"}
                 onAceptar={solicitarBodegaNueva}
                 onCancelar={() => setPidiendoBodegaNueva(false)} />
      )}

      {pedirMotivo && (
        <Dialogo titulo="Reabrir bodega cerrada"
                 mensaje="Esta acción exige una justificación escrita y queda registrada en el historial. Motivo:"
                 conCampo conVoz multilinea placeholder="revisión solicitada por el chef"
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
