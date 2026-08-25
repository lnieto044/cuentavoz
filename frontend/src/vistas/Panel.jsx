import { useEffect, useRef, useState } from "react";
import { pedir } from "../api";
import { hablar } from "../voz";
import Marco from "../Marco";
import AsistenteVoz from "../AsistenteVoz";

const SERIE = ["var(--serie-1)", "var(--serie-2)", "var(--serie-3)", "var(--serie-4)"];
const COLOR_UNIDAD = { Unidad: "var(--azul)", Kilogram: "var(--amarillo)",
                        Liter: "var(--verde)", Portion: "#C3CAD6" };
const ESTADO_COLOR = { cerrada: "var(--verde)", en_conteo: "var(--azul)",
                        en_auditoria: "var(--amarillo)", pendiente: "#C3CAD6" };
const ESTADO_ETQ = { cerrada: "Cerrada", en_conteo: "Conteo",
                      en_auditoria: "En auditoría", pendiente: "Pendiente" };

// Nombre oficial de bodega (como en el catálogo) -> version corta para
// que quepa en el eje del gráfico. Solo cambia como se muestra, el
// nombre real que se manda al backend sigue siendo el oficial.
const PREFIJOS_CORTOS = { RESTAURANTE: "Rest.", ALMACEN: "Almacén",
                           ZOOLOGICO: "Zoológico", KIOSCO: "Kiosco" };
function nombreCorto(nombre) {
  return (nombre || "").split(" ").map((p, i) => {
    if (i === 0 && PREFIJOS_CORTOS[p]) return PREFIJOS_CORTOS[p];
    if (p === "AYB") return "AyB";
    return p.charAt(0) + p.slice(1).toLowerCase();
  }).join(" ");
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mesCorto = (fechaISO) => MESES[Number(fechaISO.slice(5, 7)) - 1];

// Ejemplos de lo que ya entiende el agente en esta pantalla: navegar entre
// las dos pestañas y preguntar por lo que muestra cada tarjeta o gráfica.
const _EJEMPLOS_PANEL = [
  "resumen ejecutivo", "bodegas y alertas", "llévame a bodegas y alertas",
  "¿cuál es la exactitud primera pasada?", "¿cuántas referencias se han contado?",
  "¿cuántas alertas se han gestionado?", "¿cuántas bodegas están cerradas?",
  "¿qué bodega tiene más diferencia?", "¿cómo va el stock por unidad de medida?",
  "¿cómo va la tendencia de exactitud?", "¿cuántos negativos se han corregido?",
  "¿cuál es el tiempo promedio de conteo?", "¿cuántos alias aprendió el agente?",
  "¿cómo están las bodegas?", "¿cuáles son las alertas por tipo?",
  "¿cuál es el descuadre principal?",
];

export default function Panel({ token, ir, tabInicial, navSeq }) {
  const [tab, setTab] = useState(tabInicial || "resumen");
  // Pedir una pestaña de esta MISMA pantalla por voz no remonta el
  // componente - sin esto, el useState de arriba no vuelve a leer
  // tabInicial y la pestaña se queda en la que ya estaba. navSeq (sube en
  // cada ir()) tiene que ir en la dependencia también: sin él, pedir la
  // MISMA pestaña dos veces seguidas (con un clic manual a otra en el
  // medio) no hacía nada, porque tabInicial ya traía ese mismo valor de
  // la vez anterior y el efecto no vuelve a correr si su dependencia no
  // cambió de valor.
  useEffect(() => { if (tabInicial) setTab(tabInicial); }, [tabInicial, navSeq]);
  const [resumen, setResumen] = useState(null);
  const [alertas, setAlertas] = useState(null);

  useEffect(() => {
    pedir("/api/panel/resumen", {}, token).then(setResumen).catch(() => {});
    pedir("/api/panel/alertas", {}, token).then(setAlertas).catch(() => {});
  }, [token]);

  return (
    <Marco titulo="Panel gerencial" chip={{ texto: "ACTUALIZADO AHORA", tipo: "verde" }}>
      <AsistenteVoz token={token} vista="panel" ir={ir} ejemplos={_EJEMPLOS_PANEL}
                    placeholder="¿cuál es la exactitud primera pasada?, lléveme a inicio…" />
      <div className="chips">
        <button className={`chip ${tab === "resumen" ? "azul" : ""}`}
                onClick={() => setTab("resumen")}>Resumen ejecutivo</button>
        <button className={`chip ${tab === "alertas" ? "azul" : ""}`}
                onClick={() => setTab("alertas")}>Bodegas y alertas</button>
      </div>

      {tab === "resumen" && <TabResumen r={resumen} />}
      {tab === "alertas" && <TabAlertas a={alertas} />}
    </Marco>
  );
}

function TabResumen({ r }) {
  const [saludo, setSaludo] = useState("");
  const yaSaludo = useRef(false);

  // Al llegar a esta pestaña, un titular breve en vez de esperar a que
  // pregunten - el detalle completo de cada tarjeta/gráfica sigue
  // disponible por voz (o en el desplegable de frases), esto es solo el
  // resumen de resumen para no leer las cuatro tarjetas de una sentada.
  useEffect(() => {
    if (!r || yaSaludo.current) return;
    yaSaludo.current = true;
    const texto = `Resumen ejecutivo: exactitud primera pasada ${r.exactitud_primera_pasada}%, `
                + `${r.alertas_gestionadas} de ${r.alertas_total} alertas gestionadas, `
                + `${r.bodegas_cerradas} de ${r.bodegas_total} bodegas cerradas.`;
    setSaludo(texto);
    hablar(texto);
  }, [r]);

  if (!r) return <p className="cargando">Cargando…</p>;
  const maxDif = Math.max(1, ...r.diferencia_por_bodega.map((d) => d.diferencia));

  return (
    <>
      {saludo && (
        <div className="card">
          <p className="rotulo" style={{ marginTop: 0 }}>CuentaVoz responde</p>
          <p className="burbuja" aria-live="polite" aria-atomic="true">{saludo}</p>
        </div>
      )}
      <div className="kpis">
        <div className="kpi verde">
          <div className="kpi-cabeza">
            <span className="icono-kpi">🎯</span>
            <small>Exactitud primera pasada</small>
          </div>
          <b>{r.exactitud_primera_pasada} %</b><i>promedio de cierres</i></div>
        <div className="kpi">
          <div className="kpi-cabeza">
            <span className="icono-kpi">📦</span>
            <small>Referencias contadas</small>
          </div>
          <b>{r.referencias_contadas}</b><i>en toda la operación</i></div>
        <div className="kpi oro">
          <div className="kpi-cabeza">
            <span className="icono-kpi">⚠️</span>
            <small>Alertas gestionadas</small>
          </div>
          <b>{r.alertas_gestionadas} / {r.alertas_total}</b><i>resueltas del total</i></div>
        <div className="kpi">
          <div className="kpi-cabeza">
            <span className="icono-kpi">🔒</span>
            <small>Bodegas cerradas</small>
          </div>
          <b>{r.bodegas_cerradas} / {r.bodegas_total}</b><i>con doble firma digital</i></div>
      </div>

      <div className="conteo-cols">
        <div className="card">
          <h2>Diferencia absoluta por bodega</h2>
          {r.diferencia_por_bodega.length === 0 ? (
            <p className="vacio">Sin diferencias registradas todavía.</p>
          ) : (
            r.diferencia_por_bodega.map((d, i) => (
              <div className="barra-fila" key={d.bodega}>
                <span className="etq">{nombreCorto(d.bodega)}</span>
                <div className="pista">
                  <div className="rellena" style={{ width: `${d.diferencia / maxDif * 100}%`,
                                                     background: i === 0 ? "var(--amarillo)" : "var(--serie-1)" }} />
                </div>
                <span className="val">{d.diferencia}</span>
              </div>
            ))
          )}
        </div>
        <div className="card">
          <h2>Stock por unidad de medida</h2>
          <Dona datos={r.stock_por_unidad.map((u, i) => ({
            etq: u.unidad, valor: u.cantidad, pct: u.pct,
            color: COLOR_UNIDAD[u.unidad] || SERIE[i % SERIE.length],
          }))} />
        </div>
      </div>

      <div className="card">
        <h2>Exactitud por toma de inventario</h2>
        {r.historial_exactitud.length < 2 ? (
          <p className="vacio">Se necesitan al menos dos cierres para ver la tendencia.</p>
        ) : (
          <Linea puntos={r.historial_exactitud} />
        )}
        <p className="pista" style={{ marginTop: 8 }}>
          Un punto por cada bodega cerrada con doble firma, en orden cronológico.
        </p>
      </div>
    </>
  );
}

function TabAlertas({ a }) {
  const [saludo, setSaludo] = useState("");
  const yaSaludo = useRef(false);

  useEffect(() => {
    if (!a || yaSaludo.current) return;
    yaSaludo.current = true;
    const texto = a.negativos_iniciales !== a.negativos_actuales
      ? `Bodegas y alertas: saldos negativos, ${a.negativos_iniciales} al inicio del período, `
        + `${a.negativos_actuales} ahora. Tiempo promedio de conteo ${a.tiempo_promedio_min} minutos.`
      : `Bodegas y alertas: ${a.negativos_actuales} saldos negativos en el sistema, se corrigen `
        + `en My Inventory. Tiempo promedio de conteo ${a.tiempo_promedio_min} minutos.`;
    setSaludo(texto);
    hablar(texto);
  }, [a]);

  if (!a) return <p className="cargando">Cargando…</p>;
  const estados = Object.entries(a.estado_bodegas);
  const maxAlerta = Math.max(1, ...a.alertas_por_tipo.map((x) => x.cantidad));

  return (
    <>
      {saludo && (
        <div className="card">
          <p className="rotulo" style={{ marginTop: 0 }}>CuentaVoz responde</p>
          <p className="burbuja" aria-live="polite" aria-atomic="true">{saludo}</p>
        </div>
      )}
      <div className="kpis">
        <div className="kpi oro">
          <div className="kpi-cabeza">
            <span className="icono-kpi">📉</span>
            <small>Saldos negativos en el sistema</small>
          </div>
          {/* La corrección de un saldo negativo pasa por fuera de
              CuentaVoz (My Inventory, no esta app) - dentro de UNA sola
              toma este número no se mueve solo, así que la flecha
              "antes → ahora" solo se muestra si de verdad hay una
              diferencia real que contar; mostrarla igualada a sí misma
              ("79 → 79") no cuenta nada y parece un dato inventado. */}
          {a.negativos_iniciales !== a.negativos_actuales ? (
            <>
              <b>{a.negativos_iniciales} → {a.negativos_actuales}</b>
              <i>corregidos desde el inicio de este período</i>
            </>
          ) : (
            <>
              <b>{a.negativos_actuales}</b>
              <i>artículos - la corrección se hace en My Inventory</i>
            </>
          )}
        </div>
        <div className="kpi">
          <div className="kpi-cabeza">
            <span className="icono-kpi">⏱️</span>
            <small>Tiempo promedio de conteo por bodega</small>
          </div>
          <b>{a.tiempo_promedio_min ?? "—"} min</b><i>conteos ya cerrados</i></div>
        <div className="kpi verde">
          <div className="kpi-cabeza">
            <span className="icono-kpi">🗣️</span>
            <small>Alias aprendidos por el agente</small>
          </div>
          <b>{a.alias_aprendidos}</b><i>el agente habla como el equipo</i></div>
      </div>

      <div className="dos-columnas">
        <div className="card">
          <h2>Estado de las bodegas</h2>
          <div className="puntos-bodegas">
            {estados.flatMap(([estado, n]) =>
              Array.from({ length: n }, (_, i) => (
                <span key={`${estado}-${i}`} style={{ background: ESTADO_COLOR[estado] }}
                      title={ESTADO_ETQ[estado]} />
              ))
            )}
          </div>
          <div className="leyenda">
            {estados.map(([estado, n]) => (
              <span key={estado}>
                <span className="punto" style={{ background: ESTADO_COLOR[estado] }} />
                {ESTADO_ETQ[estado]} · {n}
              </span>
            ))}
          </div>
        </div>

        <div className="card">
          <h2>Alertas por tipo</h2>
          {a.alertas_por_tipo.length === 0 ? (
            <p className="vacio">Sin alertas registradas todavía.</p>
          ) : (
            a.alertas_por_tipo.map((x, i) => (
              <div className="barra-fila" key={x.tipo}>
                <span className="etq">{x.tipo}</span>
                <div className="pista">
                  <div className="rellena" style={{ width: `${x.cantidad / maxAlerta * 100}%`,
                                                     background: i === 0 ? "var(--amarillo)" : "var(--serie-1)" }} />
                </div>
                <span className="val">{x.cantidad}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card">
        <h2>Descuadres recurrentes: dónde está la causa raíz</h2>
        {a.descuadres_recurrentes.length === 0 ? (
          <p className="vacio">Sin descuadres repetidos todavía.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Artículo</th><th>Tipo de alerta</th><th>Dif. acumulada</th>
                  <th>Tomas</th><th>Acción sugerida</th></tr>
            </thead>
            <tbody>
              {a.descuadres_recurrentes.map((d, i) => (
                <tr key={i}>
                  <td>{d.articulo}</td><td>{d.tipo}</td>
                  <td className="dif">{d.diferencia}</td><td>{d.tomas}</td>
                  <td>{d.accion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/** Dona hecha con conic-gradient: sin librerías, con leyenda etiquetada. */
function Dona({ datos }) {
  if (!datos.length) return <p className="vacio">Sin datos de stock todavía.</p>;
  let acumulado = 0;
  const segmentos = datos.map((d) => {
    const inicio = acumulado;
    acumulado += d.pct;
    return `${d.color} ${inicio}% ${acumulado}%`;
  });
  const total = datos.reduce((s, d) => s + d.valor, 0);
  return (
    <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ position: "relative", width: 140, height: 140, flex: "none" }}>
        <div style={{
          width: 140, height: 140, borderRadius: "50%",
          background: `conic-gradient(${segmentos.join(",")})`,
        }} />
        <div style={{
          position: "absolute", inset: 22, borderRadius: "50%", background: "#fff",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          boxShadow: "0 0 0 1px rgba(11,27,51,.04)",
        }}>
          <b style={{ fontSize: "1.05rem", color: "var(--azul)" }}>
            {total.toLocaleString("es-CO")}
          </b>
          <span style={{ fontSize: ".68rem", color: "var(--grafito)" }}>referencias</span>
        </div>
      </div>
      <div>
        {datos.map((d) => (
          <div key={d.etq} style={{ marginBottom: 6, fontSize: ".85rem" }}>
            <span className="punto" style={{ background: d.color, display: "inline-block",
                  width: 10, height: 10, borderRadius: "50%", marginRight: 8 }} />
            <b>{d.etq}</b> — {d.pct}% ({d.valor.toLocaleString("es-CO")})
          </div>
        ))}
      </div>
    </div>
  );
}

/** Línea de tendencia con SVG puro: una sola serie, sin leyenda. Como
    todos los cierres pueden caer el mismo dia, el eje muestra la bodega
    de cada punto (ya es informacion real y distinta punto a punto) en
    vez de repetir el mismo mes una y otra vez. */
function Linea({ puntos }) {
  const w = 460, h = 128, pad = 20, padInferior = 34;
  const valores = puntos.map((p) => p.exactitud);
  const min = Math.min(...valores) - 2, max = Math.max(...valores) + 2;
  const paso = (w - pad * 2) / (puntos.length - 1);
  const y = (v) => h - padInferior - ((v - min) / (max - min || 1)) * (h - pad - padInferior);
  const coords = puntos.map((p, i) => [pad + i * paso, y(p.exactitud)]);
  const linea = coords.map(([x, yy], i) => `${i === 0 ? "M" : "L"}${x},${yy}`).join(" ");

  const mejora = valores[valores.length - 1] >= valores[0];
  const color = "var(--serie-1)";

  return (
    <>
      {puntos.length > 1 && (
        <p style={{ textAlign: "right", fontSize: ".78rem", fontWeight: 700,
                    color: mejora ? "var(--verde)" : "var(--grafito)", marginBottom: 4 }}>
          {mejora ? "▲ mejora sostenida" : "▼ en descenso"}
        </p>
      )}
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Tendencia de exactitud">
        <line x1={pad} y1={h - padInferior} x2={w - pad} y2={h - padInferior} stroke="var(--borde)" strokeWidth="1" />
        <path d={linea} fill="none" stroke={color} strokeWidth="2" />
        {coords.map(([x, yy], i) => (
          <circle key={i} cx={x} cy={yy} r="3.5" fill={color} />
        ))}
        {puntos.map((p, i) => (
          <text key={i} x={coords[i][0]} y={h - padInferior + 11} fontSize="6.5" textAnchor="end"
                fill="var(--grafito)" transform={`rotate(-40 ${coords[i][0]} ${h - padInferior + 11})`}>
            <title>{nombreCorto(p.bodega)}</title>
            {`Toma ${i + 1}`}
          </text>
        ))}
        <text x={coords[coords.length - 1][0]} y={coords[coords.length - 1][1] - 10}
              fontSize="11" fontWeight="700" textAnchor="middle" fill={color}>
          {valores[valores.length - 1]}%
        </text>
      </svg>
    </>
  );
}
