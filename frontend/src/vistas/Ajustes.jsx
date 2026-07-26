import { useEffect, useState } from "react";
import { pedir } from "../api";
import Marco from "../Marco";

export default function Ajustes({ token, usuario }) {
  const [tab, setTab] = useState("config");
  const esAuditor = usuario?.perfil === "auditor";

  return (
    <Marco titulo="Ajustes  ·  configuración del sistema"
           chip={{ texto: esAuditor ? "ADMINISTRADORA" : "SOLO LECTURA",
                   tipo: esAuditor ? "azul" : "gris" }}>
      <div className="chips">
        <button className={`chip ${tab === "config" ? "azul" : ""}`}
                onClick={() => setTab("config")}>Configuración</button>
        {esAuditor && (
          <>
            <button className={`chip ${tab === "usuarios" ? "azul" : ""}`}
                    onClick={() => setTab("usuarios")}>Gestión de usuarios</button>
            <button className={`chip ${tab === "traza" ? "azul" : ""}`}
                    onClick={() => setTab("traza")}>Registro de trazabilidad</button>
          </>
        )}
      </div>

      {tab === "config" && <TabConfig token={token} esAuditor={esAuditor} />}
      {tab === "usuarios" && esAuditor && <TabUsuarios token={token} />}
      {tab === "traza" && esAuditor && <TabTraza token={token} />}
    </Marco>
  );
}

/* ── Interruptor simple, sin librería ── */
function Interruptor({ activo, onChange, disabled }) {
  return (
    <button
      onClick={() => !disabled && onChange(!activo)}
      disabled={disabled}
      style={{
        width: 44, height: 24, borderRadius: 14, padding: 2,
        background: activo ? "var(--verde)" : "#C3CAD6",
        display: "flex", justifyContent: activo ? "flex-end" : "flex-start",
        opacity: disabled ? 0.6 : 1, cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff" }} />
    </button>
  );
}

function TabConfig({ token, esAuditor }) {
  const [cfg, setCfg] = useState(null);
  const [umbral, setUmbral] = useState(50);
  const [offline, setOffline] = useState(true);
  const [msg, setMsg] = useState("");

  function cargar() {
    pedir("/api/ajustes", {}, token).then((c) => {
      setCfg(c); setUmbral(c.umbral); setOffline(c.offline);
    }).catch(() => {});
  }
  useEffect(cargar, [token]);

  async function guardar() {
    try {
      await pedir("/api/ajustes", {
        method: "PUT", body: JSON.stringify({ umbral, offline }),
      }, token);
      setMsg("Configuración guardada.");
      cargar();
    } catch (e) { setMsg(e.message); }
  }

  if (!cfg) return <p className="cargando">Cargando…</p>;

  return (
    <>
      <div className="card">
        <h3>Validación de datos</h3>
        <table>
          <tbody>
            <tr>
              <td>Umbral de anomalía (el «9 contra 90»)</td>
              <td style={{ width: 140 }}>
                {esAuditor ? (
                  <input type="number" min="1" max="500" value={umbral}
                         onChange={(e) => setUmbral(Number(e.target.value))}
                         style={{ width: 80, padding: "6px 10px",
                                  border: "1px solid var(--borde)", borderRadius: 8 }} />
                ) : <b>{cfg.umbral} %</b>}
                {esAuditor && " %"}
              </td>
            </tr>
            <tr><td>Bloquear cantidades negativas</td>
              <td><Interruptor activo disabled onChange={() => {}} /></td></tr>
            <tr><td>Exigir confirmación en alertas</td>
              <td><Interruptor activo disabled onChange={() => {}} /></td></tr>
            <tr><td>Permitir crear productos pendientes</td>
              <td><Interruptor activo disabled onChange={() => {}} /></td></tr>
          </tbody>
        </table>
        <p className="pista" style={{ marginTop: 8 }}>
          Las reglas fijas del reto (bloquear negativos, exigir confirmación) no se
          pueden desactivar: son la garantía de integridad de la toma.
        </p>
      </div>

      <div className="card">
        <h3>Conexión y sincronización</h3>
        <table>
          <tbody>
            <tr><td>Modo sin conexión</td>
              <td><Interruptor activo={offline} onChange={setOffline} disabled={!esAuditor} /></td></tr>
            <tr><td>Refresco del tablero</td><td><b>tiempo real</b></td></tr>
            <tr><td>Refresco de Power BI</td><td><b>{cfg.refresco_pbi}</b></td></tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Administración</h3>
        <table>
          <tbody>
            <tr><td>Usuarios activos</td><td><b>{cfg.usuarios_activos}</b></td></tr>
          </tbody>
        </table>
        <h3 style={{ marginTop: 18 }}>Acerca de CuentaVoz</h3>
        <table>
          <tbody>
            <tr><td>Versión</td><td><b>{cfg.version}</b></td></tr>
            <tr><td>Modelo del agente</td><td><b>{cfg.modelo}</b></td></tr>
            <tr><td>Idioma del reconocimiento</td><td><b>{cfg.idioma_voz}</b></td></tr>
          </tbody>
        </table>
        {esAuditor && (
          <div className="grilla-botones">
            <button className="btn" onClick={guardar}>Guardar configuración</button>
            <button className="btn borde" onClick={cargar}>Restaurar valores</button>
          </div>
        )}
        {msg && <p className="msg-ok">{msg}</p>}
      </div>
    </>
  );
}

function TabUsuarios({ token }) {
  const [usuarios, setUsuarios] = useState([]);
  const [bodegas, setBodegas] = useState([]);
  const [msg, setMsg] = useState("");
  const [nuevo, setNuevo] = useState(null);
  const [asignando, setAsignando] = useState(null);   // usuario al que se le estan marcando bodegas
  const [marcadas, setMarcadas] = useState(new Set());

  function cargar() {
    pedir("/api/usuarios", {}, token).then(setUsuarios).catch(() => {});
    pedir("/api/bodegas", {}, token).then(setBodegas).catch(() => {});
  }
  useEffect(cargar, [token]);

  async function crear() {
    if (!nuevo?.nombre?.trim()) return;
    try {
      await pedir("/api/usuarios", {
        method: "POST",
        body: JSON.stringify({ nombre: nuevo.nombre, perfil: nuevo.perfil || "auxiliar",
                               correo: nuevo.correo || "" }),
      }, token);
      setMsg(`Usuario ${nuevo.nombre} creado con PIN 123456.`);
      setNuevo(null);
      cargar();
    } catch (e) { setMsg(e.message); }
  }

  function alternarBodega(id) {
    setMarcadas((prev) => {
      const nueva = new Set(prev);
      nueva.has(id) ? nueva.delete(id) : nueva.add(id);
      return nueva;
    });
  }

  async function guardarAsignacion() {
    const u = asignando;
    const ids = [...marcadas];
    setAsignando(null);
    try {
      await pedir(`/api/usuarios/${u.id}/bodegas`, {
        method: "PUT", body: JSON.stringify({ bodega_ids: ids }),
      }, token);
      setMsg(`${ids.length} bodegas asignadas a ${u.nombre}.`);
      cargar();
    } catch (e) { setMsg(e.message); }
  }

  return (
    <div className="card">
      <h3>Gestión de usuarios ({usuarios.length})</h3>
      {msg && <p className="msg-ok">{msg}</p>}
      <table>
        <thead><tr><th>Persona</th><th>Perfil</th><th>Bodegas asignadas</th>
                    <th>Correo</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {usuarios.map((u) => (
            <tr key={u.id}>
              <td style={{ textTransform: "capitalize" }}>{u.nombre}</td>
              <td>{u.perfil === "auditor" ? "Administrador" : "Auxiliar"}</td>
              <td>{u.bodegas_asignadas}</td>
              <td>{u.correo || "—"}</td>
              <td style={{ color: u.activo ? "var(--verde)" : "var(--grafito)", fontWeight: 700 }}>
                {u.activo ? "Activo" : "Inactivo"}
              </td>
              <td>
                {u.perfil === "auxiliar" && (
                  <button className="btn borde" style={{ padding: "4px 10px", minHeight: 0 }}
                          onClick={() => { setAsignando(u); setMarcadas(new Set()); }}>
                    Asignar bodegas
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {nuevo ? (
        <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input placeholder="nombre de usuario" value={nuevo.nombre || ""}
                 onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
                 style={{ padding: "10px 12px", border: "1px solid var(--borde)", borderRadius: 10 }} />
          <input placeholder="correo (opcional)" value={nuevo.correo || ""}
                 onChange={(e) => setNuevo({ ...nuevo, correo: e.target.value })}
                 style={{ padding: "10px 12px", border: "1px solid var(--borde)", borderRadius: 10 }} />
          <select value={nuevo.perfil || "auxiliar"}
                  onChange={(e) => setNuevo({ ...nuevo, perfil: e.target.value })}
                  style={{ padding: "10px 12px", border: "1px solid var(--borde)", borderRadius: 10 }}>
            <option value="auxiliar">Auxiliar</option>
            <option value="auditor">Administrador</option>
          </select>
          <button className="btn" onClick={crear}>Crear (PIN 123456)</button>
          <button className="btn gris" onClick={() => setNuevo(null)}>Cancelar</button>
        </div>
      ) : (
        <div className="grilla-botones">
          <button className="btn" onClick={() => setNuevo({})}>+ Nuevo usuario</button>
        </div>
      )}
      <p className="pista" style={{ marginTop: 10 }}>
        El auxiliar cuenta y crea; solo el administrador aprueba, audita y cierra.
      </p>

      {asignando && (
        <div className="overlay" onClick={() => setAsignando(null)}>
          <div className="modal" style={{ maxWidth: 520, textAlign: "left" }}
               onClick={(e) => e.stopPropagation()}>
            <h2 style={{ textTransform: "capitalize" }}>Bodegas para {asignando.nombre}</h2>
            <p className="pista">Marque las bodegas que va a poder contar esta persona.</p>
            <div style={{ maxHeight: 320, overflowY: "auto", margin: "12px 0",
                          border: "1px solid var(--borde)", borderRadius: 10, padding: 8 }}>
              {bodegas.map((b) => (
                <label key={b.id} style={{ display: "flex", alignItems: "center", gap: 10,
                                            padding: "7px 6px", fontSize: ".9rem" }}>
                  <input type="checkbox" checked={marcadas.has(b.id)}
                         onChange={() => alternarBodega(b.id)} />
                  {b.bodega}
                </label>
              ))}
            </div>
            <p className="pista">{marcadas.size} bodegas marcadas</p>
            <div className="botones">
              <button className="btn borde" onClick={() => setAsignando(null)}>Cancelar</button>
              <button className="btn" onClick={guardarAsignacion}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabTraza({ token }) {
  const [traza, setTraza] = useState([]);
  const [persona, setPersona] = useState("");
  const [accion, setAccion] = useState("");

  function cargar() {
    const q = new URLSearchParams();
    if (persona) q.set("persona", persona);
    if (accion) q.set("accion", accion);
    pedir(`/api/trazabilidad?${q}`, {}, token).then(setTraza).catch(() => {});
  }
  useEffect(cargar, [token, persona, accion]);

  const acciones = ["", "INGRESO", "APERTURA", "CONTEO", "CORRECCION", "FIRMA",
                    "AUDITORIA", "CIERRE", "REAPERTURA", "APROBACION", "ALERTA",
                    "REPORTE", "PEDIDO", "LEGALIZACION", "AJUSTE", "USUARIO",
                    "ASIGNACION", "SEGURIDAD", "PERFIL", "SOPORTE"];

  return (
    <div className="card">
      <h3>Registro de trazabilidad ({traza.length} acciones)</h3>
      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <input placeholder="filtrar por persona…" value={persona}
               onChange={(e) => setPersona(e.target.value)}
               style={{ padding: "9px 12px", border: "1px solid var(--borde)", borderRadius: 10 }} />
        <select value={accion} onChange={(e) => setAccion(e.target.value)}
                style={{ padding: "9px 12px", border: "1px solid var(--borde)", borderRadius: 10 }}>
          {acciones.map((a) => <option key={a} value={a}>{a || "Todas las acciones"}</option>)}
        </select>
      </div>
      <p className="pista">
        Todo queda con persona, hora y dato. El registro no se puede editar ni borrar.
      </p>
      {traza.length === 0 ? (
        <p className="vacio">Sin acciones registradas todavía.</p>
      ) : (
        <table>
          <thead><tr><th>Hora</th><th>Persona</th><th>Acción</th><th>Detalle</th></tr></thead>
          <tbody>
            {traza.slice(0, 25).map((t) => (
              <tr key={t.id}>
                <td>{t.hora}</td>
                <td style={{ textTransform: "capitalize" }}>{t.persona}</td>
                <td><span className={`chip ${t.tipo === "alerta" ? "oro"
                      : t.tipo === "ok" ? "verde" : ""}`}>{t.accion}</span></td>
                <td>{t.detalle}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="card" style={{ marginTop: 14, background: "var(--azul-claro)" }}>
        <h3>Por qué el registro es inmutable</h3>
        <p style={{ fontSize: ".87rem" }}>
          Una corrección no borra el valor anterior: crea un registro nuevo que apunta
          al original (campo <code>corrige_a</code> de la tabla Conteo). Así, si alguien
          pregunta «¿quién cambió este dato y por qué?», la respuesta está en el
          sistema y no en la memoria de nadie.
        </p>
      </div>
    </div>
  );
}
