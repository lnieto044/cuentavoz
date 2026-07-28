import { useEffect, useState } from "react";
import { pedir } from "../api";
import Marco from "../Marco";

const SERIE = ["var(--serie-1)", "var(--serie-2)", "var(--serie-3)", "var(--serie-4)"];
const ESTADO_COLOR = { cerrada: "var(--verde)", en_conteo: "var(--azul)",
                        en_auditoria: "var(--amarillo)", pendiente: "#C3CAD6" };
const ESTADO_ETQ = { cerrada: "Cerrada", en_conteo: "En conteo",
                      en_auditoria: "En auditoría", pendiente: "Pendiente" };

export default function Panel({ token }) {
  const [tab, setTab] = useState("resumen");
  const [resumen, setResumen] = useState(null);
  const [alertas, setAlertas] = useState(null);
  const urlPBI = import.meta.env.VITE_POWERBI_URL;

  useEffect(() => {
    pedir("/api/panel/resumen", {}, token).then(setResumen).catch(() => {});
    pedir("/api/panel/alertas", {}, token).then(setAlertas).catch(() => {});
  }, [token]);

  return (
    <Marco titulo="Panel gerencial" chip={{ texto: "ACTUALIZADO AHORA", tipo: "verde" }}>
      <div className="chips">
        <button className={`chip ${tab === "resumen" ? "azul" : ""}`}
                onClick={() => setTab("resumen")}>Resumen ejecutivo</button>
        <button className={`chip ${tab === "alertas" ? "azul" : ""}`}
                onClick={() => setTab("alertas")}>Bodegas y alertas</button>
        {urlPBI && <span className="chip oro" style={{ marginLeft: "auto" }}>Power BI</span>}
      </div>

      {tab === "resumen" && <TabResumen r={resumen} urlPBI={urlPBI} />}
      {tab === "alertas" && <TabAlertas a={alertas} />}
    </Marco>
  );
}

function TabResumen({ r, urlPBI }) {
  if (!r) return <p className="cargando">Cargando…</p>;
  const maxDif = Math.max(1, ...r.diferencia_por_bodega.map((d) => d.diferencia));

  return (
    <>
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

      <div className="card">
        <h3>Diferencia absoluta por bodega</h3>
        {r.diferencia_por_bodega.length === 0 ? (
          <p className="vacio">Sin diferencias registradas todavía.</p>
        ) : (
          r.diferencia_por_bodega.map((d) => (
            <div className="barra-fila" key={d.bodega}>
              <span className="etq">{d.bodega}</span>
              <div className="pista">
                <div className="rellena" style={{ width: `${d.diferencia / maxDif * 100}%`,
                                                   background: "var(--serie-1)" }} />
              </div>
              <span className="val">{d.diferencia}</span>
            </div>
          ))
        )}
      </div>

      <div className="conteo-cols">
        <div className="card">
          <h3>Stock por unidad de medida</h3>
          <Dona datos={r.stock_por_unidad.map((u, i) => ({
            etq: u.unidad, valor: u.cantidad, pct: u.pct, color: SERIE[i % SERIE.length],
          }))} />
        </div>
        <div className="card">
          <h3>Exactitud por toma de inventario</h3>
          {r.historial_exactitud.length < 2 ? (
            <p className="vacio">Se necesitan al menos dos cierres para ver la tendencia.</p>
          ) : (
            <Linea puntos={r.historial_exactitud} />
          )}
          <p className="pista" style={{ marginTop: 8 }}>
            Un punto por cada bodega cerrada con doble firma, en orden cronológico.
          </p>
        </div>
      </div>

      <div className="card">
        <h3>Informe de Power BI</h3>
        {urlPBI ? (
          <iframe title="Panel gerencial CuentaVoz" src={urlPBI}
                  style={{ width: "100%", height: 460, border: 0, borderRadius: 12 }}
                  allowFullScreen />
        ) : (
          <>
            <p className="pista">
              Para insertar el informe: publíquelo en Power BI Service, copie el
              enlace de <b>Archivo → Insertar informe</b> y póngalo en el archivo
              <b> .env</b> del frontend como <b>VITE_POWERBI_URL</b>.
            </p>
            <div className="banner ok" style={{ marginTop: 14 }}>
              <span className="ico">✓</span>
              <span>
                <b>Una sola fuente, dos salidas</b>
                <span>El informe que abre la gerencia y este panel se alimentan de
                      la misma base PostgreSQL.</span>
              </span>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function TabAlertas({ a }) {
  if (!a) return <p className="cargando">Cargando…</p>;
  const estados = Object.entries(a.estado_bodegas);
  const maxAlerta = Math.max(1, ...a.alertas_por_tipo.map((x) => x.cantidad));

  return (
    <>
      <div className="kpis">
        <div className="kpi verde">
          <div className="kpi-cabeza">
            <span className="icono-kpi">📉</span>
            <small>Negativos detectados en el sistema</small>
          </div>
          <b>{a.negativos_iniciales} → {a.negativos_actuales}</b>
          <i>corregidos durante la toma</i></div>
        <div className="kpi">
          <div className="kpi-cabeza">
            <span className="icono-kpi">⏱️</span>
            <small>Tiempo promedio por bodega</small>
          </div>
          <b>{a.tiempo_promedio_min || "—"} min</b><i>conteos ya cerrados</i></div>
        <div className="kpi verde">
          <div className="kpi-cabeza">
            <span className="icono-kpi">🗣️</span>
            <small>Alias aprendidos por el agente</small>
          </div>
          <b>{a.alias_aprendidos}</b><i>el agente habla como el equipo</i></div>
      </div>

      <div className="card">
        <h3>Estado de las bodegas</h3>
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
        <h3>Alertas por tipo</h3>
        {a.alertas_por_tipo.length === 0 ? (
          <p className="vacio">Sin alertas registradas todavía.</p>
        ) : (
          a.alertas_por_tipo.map((x, i) => (
            <div className="barra-fila" key={x.tipo}>
              <span className="etq">{x.tipo}</span>
              <div className="pista">
                <div className="rellena" style={{ width: `${x.cantidad / maxAlerta * 100}%`,
                                                   background: SERIE[i % SERIE.length] }} />
              </div>
              <span className="val">{x.cantidad}</span>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h3>Descuadres recurrentes: dónde está la causa raíz</h3>
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

/** Línea de tendencia con SVG puro: una sola serie, sin leyenda. */
function Linea({ puntos }) {
  const w = 460, h = 140, pad = 24;
  const valores = puntos.map((p) => p.exactitud);
  const min = Math.min(...valores) - 2, max = Math.max(...valores) + 2;
  const paso = (w - pad * 2) / (puntos.length - 1);
  const y = (v) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
  const coords = puntos.map((p, i) => [pad + i * paso, y(p.exactitud)]);
  const linea = coords.map(([x, yy], i) => `${i === 0 ? "M" : "L"}${x},${yy}`).join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Tendencia de exactitud">
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="var(--borde)" strokeWidth="1" />
      <path d={linea} fill="none" stroke="var(--serie-1)" strokeWidth="2" />
      {coords.map(([x, yy], i) => (
        <circle key={i} cx={x} cy={yy} r="4" fill="var(--serie-1)" />
      ))}
      {puntos.map((p, i) => (
        <text key={i} x={coords[i][0]} y={h - 4} fontSize="9" textAnchor="middle" fill="var(--grafito)">
          {p.fecha.slice(5)}
        </text>
      ))}
      <text x={coords[coords.length - 1][0]} y={coords[coords.length - 1][1] - 10}
            fontSize="11" fontWeight="700" textAnchor="middle" fill="var(--serie-1)">
        {valores[valores.length - 1]}%
      </text>
    </svg>
  );
}
