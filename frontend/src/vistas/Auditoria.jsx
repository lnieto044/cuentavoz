import { useEffect, useState } from "react";
import { pedir, enviarTurno } from "../api";
import { escuchar, hablar, vozDisponible } from "../voz";
import Marco from "../Marco";
import Dialogo from "../Dialogo";

const TABS = [
  { id: "recuento", t: "Recuento ciego y cierre" },
  { id: "aprobaciones", t: "Aprobaciones" },
  { id: "pedidos", t: "Pedidos pendientes" },
  { id: "alertas", t: "Bandeja de alertas" },
];

export default function Auditoria({ token, usuario }) {
  const [tab, setTab] = useState("recuento");
  const [enFoco, setEnFoco] = useState(null); // { titulo, chip } para la vista activa
  const esAuditor = usuario?.perfil === "auditor";

  return (
    <Marco titulo={enFoco ? enFoco.titulo
                          : "Auditoría  ·  recuento ciego, aprobaciones y cierre"}
           chip={enFoco ? enFoco.chip
                        : { texto: esAuditor ? "ADMINISTRADORA" : "SOLO LECTURA",
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
                  onClick={() => { setTab(tt.id); setEnFoco(null); }}>{tt.t}</button>
        ))}
      </div>

      {tab === "recuento" && <TabRecuento token={token} esAuditor={esAuditor} onEnFoco={setEnFoco} />}
      {tab === "aprobaciones" && <TabAprobaciones token={token} esAuditor={esAuditor} onEnFoco={setEnFoco} />}
      {tab === "pedidos" && <TabPedidosPendientes token={token} esAuditor={esAuditor} onEnFoco={setEnFoco} />}
      {tab === "alertas" && <TabAlertas token={token} esAuditor={esAuditor} onEnFoco={setEnFoco} />}
    </Marco>
  );
}

/* ── Recuento ciego + cierre con doble firma ── */
function TabRecuento({ token, esAuditor, onEnFoco }) {
  const [bodegas, setBodegas] = useState(null);
  const [bodegaId, setBodegaId] = useState(null);
  const [sesion, setSesion] = useState(null);
  const [dicho, setDicho] = useState("");
  const [respuesta, setRespuesta] = useState("");
  const [comparar, setComparar] = useState(null);
  const [firmas, setFirmas] = useState(null);
  const [modoCierre, setModoCierre] = useState(false);
  const [msg, setMsg] = useState("");
  const [estado, setEstado] = useState("listo");
  const [mostrarTeclado, setMostrarTeclado] = useState(false);
  const [mostrarDictado, setMostrarDictado] = useState(false);
  const [opciones, setOpciones] = useState(null);
  const [opcionesPara, setOpcionesPara] = useState(null);

  function cargarBodegas() {
    // ?propias=1: si este administrador tiene bodegas asignadas (supervisor
    // de una zona), audita solo esas; sin asignaciones, ve el parque
    // completo (administrador general) - ver /api/bodegas en el backend.
    // si falla, resuelve a [] en vez de dejar bodegas en null para
    // siempre: sin esto un fallo de red dejaba "Cargando…" sin fin.
    pedir("/api/bodegas?propias=1", {}, token).then(setBodegas)
      .catch((e) => { setBodegas([]); setMsg(e.message); });
  }
  useEffect(cargarBodegas, [token]);

  const candidatas = (bodegas || []).filter((b) => b.estado === "en_auditoria" || b.estado === "cerrada");

  useEffect(() => {
    if (!bodegaId) { onEnFoco(null); return; }
    const nombre = comparar?.bodega || firmas?.bodega || (bodegas || []).find((b) => b.id === bodegaId)?.bodega;
    if (!nombre) return;
    if (modoCierre) {
      onEnFoco({ titulo: `Cierre de bodega  ·  ${nombre}`,
                chip: { texto: "LISTA PARA CERRAR", tipo: "borde verde" } });
    } else {
      onEnFoco({ titulo: `Auditoría  ·  ${nombre}`,
                chip: { texto: "RECONTEO CIEGO", tipo: "borde oro" } });
    }
  }, [bodegaId, comparar, firmas, bodegas, modoCierre]);

  async function iniciar(id) {
    setMsg(""); setComparar(null);
    try {
      const r = await pedir(`/api/bodegas/${id}/auditoria/iniciar`, { method: "POST" }, token);
      setBodegaId(id);
      setSesion(r);
      setMostrarDictado(true);
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

  async function procesar(texto, mostrar = texto) {
    if (!texto || !sesion) return;
    setDicho(mostrar);
    try {
      const t = await enviarTurno(texto, sesion.sesion_id, token, {
        opciones, opcionesPara,
        bodegaId, bodegaNombre: sesion?.bodega,
      });
      setRespuesta(t.respuesta_hablada || "");
      setOpciones(t.opciones || null);
      setOpcionesPara(t.opciones_para || null);
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
      setBodegaId(null); setSesion(null); setComparar(null); setFirmas(null); setModoCierre(false);
      cargarBodegas();
    } catch (e) { setMsg(e.message); }
  }

  function volverALaLista() {
    setBodegaId(null); setSesion(null); setComparar(null); setFirmas(null);
    setModoCierre(false); setMostrarDictado(false);
  }

  if (!esAuditor) return null;

  return (
    <>
      {msg && <p className="msg-ok">{msg}</p>}

      {!bodegaId ? (
        <div className="card">
          <h3>Bodegas listas para recuento ciego o cierre</h3>
          {bodegas === null ? (
            <p className="cargando">Cargando…</p>
          ) : candidatas.length === 0 ? (
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
      ) : !sesion ? (
        <div className="card">
          <h3>{(bodegas || []).find((b) => b.id === bodegaId)?.bodega}</h3>
          <button className="btn" onClick={() => iniciar(bodegaId)}>
            Iniciar recuento ciego
          </button>
          <div className="grilla-botones" style={{ marginTop: 12 }}>
            <button className="btn gris" onClick={volverALaLista}>Volver a la lista</button>
          </div>
        </div>
      ) : !comparar ? (
        <div className="card">
          <h3>{(bodegas || []).find((b) => b.id === bodegaId)?.bodega}</h3>
          <div className="conteo-cols">
            <div>
              <p className="rotulo">{dicho ? `Usted dijo: «${dicho}»` : "CuentaVoz responde"}</p>
              <div className="burbuja">{respuesta}</div>
              {opciones && (
                <div className="opciones" style={{ marginTop: 14 }}>
                  {opciones.map((o, i) => (
                    <button key={o.codigo} className="opcion"
                            onClick={() => procesar(o.codigo, o.nombre)}>
                      <span className="n">Opción {i + 1}</span>
                      <h4>{o.nombre}</h4>
                      <p>Código {o.codigo}</p>
                      <p>{o.unidad}</p>
                    </button>
                  ))}
                </div>
              )}
              <div className="grilla-botones" style={{ marginTop: 12 }}>
                <button className="btn verde" onClick={() => procesar("confirmo")}>Confirmar</button>
                <button className="btn gris" onClick={() => setMostrarTeclado(true)}>
                  Teclado
                </button>
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
          <div className="grilla-botones" style={{ marginTop: 12 }}>
            <button className="btn borde" onClick={verComparar}>Ver comparación</button>
            <button className="btn gris" onClick={volverALaLista}>Volver a la lista</button>
          </div>
        </div>
      ) : !modoCierre ? (
        <div className="card">
          <div className="chips">
            <span className="chip azul">{comparar.total} referencias</span>
            <span className="chip oro">{comparar.filas.length} con diferencia</span>
            <span className="chip verde">{comparar.coinciden} coinciden</span>
          </div>
          <p className="pista">
            Solo se muestran las referencias con diferencia. Su reconteo fue a ciegas:
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

          {comparar.diagnosticos?.length > 0 && (
            <div style={{ background: "#FAFBFD", border: "1px solid var(--borde)",
                         borderRadius: "var(--radio)", padding: 14, marginTop: 14 }}>
              <h3 style={{ marginTop: 0 }}>Diagnóstico automático</h3>
              {comparar.diagnosticos.map((d, i) => (
                <p key={i} style={{ fontSize: ".88rem", marginTop: i ? 8 : 0 }}>{d}</p>
              ))}
            </div>
          )}

          {mostrarDictado && (
            <div className="conteo-cols" style={{ marginTop: 16 }}>
              <div>
                <p className="rotulo">{dicho ? `Usted dijo: «${dicho}»` : "CuentaVoz responde"}</p>
                <div className="burbuja">{respuesta}</div>
                {opciones && (
                  <div className="opciones" style={{ marginTop: 14 }}>
                    {opciones.map((o, i) => (
                      <button key={o.codigo} className="opcion"
                              onClick={() => procesar(o.codigo, o.nombre)}>
                        <span className="n">Opción {i + 1}</span>
                        <h4>{o.nombre}</h4>
                        <p>Código {o.codigo}</p>
                        <p>{o.unidad}</p>
                      </button>
                    ))}
                  </div>
                )}
                <div className="grilla-botones" style={{ marginTop: 12 }}>
                  <button className="btn verde" onClick={() => procesar("confirmo")}>Confirmar</button>
                  <button className="btn borde" onClick={verComparar}>Actualizar comparación</button>
                  <button className="btn gris" onClick={() => setMostrarTeclado(true)}>Teclado</button>
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

          <div className="grilla-botones" style={{ marginTop: 14 }}>
            <button className="btn" onClick={() => setMostrarDictado((v) => !v)}>
              {mostrarDictado ? "Ocultar dictado" : "Resolver por voz"}
            </button>
            <button className="btn borde" disabled={firmas?.auditoria?.firmada}
                    onClick={firmarAuditoria}>
              Aceptar todas
            </button>
            <button className="btn verde" onClick={() => setModoCierre(true)}>
              Cerrar con doble firma
            </button>
          </div>
          <div className="grilla-botones" style={{ marginTop: 8 }}>
            <button className="btn gris" onClick={volverALaLista}>Volver a la lista</button>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="chips">
            <span className="chip">{firmas?.referencias ?? comparar.total} referencias</span>
            <span className="chip verde">{comparar.filas.length} diferencias resueltas</span>
            <span className="chip verde">{firmas?.alertas_resueltas ?? 0} alertas cerradas</span>
          </div>

          <div className="conteo-cols" style={{ marginTop: 14 }}>
            <div className="opcion" style={{
              borderColor: firmas?.conteo?.firmada ? "var(--verde)" : "var(--borde)",
              background: firmas?.conteo?.firmada ? "var(--verde-bg)" : "#fff",
            }}>
              <span className="n">CONTEO 1 · AUXILIAR</span>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                <span style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--verde)",
                              color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                              fontWeight: 700 }}>
                  {(firmas?.conteo?.persona || "?")[0]?.toUpperCase()}
                </span>
                <h4 style={{ textTransform: "capitalize", margin: 0 }}>{firmas?.conteo?.persona || "—"}</h4>
              </div>
              {firmas?.conteo?.firmada ? (
                <p style={{ color: "var(--verde)", fontWeight: 700, marginTop: 10 }}>
                  ✓ Firmado · {firmas.conteo.hora}
                </p>
              ) : <p style={{ marginTop: 10 }}>Pendiente de su firma</p>}
              <p style={{ fontSize: ".82rem", color: "var(--grafito)" }}>
                {firmas?.conteo?.huella ? "Huella digital registrada · " : ""}
                {firmas?.referencias ?? comparar.total} referencias
              </p>
              <p style={{ fontSize: ".82rem", fontStyle: "italic", color: "var(--grafito)" }}>
                Sin acceso al recuento de auditoría
              </p>
            </div>
            <div className="opcion" style={{
              borderColor: firmas?.auditoria?.firmada ? "var(--verde)" : "var(--azul)",
            }}>
              <span className="n">AUDITORÍA · ADMINISTRADORA</span>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                <span style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--azul)",
                              color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                              fontWeight: 700 }}>
                  {(firmas?.auditoria?.persona || "?")[0]?.toUpperCase()}
                </span>
                <h4 style={{ textTransform: "capitalize", margin: 0 }}>{firmas?.auditoria?.persona || "—"}</h4>
              </div>
              {firmas?.auditoria?.firmada ? (
                <p style={{ color: "var(--verde)", fontWeight: 700, marginTop: 10 }}>
                  ✓ Firmado · {firmas.auditoria.hora}
                </p>
              ) : (
                <>
                  <p style={{ color: "var(--azul)", marginTop: 10 }}>Pendiente de su firma</p>
                  <button className="btn" style={{ marginTop: 8 }} onClick={firmarAuditoria}>
                    Firmar con PIN o huella
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="grilla-botones" style={{ marginTop: 16 }}>
            <button className="btn verde" disabled={!firmas?.lista_para_cerrar}
                    onClick={cerrarDefinitivo} style={{ flex: 1, fontSize: "1.05rem" }}>
              Cerrar bodega definitivamente
            </button>
          </div>
          <p className="pista" style={{ marginTop: 10, textAlign: "center" }}>
            Con las dos firmas la bodega pasa a CERRADA en el tablero al instante y sus datos entran al consolidado.
          </p>
          <p className="pista" style={{ textAlign: "center", color: "var(--azul)" }}>
            Ninguna bodega se cierra con una sola firma: es la garantía de trazabilidad del inventario.
          </p>
          <div className="grilla-botones" style={{ marginTop: 8 }}>
            <button className="btn borde" onClick={() => setModoCierre(false)}>
              Volver a la comparación
            </button>
            <button className="btn gris" onClick={volverALaLista}>Volver a la lista</button>
          </div>
        </div>
      )}

      {mostrarTeclado && (
        <Dialogo titulo="Escribir en vez de hablar"
                 mensaje="Escriba el producto y la cantidad:"
                 conCampo placeholder="tres tablas para picar blancas"
                 onAceptar={(t) => { setMostrarTeclado(false); if (t) procesar(t); }}
                 onCancelar={() => setMostrarTeclado(false)} />
      )}
    </>
  );
}

/* ── Aprobaciones pendientes ── */
function TabAprobaciones({ token, esAuditor, onEnFoco }) {
  const [lista, setLista] = useState(null);
  const [msg, setMsg] = useState("");

  function cargar() {
    pedir("/api/aprobaciones?estado=pendiente", {}, token).then(setLista)
      .catch((e) => { setLista([]); setMsg(e.message); });
  }
  useEffect(cargar, [token]);

  useEffect(() => {
    onEnFoco({ titulo: "Aprobaciones pendientes",
              chip: { texto: lista === null ? "…" : `${lista.length} PENDIENTES`, tipo: "borde oro" } });
  }, [lista]);

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
      <p className="pista" style={{ marginTop: 0 }}>
        Productos y bodegas creados durante la toma que esperan su firma para entrar al catálogo oficial.
      </p>
      {msg && <p className="msg-ok">{msg}</p>}
      {lista === null ? (
        <p className="cargando">Cargando…</p>
      ) : lista.length === 0 ? (
        <p className="vacio">Nada pendiente de aprobación.</p>
      ) : (
        lista.map((a) => (
          <div key={a.id} style={{ display: "flex", alignItems: "flex-start", gap: 14,
                                   flexWrap: "wrap",
                                   border: "1px solid var(--borde)", borderRadius: 10,
                                   padding: "12px 14px", marginBottom: 10 }}>
            <span style={{ flex: 1, minWidth: 200 }}>
              <b style={{ color: "var(--azul)" }}>{a.nombre}</b>
              <br />
              <span style={{ fontSize: ".85rem" }}>
                {a.tipo === "producto"
                  ? `Producto nuevo · ${a.unidad_medida || ""}`
                  : "Bodega nueva"}
              </span>
              <br />
              <small style={{ color: "var(--grafito)", fontStyle: "italic" }}>
                {a.tipo === "producto"
                  ? `${a.cantidad_inicial} ${a.unidad_medida} contados en ${a.bodega}`
                  : "sin referencias asignadas todavía"}
              </small>
              <br />
              <small style={{ color: "var(--grafito)", textTransform: "capitalize" }}>
                {a.creado_por} · {a.hora}
              </small>
            </span>
            <span style={{ display: "flex", gap: 8 }}>
              <button className="btn gris" onClick={() => resolver(a.id, "rechazar")}>Rechazar</button>
              <button className="btn verde" onClick={() => resolver(a.id, "aprobar")}>Aprobar</button>
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

/* ── Pedidos de auxiliares esperando aprobación antes de salir del almacén ── */
function TabPedidosPendientes({ token, esAuditor, onEnFoco }) {
  const [lista, setLista] = useState(null);
  const [msg, setMsg] = useState("");

  function cargar() {
    pedir("/api/pedidos/pendientes", {}, token).then(setLista)
      .catch((e) => { setLista([]); setMsg(e.message); });
  }
  useEffect(cargar, [token]);

  useEffect(() => {
    onEnFoco({ titulo: "Pedidos pendientes de aprobación",
              chip: { texto: lista === null ? "…" : `${lista.length} PENDIENTES`, tipo: "borde oro" } });
  }, [lista]);

  async function resolver(numero, aprobar) {
    try {
      await pedir(`/api/pedidos/${numero}/resolver`, {
        method: "POST", body: JSON.stringify({ aprobar }),
      }, token);
      setMsg(aprobar ? "Pedido aprobado: ya puede salir del almacén."
                     : "Pedido rechazado.");
      cargar();
    } catch (e) { setMsg(e.message); }
  }

  if (!esAuditor) return null;

  return (
    <div className="card">
      <p className="pista" style={{ marginTop: 0 }}>
        El auxiliar pide y queda registrado de una vez, pero solo sale del almacén
        cuando usted lo aprueba aquí - igual que con productos y bodegas nuevas.
      </p>
      {msg && <p className="msg-ok">{msg}</p>}
      {lista === null ? (
        <p className="cargando">Cargando…</p>
      ) : lista.length === 0 ? (
        <p className="vacio">Nada pendiente de aprobación.</p>
      ) : (
        lista.map((p) => (
          <div key={p.numero_pedido} style={{ display: "flex", alignItems: "flex-start", gap: 14,
                                   flexWrap: "wrap",
                                   border: "1px solid var(--borde)", borderRadius: 10,
                                   padding: "12px 14px", marginBottom: 10 }}>
            <span style={{ flex: 1, minWidth: 200 }}>
              <b style={{ color: "var(--azul)" }}>{p.plato}</b> · {p.porciones} porciones
              <span className="chip" style={{ marginLeft: 8 }}>{p.numero_pedido}</span>
              <br />
              <small style={{ color: "var(--grafito)" }}>
                Se descontaría de: {p.bodega || "—"}
              </small>
              <br />
              <small style={{ color: "var(--grafito)", textTransform: "capitalize" }}>
                Pedido por {p.persona} · {p.hora}
              </small>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: ".85rem" }}>
                {p.items.map((it, i) => (
                  <li key={i}>{it.nombre}: {it.cantidad}</li>
                ))}
              </ul>
            </span>
            <span style={{ display: "flex", gap: 8, flex: "none" }}>
              <button className="btn gris" onClick={() => resolver(p.numero_pedido, false)}>Rechazar</button>
              <button className="btn verde" onClick={() => resolver(p.numero_pedido, true)}>Aprobar</button>
            </span>
          </div>
        ))
      )}
      <p className="pista" style={{ marginTop: 10 }}>
        Al aprobar, el pedido queda abierto para su legalización al final del servicio.
        Al rechazar, no cuenta como enviado y el auxiliar debe volver a intentarlo.
      </p>
    </div>
  );
}

/* ── Bandeja de alertas ── */
const COLOR_ALERTA = { desviacion: "oro", negativo: "oro", unidad: "azul", inexistente: "azul" };

function TabAlertas({ token, esAuditor, onEnFoco }) {
  const [alertas, setAlertas] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [verDetalle, setVerDetalle] = useState(null);
  const [msg, setMsg] = useState("");

  function cargar() {
    pedir("/api/alertas?resueltas=0", {}, token).then(setAlertas)
      .catch((e) => { setAlertas([]); setMsg(e.message); });
    pedir("/api/alertas/resumen", {}, token).then(setResumen).catch(() => {});
  }
  useEffect(cargar, [token]);

  useEffect(() => {
    onEnFoco({ titulo: "Auditoría  ·  Bandeja de alertas",
              chip: { texto: alertas === null ? "…" : `${alertas.length} ABIERTAS`, tipo: "borde oro" } });
  }, [alertas]);

  async function resolver(id) {
    try {
      await pedir(`/api/alertas/${id}/resolver`, { method: "POST" }, token);
      setMsg("Alerta resuelta.");
      cargar();
    } catch (e) { setMsg(e.message); }
  }

  return (
    <div className="card">
      <div className="chips">
        <span className="chip oro">{resumen?.abiertas ?? (alertas || []).length} abiertas</span>
        <span className="chip verde">{resumen?.resueltas_hoy ?? 0} resueltas hoy</span>
        <span className="chip">
          Tiempo medio: {resumen?.tiempo_medio_min != null ? `${resumen.tiempo_medio_min} min` : "—"}
        </span>
      </div>
      {msg && <p className="msg-ok">{msg}</p>}
      {alertas === null ? (
        <p className="cargando">Cargando…</p>
      ) : alertas.length === 0 ? (
        <p className="vacio">No hay alertas abiertas.</p>
      ) : (
        alertas.map((a) => (
          <div key={a.id} style={{
            display: "flex", alignItems: "center", gap: 14, marginTop: 10, flexWrap: "wrap",
            border: "1px solid var(--borde)",
            borderLeft: `4px solid ${COLOR_ALERTA[a.tipo] === "azul" ? "var(--azul)" : "var(--amarillo)"}`,
            borderRadius: 10, padding: "12px 14px",
          }}>
            <span style={{ flex: 1, minWidth: 200 }}>
              <b style={{ color: COLOR_ALERTA[a.tipo] === "azul" ? "var(--azul)" : "var(--amarillo-tx)" }}>
                {a.titulo}
              </b>
              <br />
              <span style={{ fontSize: ".88rem" }}>
                {a.articulo || "—"}{a.bodega ? ` · ${a.bodega}` : ""}
              </span>
              <br />
              <small style={{ color: "var(--grafito)", textTransform: "capitalize" }}>
                {a.persona || "—"} · {a.hora}
              </small>
              <br />
              <small style={{ color: "var(--grafito)", fontStyle: "italic" }}>{a.detalle}</small>
            </span>
            <span style={{ display: "flex", gap: 8, flex: "none" }}>
              <button className="btn borde" onClick={() => setVerDetalle(a)}>Ver</button>
              {esAuditor && (
                <button className="btn" onClick={() => resolver(a.id)}>Resolver</button>
              )}
            </span>
          </div>
        ))
      )}
      <p className="pista" style={{ marginTop: 12, fontStyle: "italic" }}>
        Cada alerta guarda quién la generó, con qué dato y cómo se resolvió: es la trazabilidad
        que exige una auditoría de inventario.
      </p>

      {verDetalle && (
        <Dialogo titulo={verDetalle.titulo}
                 mensaje={`${verDetalle.articulo || ""}${verDetalle.bodega ? ` · ${verDetalle.bodega}` : ""}\n` +
                          `${verDetalle.persona || "—"} · ${verDetalle.hora}\n\n${verDetalle.detalle}`}
                 textoAceptar="Cerrar" onAceptar={() => setVerDetalle(null)}
                 onCancelar={() => setVerDetalle(null)} />
      )}
    </div>
  );
}
