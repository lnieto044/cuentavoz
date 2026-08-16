import { useEffect, useState } from "react";
import { pedir, descargarReporte } from "../api";
import Marco from "../Marco";
import AsistenteVoz from "../AsistenteVoz";
import Icono from "../Iconos";

const fmt = (n) => Number(n ?? 0).toLocaleString("es-CO", { maximumFractionDigits: 2 });

// "oro" es el modificador de clase (.chip.oro); la variable CSS real es
// --amarillo, no --oro - de ahi los dos mapas separados.
const CLASE_TITULO = {
  "Consolidado para My Inventory": "verde",
  "Diferencias por bodega": "oro",
  "Detalle de bodega": "azul",
  "Estado del tablero": "azul",
  "Análisis de consumo": "azul",
  "Registro de trazabilidad": "azul",
};
const VAR_TITULO = {
  "Consolidado para My Inventory": "verde",
  "Diferencias por bodega": "amarillo",
  "Detalle de bodega": "azul",
  "Estado del tablero": "azul",
  "Análisis de consumo": "azul",
  "Registro de trazabilidad": "azul",
};
const ICONO_TITULO = {
  "Consolidado para My Inventory": "📊",
  "Diferencias por bodega": "⚖️",
  "Detalle de bodega": "🏬",
  "Estado del tablero": "📋",
  "Análisis de consumo": "📈",
  "Registro de trazabilidad": "🕘",
};

// Ejemplos de lo que ya entiende el agente en esta pantalla: generar los
// tres tipos de archivo, ver el contenido de uno ya generado, y preguntar
// por lo que muestra el análisis de consumo.
const _EJEMPLOS_REPORTES = [
  "genera el consolidado", "exporta las diferencias", "exporta el análisis de consumo",
  "muéstrame el archivo de diferencias", "muéstrame el archivo del estado del tablero",
  "consolidado de la toma", "análisis de consumo",
  "¿cuántas filas tiene el último consolidado?", "¿cuántas bodegas tienen descuadre?",
  "¿qué archivos se han generado?", "¿cuánto se pidió en el período?",
  "¿cuánto se usó realmente?", "¿cuál es el ahorro potencial?",
  "¿cuántos insumos están subutilizados?", "¿cuál insumo tiene más sobrepedido?",
];

export default function Reportes({ token, usuario, ir, tabInicial, navSeq, archivoPrevisualizar }) {
  const [tab, setTab] = useState(tabInicial || "consolidado");
  // Pedir una pestaña de esta MISMA pantalla por voz no remonta el
  // componente - sin esto, el useState de arriba no vuelve a leer
  // tabInicial y la pestaña se queda en la que ya estaba. navSeq (sube en
  // cada ir()) va en la dependencia también: sin él, pedir la MISMA
  // pestaña dos veces seguidas (con un clic manual a otra en el medio)
  // no hacía nada, porque tabInicial no cambiaba de valor.
  useEffect(() => { if (tabInicial) setTab(tabInicial); }, [tabInicial, navSeq]);

  return (
    <Marco titulo={tab === "consolidado" ? "Reportes  ·  consolidado de la toma"
                                        : "Reportes  ·  análisis de consumo"}
           chip={tab === "consolidado" ? { texto: "ARCHIVOS", tipo: "borde azul" }
                                       : { texto: "ÚLTIMOS 30 DÍAS", tipo: "borde azul" }}>
      <AsistenteVoz token={token} vista="reportes" ir={ir} ejemplos={_EJEMPLOS_REPORTES}
                    placeholder="¿cuántas filas tiene el último consolidado?, lléveme al panel…"
                    alActualizar={() => window.dispatchEvent(new Event("cuentavoz:reportes-actualizados"))} />
      <div className="chips">
        <button className={`chip ${tab === "consolidado" ? "azul" : ""}`}
                onClick={() => setTab("consolidado")}>Consolidado de la toma</button>
        <button className={`chip ${tab === "analisis" ? "azul" : ""}`}
                onClick={() => setTab("analisis")}>Análisis de consumo</button>
      </div>

      {tab === "consolidado"
        ? <TabConsolidado token={token} usuario={usuario}
                          navSeq={navSeq} archivoPrevisualizar={archivoPrevisualizar} />
        : <TabAnalisis token={token} usuario={usuario} />}
    </Marco>
  );
}

/** Tabla genérica: cada tipo de reporte (consolidado, diferencias, estado,
    detalle de bodega) trae sus propias columnas, asi que en vez de mapear
    columnas fijas se dibujan las que de verdad trae el archivo. */
function TablaVistaPrevia({ filas }) {
  if (!filas || filas.length === 0) return <p className="vacio">Este archivo no tiene filas.</p>;
  const columnas = Object.keys(filas[0]);
  return (
    <div className="tabla-scroll">
    <table>
      <thead><tr>{columnas.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>
        {filas.map((f, i) => (
          <tr key={i}>
            {columnas.map((c) => (
              <td key={c} className={c === "Diferencia" ? "dif" : ""}>
                {c === "Diferencia" && f[c] > 0 ? `+${f[c]}` : String(f[c])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

/* ── Consolidado de la toma ── */
function TabConsolidado({ token, navSeq, archivoPrevisualizar }) {
  const [recientes, setRecientes] = useState(null);
  const [archivoActivo, setArchivoActivo] = useState(null);   // {archivo, titulo}
  const [filasPrevia, setFilasPrevia] = useState(null);
  const [totalFilas, setTotalFilas] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  function cargar() {
    pedir("/api/reportes/recientes", {}, token).then(setRecientes).catch(() => setRecientes([]));
  }
  useEffect(cargar, [token]);
  // Generar un archivo por voz pasa por el backend directo, no por
  // generarConsolidado/generarDiferencias de aquí abajo - sin escuchar
  // este evento la lista de "Archivos generados" se quedaba vieja hasta
  // que se recargaba la página a mano.
  useEffect(() => {
    window.addEventListener("cuentavoz:reportes-actualizados", cargar);
    return () => window.removeEventListener("cuentavoz:reportes-actualizados", cargar);
  }, [token]);

  async function previsualizar(archivo, titulo) {
    setErr("");
    try {
      const d = await pedir(`/api/reportes/vista-previa?archivo=${encodeURIComponent(archivo)}`, {}, token);
      setArchivoActivo({ archivo, titulo });
      setFilasPrevia(d.filas);
      setTotalFilas(d.total);
    } catch (e) { setErr(e.message); }
  }
  // "Muéstrame el archivo de diferencias" - lo mismo que darle clic a la
  // tarjeta, pero pedido por voz; el backend ya resolvió CUÁL archivo es.
  // Va por prop (como bodegaSugerida en Conteo), no por evento: si el
  // pedido llegó desde OTRA pestaña de Reportes, este componente todavía
  // no estaba montado cuando AsistenteVoz disparaba el evento viejo, así
  // que la vista previa nunca aparecía. navSeq en las dependencias por la
  // misma razón que en el resto de la app: pedir el MISMO archivo dos
  // veces seguidas (con un clic manual a otro en el medio) no cambia el
  // valor de archivoPrevisualizar por sí solo.
  useEffect(() => {
    if (archivoPrevisualizar?.archivo) {
      previsualizar(archivoPrevisualizar.archivo, archivoPrevisualizar.titulo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archivoPrevisualizar, navSeq]);

  async function generarConsolidado(formato) {
    setErr(""); setMsg("");
    try {
      const d = await pedir(`/api/reportes?formato=${formato}`, { method: "POST" }, token);
      setArchivoActivo({ archivo: d.archivo, titulo: "Consolidado para My Inventory" });
      setFilasPrevia(d.vista_previa || null);
      setTotalFilas(d.filas);
      setMsg(`Consolidado generado: ${d.filas} filas.`);
      cargar();
    } catch (e) { setErr(e.message); }
  }
  async function generarDiferencias(formato) {
    setErr(""); setMsg("");
    try {
      const d = await pedir(`/api/reportes/diferencias?formato=${formato}`, { method: "POST" }, token);
      setMsg(`Diferencias exportadas: ${d.filas} filas en ${d.bodegas_con_descuadre} bodegas.`);
      cargar();
      await previsualizar(d.archivo, "Diferencias por bodega");
    } catch (e) { setErr(e.message); }
  }

  return (
    <div className="reportes-cols">
      <div className="card">
        <h3>Archivos generados con los códigos oficiales de la base</h3>
        {/* Arriba, junto al título, y no al final de la lista - con muchos
            archivos generados en el día, quedaban fuera de la vista sin
            bajar todo el scroll, y nada indicaba que seguían ahí. */}
        <div className="grilla-botones" style={{ marginTop: 0, marginBottom: 14 }}>
          <button className="btn" onClick={() => generarConsolidado("xlsx")}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icono nombre="reportes" tam={16} />
            Generar consolidado
          </button>
          <button className="btn" onClick={() => generarDiferencias("xlsx")}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icono nombre="reportes" tam={16} />
            Generar diferencias
          </button>
          <button className="btn gris" onClick={() => window.print()}>Imprimir</button>
        </div>
        {msg && <p className="msg-ok">{msg}</p>}
        {err && <p className="error">{err}</p>}
        {recientes === null ? (
          <p className="cargando">Cargando…</p>
        ) : recientes.length === 0 ? (
          <p className="vacio">Todavía no se ha generado ningún archivo.</p>
        ) : (
          recientes.map((a, i) => {
            const clase = CLASE_TITULO[a.titulo] || "azul";
            const colorVar = clase === "oro" ? "var(--amarillo-tx)" : `var(--${VAR_TITULO[a.titulo] || "azul"})`;
            const activo = archivoActivo?.archivo === a.archivo;
            return (
            <div key={i} onClick={() => previsualizar(a.archivo, a.titulo)}
                 style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              borderTop: activo ? "1px solid var(--azul)" : "1px solid var(--borde)",
              borderRight: activo ? "1px solid var(--azul)" : "1px solid var(--borde)",
              borderBottom: activo ? "1px solid var(--azul)" : "1px solid var(--borde)",
              borderLeft: `4px solid var(--${VAR_TITULO[a.titulo] || "azul"})`,
              borderRadius: 10, padding: "12px 14px", marginBottom: 10,
              cursor: "pointer", background: activo ? "var(--azul-claro)" : "transparent",
            }}>
              <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="icono-kpi" style={{ fontSize: "1.1rem" }}>
                  {ICONO_TITULO[a.titulo] || "📄"}
                </span>
                <span>
                  <b style={{ color: colorVar }}>{a.titulo}</b>
                  <br />
                  <small style={{ color: "var(--grafito)" }}>
                    {a.formato} · hoy {a.hora}{a.filas != null ? ` · ${a.filas} filas` : ""}
                  </small>
                </span>
              </span>
              <span className={`chip ${clase}`}>{a.subtitulo}</span>
            </div>
            );
          })
        )}
        <p className="pista" style={{ marginTop: 10 }}>
          Dele clic a cualquier tarjeta para ver su contenido aquí al lado.
        </p>
      </div>

      <div className="card">
        <h3>{archivoActivo ? `Vista previa · ${archivoActivo.titulo}` : "Vista previa del consolidado"}</h3>
        {filasPrevia === null ? (
          <p className="vacio">Genere un archivo o dele clic a uno ya generado para ver una muestra aquí.</p>
        ) : (
          <>
            <TablaVistaPrevia filas={filasPrevia} />
            <p className="pista" style={{ marginTop: 10 }}>
              {totalFilas != null && `Mostrando ${Math.min(8, totalFilas)} de ${totalFilas} filas. `}
              Los códigos SIN-#### corresponden a registros del extracto que llegaron sin número de artículo.
            </p>
            <div className="grilla-botones">
              <button className="btn verde"
                      onClick={() => descargarReporte(archivoActivo.archivo, token).catch((e) => setErr(e.message))}
                      style={{ display: "inline-flex", alignItems: "center", gap: 8, width: "100%",
                               justifyContent: "center" }}>
                <Icono nombre="descargar" tam={18} />
                Descargar este archivo
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Análisis de consumo ── */
function TabAnalisis({ token }) {
  const [analisis, setAnalisis] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  function cargar() {
    pedir("/api/analisis/consumo?dias=30", {}, token).then(setAnalisis).catch((e) => setErr(e.message));
  }
  useEffect(cargar, [token]);
  useEffect(() => {
    window.addEventListener("cuentavoz:reportes-actualizados", cargar);
    return () => window.removeEventListener("cuentavoz:reportes-actualizados", cargar);
  }, [token]);

  async function exportar() {
    setErr(""); setMsg("");
    try {
      const d = await pedir("/api/analisis/exportar?formato=xlsx&dias=30", { method: "POST" }, token);
      await descargarReporte(d.archivo, token);
      setMsg("Análisis exportado y descargado.");
    } catch (e) { setErr(e.message); }
  }
  // "Exporta el análisis de consumo" por voz ya creó el archivo en el
  // servidor (el backend respondió con accion:"descargar_reporte" y el
  // nombre del archivo) - falta el mismo paso que hace el botón: bajarlo
  // de verdad al dispositivo.
  useEffect(() => {
    async function alDescargarPorVoz(e) {
      if (!e.detail?.archivo) return;
      setErr(""); setMsg("");
      try {
        await descargarReporte(e.detail.archivo, token);
        setMsg("Análisis exportado y descargado.");
      } catch (err) { setErr(err.message); }
    }
    window.addEventListener("cuentavoz:accion:descargar_reporte", alDescargarPorVoz);
    return () => window.removeEventListener("cuentavoz:accion:descargar_reporte", alDescargarPorVoz);
  }, [token]);

  if (err) return <p className="error">{err}</p>;
  if (!analisis) return <p className="cargando">Cargando…</p>;

  const recomendacion = analisis.subutilizados[0];
  const maxSobrepedido = Math.max(1, ...analisis.subutilizados.map((s) => s.sobrepedido_pct));

  return (
    <>
      {msg && <p className="msg-ok">{msg}</p>}
      <div className="kpis">
        <div className="kpi">
          <div className="kpi-cabeza"><span className="icono-kpi">📦</span><small>Pedido en el período</small></div>
          <b>{fmt(analisis.pedido_total)} kg</b>
          <i>en {analisis.servicios_periodo} servicios</i>
        </div>
        <div className="kpi">
          <div className="kpi-cabeza"><span className="icono-kpi">🍽️</span><small>Usado realmente</small></div>
          <b>{fmt(analisis.usado_total)} kg</b>
          <i>{analisis.aprovechamiento} % de lo pedido</i>
        </div>
        <div className="kpi oro">
          <div className="kpi-cabeza"><span className="icono-kpi">⚠️</span><small>Insumos subutilizados</small></div>
          <b>{analisis.subutilizados.length}</b>
          <i>se piden y no se usan</i>
        </div>
        <div className="kpi verde">
          <div className="kpi-cabeza"><span className="icono-kpi">💰</span><small>Ahorro potencial</small></div>
          <b>{fmt(analisis.ahorro_potencial)} kg</b>
          <i>al mes si se ajusta</i>
        </div>
      </div>

      {analisis.subutilizados.length === 0 ? (
        <div className="card">
          <p className="vacio">
            Sin servicios legalizados en los últimos {analisis.dias} días: legalice uno para ver el análisis.
          </p>
        </div>
      ) : (
        <div className="reportes-cols">
          <div className="card">
            <h3>📉 Sobrepedido frente a la receta</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {analisis.subutilizados.slice(0, 6).map((s) => (
                <div key={s.nombre} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 130, fontSize: ".83rem" }}>{s.nombre}</span>
                  <div style={{ flex: 1, background: "var(--fondo)", borderRadius: 6, height: 16 }}>
                    <div style={{ width: `${s.sobrepedido_pct / maxSobrepedido * 100}%`, height: 16,
                                  background: s.sobrepedido_pct >= 30 ? "var(--amarillo)" : "var(--azul)",
                                  borderRadius: 6 }} />
                  </div>
                  <b style={{ width: 34, textAlign: "right", fontSize: ".83rem" }}>{s.sobrepedido_pct}</b>
                </div>
              ))}
            </div>
            <p className="pista" style={{ marginTop: 10 }}>% por encima de lo que pide la receta.</p>
          </div>

          <div className="card">
            <h3>🧺 Insumos subutilizados: se piden y sobran</h3>
            {analisis.subutilizados.slice(0, 6).map((s) => (
              <div key={s.nombre} className="registro">
                <span style={{ textTransform: "capitalize" }}>{s.nombre.toLowerCase()}</span>
                <span className="cant">{fmt(s.sobra)} kg sin usar</span>
                <span className="chip oro">{s.veces} de {analisis.servicios_periodo} servicios</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {recomendacion && (
        <div className="card">
          <h3>🤖 Recomendación automática del agente</h3>
          <p className="burbuja">
            {recomendacion.nombre.toLowerCase()} sobra en {recomendacion.veces} de los servicios
            legalizados: la receta pide {recomendacion.sobrepedido_pct}% más de lo que en promedio
            se usa. Ajustar la receta liberaría {fmt(recomendacion.sobra)} kg al mes. La decisión
            es del chef: el agente solo muestra el patrón.
          </p>
          <div className="grilla-botones">
            <button className="btn verde" onClick={exportar}
                    style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Icono nombre="descargar" tam={18} />
              Exportar análisis
            </button>
          </div>
        </div>
      )}
    </>
  );
}
