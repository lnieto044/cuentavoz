import { useEffect, useState } from "react";
import { pedir, enviarTurno } from "../api";
import { escuchar, hablar, vozDisponible } from "../voz";
import Marco from "../Marco";

const TABS = [
  { id: "recuento", t: "Recuento ciego y cierre" },
  { id: "aprobaciones", t: "Aprobaciones" },
  { id: "alertas", t: "Bandeja de alertas" },
];

export default function Auditoria({ token, usuario }) {
  const [tab, setTab] = useState("recuento");
  const esAuditor = usuario?.perfil === "auditor";

  return (
    <Marco titulo="Auditoría  ·  recuento ciego, aprobaciones y cierre"
           chip={{ texto: esAuditor ? "ADMINISTRADORA" : "SOLO LECTURA",
                   tipo: esAuditor ? "azul" : "gris" }}>
      {!esAuditor && (
        <div className="banner">
          <span className="ico">!</span>
          <span>
            <b>Su perfil es auxiliar</b>
            <span>Auditar, aprobar y cerrar bodegas requiere perfil de administrador.
                  Ingrese como «diana» para probarlo.</span>
          </span>
        </div>
      )}
      <div className="chips">
        {TABS.map((tt) => (
          <button key={tt.id} className={`chip ${tab === tt.id ? "azul" : ""}`}
                  onClick={() => setTab(tt.id)}>{tt.t}</button>
        ))}
      </div>

      {tab === "recuento" && <TabRecuento token={token} esAuditor={esAuditor} />}
      {tab === "aprobaciones" && <TabAprobaciones token={token} esAuditor={esAuditor} />}
      {tab === "alertas" && <TabAlertas token={token} esAuditor={esAuditor} />}
    </Marco>
  );
}

/* ── Recuento ciego + cierre con doble firma ── */
function TabRecuento({ token, esAuditor }) {
  const [bodegas, setBodegas] = useState([]);
  const [bodegaId, setBodegaId] = useState(null);
  const [sesion, setSesion] = useState(null);
  const [dicho, setDicho] = useState("");
  const [respuesta, setRespuesta] = useState("");
  const [comparar, setComparar] = useState(null);
  const [firmas, setFirmas] = useState(null);
  const [msg, setMsg] = useState("");
  const [estado, setEstado] = useState("listo");

  function cargarBodegas() {
    pedir("/api/bodegas", {}, token).then(setBodegas).catch(() => {});
  }
  useEffect(cargarBodegas, [token]);

  const candidatas = bodegas.filter((b) => b.estado === "en_auditoria" || b.estado === "cerrada");

  async function iniciar(id) {
    setMsg(""); setComparar(null);
    try {
      const r = await pedir(`/api/bodegas/${id}/auditoria/iniciar`, { method: "POST" }, token);
      setBodegaId(id);
      setSesion(r);
      const saludo = `Recuento ciego iniciado en ${r.bodega.toLowerCase()}. Dícteme el primer producto.`;
      setRespuesta(saludo);
      hablar(saludo);
      verFirmas(id);
    } catch (e) { setMsg(e.message); }
  }

  async function verFirmas(id) {
    try { setFirmas(await pedir(`/api/bodegas/${id}/firmas`, {}, token)); }
    catch (_) {}
  }

  async function procesar(texto) {
    if (!texto || !sesion) return;
    setDicho(texto);
    try {
      const t = await enviarTurno(texto, sesion.sesion_id, token);
      setRespuesta(t.respuesta_hablada || "");
      hablar(t.respuesta_hablada);
    } catch (e) { setMsg(e.message); }
  }

  async function verComparar() {
    setMsg("");
    try { setComparar(await pedir(`/api/bodegas/${bodegaId}/auditoria/comparar`, {}, token)); }
    catch (e) { setMsg(e.message); }
  }

  async function firmarAuditoria() {
    try {
      await pedir(`/api/bodegas/${bodegaId}/auditoria/firmar`, { method: "POST" }, token);
      setMsg("Auditoría firmada.");
      verFirmas(bodegaId);
    } catch (e) { setMsg(e.message); }
  }

  async function cerrarDefinitivo() {
    try {
      const r = await pedir(`/api/bodegas/${bodegaId}/cerrar`, { method: "POST" }, token);
      setMsg(`${r.bodega} cerrada definitivamente con doble firma.`);
      setBodegaId(null); setSesion(null); setComparar(null); setFirmas(null);
      cargarBodegas();
    } catch (e) { setMsg(e.message); }
  }

  if (!esAuditor) return null;

  return (
    <>
      {msg && <p className="msg-ok">{msg}</p>}

      {!bodegaId ? (
        <div className="card">
          <h3>Bodegas listas para recuento ciego o cierre</h3>
          {candidatas.length === 0 ? (
            <p className="vacio">Ninguna bodega firmada por el auxiliar en este momento.</p>
          ) : (
            candidatas.map((b) => (
              <div className="registro" key={b.id}>
                <span className={`chip ${b.estado === "cerrada" ? "verde" : "oro"}`}>
                  {b.estado === "cerrada" ? "CERRADA" : "EN AUDITORÍA"}
                </span>
                <span>{b.bodega}</span>
                <span className="cant">{b.referencias} refs</span>
                <button className="btn" style={{ padding: "6px 12px", minHeight: 0 }}
                        onClick={() => { setBodegaId(b.id); verFirmas(b.id); }}>
                  Abrir
                </button>
              </div>
            ))
          )}
          <p className="pista" style={{ marginTop: 10 }}>
            El recuento del administrador es a ciegas: no ve el conteo del auxiliar
            hasta comparar.
          </p>
        </div>
      ) : (
        <>
          <div className="card">
            <h3>{bodegas.find((b) => b.id === bodegaId)?.bodega}</h3>
            {!sesion ? (
              <button className="btn" onClick={() => iniciar(bodegaId)}>
                Iniciar recuento ciego
              </button>
            ) : (
              <div className="conteo-cols">
                <div>
                  <p className="rotulo">{dicho ? `Usted dijo: «${dicho}»` : "CuentaVoz responde"}</p>
                  <div className="burbuja">{respuesta}</div>
                  <div className="grilla-botones" style={{ marginTop: 12 }}>
                    <button className="btn verde" onClick={() => procesar("confirmo")}>Confirmar</button>
                    <button className="btn gris" onClick={() => {
                      const t = window.prompt("Escriba el producto y la cantidad:");
                      if (t) procesar(t);
                    }}>Teclado</button>
                  </div>
                </div>
                <div className="mic-caja">
                  <button className={`mic-btn ${estado === "escuchando" ? "escuchando" : ""}`}
                          onClick={() => escuchar({ alTexto: procesar, alEstado: setEstado })}>
                    🎤
                  </button>
                  <small>{vozDisponible() ? "Reconocimiento en español" : "Use el teclado"}</small>
                </div>
              </div>
            )}
            <div className="grilla-botones" style={{ marginTop: 12 }}>
              {sesion && <button className="btn borde" onClick={verComparar}>Ver comparación</button>}
              <button className="btn gris" onClick={() => { setBodegaId(null); setSesion(null); }}>
                Volver a la lista
              </button>
            </div>
          </div>

          {comparar && (
            <div className="card">
              <div className="chips">
                <span className="chip">{comparar.total} referencias</span>
                <span className="chip verde">{comparar.coinciden} coinciden</span>
                <span className="chip oro">{comparar.filas.length} con diferencia</span>
              </div>
              <p className="pista">
                Solo se muestran las referencias con diferencia. Su conteo fue a ciegas:
                el conteo 1 se revela al comparar.
              </p>
              {comparar.filas.length === 0 ? (
                <p className="vacio">Sin diferencias entre el recuento ciego y el sistema.</p>
              ) : (
                <table>
                  <thead>
                    <tr><th>Artículo</th><th>Conteo 1</th><th>Su conteo</th>
                        <th>Sistema</th><th>Diferencia</th><th>Acción</th></tr>
                  </thead>
                  <tbody>
                    {comparar.filas.map((f) => (
                      <tr key={f.codigo}>
                        <td>{f.articulo}</td>
                        <td>{f.conteo1 ?? "—"}</td>
                        <td>{f.conteo2 ?? "—"}</td>
                        <td>{f.sistema}</td>
                        <td className="dif">{f.diferencia > 0 ? `+${f.diferencia}` : f.diferencia}</td>
                        <td>{f.accion}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {firmas && (
            <div className="card">
              <h3>Cierre de bodega</h3>
              <div className="conteo-cols">
                <div className="opcion" style={{ borderColor: firmas.conteo?.firmada ? "var(--verde)" : "var(--borde)" }}>
                  <span className="n">CONTEO 1 · AUXILIAR</span>
                  <h4 style={{ textTransform: "capitalize" }}>{firmas.conteo?.persona || "—"}</h4>
                  {firmas.conteo?.firmada ? (
                    <p style={{ color: "var(--verde)", fontWeight: 700 }}>✓ Firmado · {firmas.conteo.hora}</p>
                  ) : <p>Pendiente de su firma</p>}
                  <p>Sin acceso al recuento de auditoría</p>
                </div>
                <div className="opcion" style={{ borderColor: firmas.auditoria?.firmada ? "var(--verde)" : "var(--borde)" }}>
                  <span className="n">AUDITORÍA · ADMINISTRADORA</span>
                  <h4 style={{ textTransform: "capitalize" }}>{firmas.auditoria?.persona || "—"}</h4>
                  {firmas.auditoria?.firmada ? (
                    <p style={{ color: "var(--verde)", fontWeight: 700 }}>✓ Firmado · {firmas.auditoria.hora}</p>
                  ) : (
                    <button className="btn" onClick={firmarAuditoria}>Firmar con PIN</button>
                  )}
                </div>
              </div>
              <div className="grilla-botones" style={{ marginTop: 14 }}>
                <button className="btn verde" disabled={!firmas.lista_para_cerrar}
                        onClick={cerrarDefinitivo}>
                  Cerrar bodega definitivamente
                </button>
              </div>
              <p className="pista" style={{ marginTop: 10 }}>
                Ninguna bodega se cierra con una sola firma: es la garantía de trazabilidad.
              </p>
            </div>
          )}
        </>
      )}
    </>
  );
}

/* ── Aprobaciones pendientes ── */
function TabAprobaciones({ token, esAuditor }) {
  const [lista, setLista] = useState([]);
  const [msg, setMsg] = useState("");

  function cargar() {
    pedir("/api/aprobaciones?estado=pendiente", {}, token).then(setLista).catch(() => {});
  }
  useEffect(cargar, [token]);

  async function resolver(id, accion) {
    try {
      await pedir(`/api/aprobaciones/${id}/${accion}`, { method: "POST" }, token);
      setMsg(accion === "aprobar" ? "Aprobado y agregado al catálogo oficial." : "Rechazado.");
      cargar();
    } catch (e) { setMsg(e.message); }
  }

  if (!esAuditor) return null;

  return (
    <div className="card">
      <h3>Productos y bodegas creados durante la toma ({lista.length} pendientes)</h3>
      {msg && <p className="msg-ok">{msg}</p>}
      {lista.length === 0 ? (
        <p className="vacio">Nada pendiente de aprobación.</p>
      ) : (
        lista.map((a) => (
          <div className="registro" key={a.id} style={{ alignItems: "flex-start" }}>
            <span className="chip">{a.tipo === "producto" ? "Producto nuevo" : "Bodega nueva"}</span>
            <span>
              <b>{a.nombre}</b>
              <br />
              <small style={{ color: "var(--grafito)" }}>
                {a.tipo === "producto" && `${a.cantidad_inicial} ${a.unidad_medida} en ${a.bodega}`}
                {" · "}{a.creado_por} · {a.hora}
              </small>
            </span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button className="btn gris" style={{ padding: "6px 12px", minHeight: 0 }}
                      onClick={() => resolver(a.id, "rechazar")}>Rechazar</button>
              <button className="btn verde" style={{ padding: "6px 12px", minHeight: 0 }}
                      onClick={() => resolver(a.id, "aprobar")}>Aprobar</button>
            </span>
          </div>
        ))
      )}
      <p className="pista" style={{ marginTop: 10 }}>
        Al aprobar, el producto entra al catálogo con su código definitivo y el
        conteo asociado deja de estar marcado. Mientras tanto el conteo nunca se
        detiene: la aprobación ocurre en paralelo al trabajo en bodega.
      </p>
    </div>
  );
}

/* ── Bandeja de alertas ── */
function TabAlertas({ token, esAuditor }) {
  const [alertas, setAlertas] = useState([]);
  const [msg, setMsg] = useState("");

  function cargar() {
    pedir("/api/alertas?resueltas=0", {}, token).then(setAlertas).catch(() => {});
  }
  useEffect(cargar, [token]);

  async function resolver(id) {
    try {
      await pedir(`/api/alertas/${id}/resolver`, { method: "POST" }, token);
      setMsg("Alerta resuelta.");
      cargar();
    } catch (e) { setMsg(e.message); }
  }

  return (
    <div className="card">
      <h3>Bandeja de alertas ({alertas.length} abiertas)</h3>
      {msg && <p className="msg-ok">{msg}</p>}
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
  );
}
