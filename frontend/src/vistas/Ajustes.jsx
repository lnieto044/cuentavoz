import { useEffect, useState } from "react";
import { pedir, descargarReporte } from "../api";
import { escuchar, hablar, quitarTildes } from "../voz";
import Marco from "../Marco";
import AsistenteVoz from "../AsistenteVoz";
import Icono from "../Iconos";

const _EJEMPLOS_POR_PESTANA = {
  config: [
    "activa el modo sin conexión",
    "desactiva el modo sin conexión",
  ],
  usuarios: [
    "crea un usuario llamado Juan perfil auxiliar",
    "activa a Juan", "desactiva a Juan",
    "cambia el perfil de Juan a administrador",
    "asígnale la bodega Almacen General a Juan",
    "quítale la bodega Almacen General a Juan",
    "¿quién tiene la bodega Almacen General?",
    "¿cuántas bodegas sin asignar hay?",
    "muéstrame la asignación por bodega",
    "oculta la asignación por bodega",
  ],
  recetas: [
    "crea una receta llamada Sopa, rendimiento 4 porciones, con 2 kilos de papa",
    "agrega 300 gramos de cebolla a la receta Sopa",
    "quita el ingrediente cebolla de la receta Sopa",
    "cambia el rendimiento de la receta Sopa a 6 porciones",
    "agrega la preparación a la receta Sopa: pele las papas, sofría la cebolla, y cocine todo junto veinte minutos",
    "elimina la receta Sopa",
  ],
  traza: [
    "acciones de Luis hoy",
    "aprobaciones de esta semana",
    "exporta el registro de trazabilidad",
    "acciones por persona",
    "¿cuántas acciones tiene Luis?",
  ],
};

export default function Ajustes({ token, usuario, ir, tabInicial, recetaId, navSeq }) {
  const [tab, setTab] = useState(tabInicial || "config");
  const esAuditor = usuario?.perfil === "auditor";
  // "llévame a gestión de usuarios" dicho desde esta MISMA pantalla no
  // remonta el componente (sigue siendo "ajustes"), así que el useState
  // de arriba no vuelve a leer tabInicial - sin esto, el agente decía
  // "vamos a Gestión de usuarios" y la pestaña se quedaba en la que ya
  // estaba. navSeq (sube en cada ir()) también va en la dependencia: sin
  // él, pedir la MISMA pestaña dos veces seguidas (con un clic manual a
  // otra en el medio) no hacía nada, porque tabInicial no cambiaba.
  useEffect(() => { if (tabInicial) setTab(tabInicial); }, [tabInicial, navSeq]);

  return (
    <Marco titulo="Ajustes  ·  configuración del sistema"
           chip={{ texto: esAuditor ? "ADMINISTRADORA" : "SOLO LECTURA",
                   tipo: esAuditor ? "azul" : "gris" }}>
      <AsistenteVoz token={token} vista="ajustes" ir={ir}
                    placeholder="¿cuál es el umbral de anomalía?, lléveme a reportes…"
                    ejemplos={_EJEMPLOS_POR_PESTANA[tab]}
                    alActualizar={() => window.dispatchEvent(new Event("cuentavoz:ajustes-actualizados"))} />
      <div className="chips">
        <button className={`chip ${tab === "config" ? "azul" : ""}`}
                onClick={() => setTab("config")}>Configuración</button>
        {esAuditor && (
          <>
            <button className={`chip ${tab === "usuarios" ? "azul" : ""}`}
                    onClick={() => setTab("usuarios")}>Gestión de usuarios</button>
            <button className={`chip ${tab === "recetas" ? "azul" : ""}`}
                    onClick={() => setTab("recetas")}>Recetas</button>
            <button className={`chip ${tab === "traza" ? "azul" : ""}`}
                    onClick={() => setTab("traza")}>Registro de trazabilidad</button>
          </>
        )}
      </div>

      {tab === "config" && <TabConfig token={token} esAuditor={esAuditor} />}
      {tab === "usuarios" && esAuditor && <TabUsuarios token={token} usuario={usuario} />}
      {tab === "recetas" && esAuditor && <TabRecetas token={token} recetaInicial={recetaId} />}
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
  // El agente de "Pregúntele al agente" (arriba, fuera de esta pestaña)
  // puede activar/desactivar el modo sin conexión por voz - cuando lo
  // hace, avisa con este evento para que esta pestaña vuelva a leer el
  // valor real en vez de quedarse mostrando el de antes.
  useEffect(() => {
    window.addEventListener("cuentavoz:ajustes-actualizados", cargar);
    return () => window.removeEventListener("cuentavoz:ajustes-actualizados", cargar);
  }, [token]);

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
      <div className="kpis">
        <div className="kpi">
          <div className="kpi-cabeza">
            <span className="icono-kpi">👥</span>
            <small>Usuarios activos</small>
          </div>
          <b>{cfg.usuarios_activos}</b><i>con acceso al sistema</i>
        </div>
        <div className={cfg.aprobaciones_pendientes > 0 ? "kpi oro" : "kpi verde"}>
          <div className="kpi-cabeza">
            <span className="icono-kpi">✅</span>
            <small>Aprobaciones pendientes</small>
          </div>
          <b>{cfg.aprobaciones_pendientes}</b>
          <i>{cfg.aprobaciones_pendientes > 0 ? "por revisar en Auditoría" : "todo al día"}</i>
        </div>
        <div className={offline ? "kpi verde" : "kpi"}>
          <div className="kpi-cabeza">
            <span className="icono-kpi">🌐</span>
            <small>Modo sin conexión</small>
          </div>
          <b>{offline ? "Activo" : "Inactivo"}</b><i>refresco del tablero en tiempo real</i>
        </div>
      </div>
      {/* La versión/modelo ya se ve completa en la tarjeta "Acerca de
          CuentaVoz" de abajo (con base de datos e idioma también) - un KPI
          arriba con solo dos de esos cuatro datos era la misma información
          dos veces, no una tarjeta nueva. */}

      <div className="dos-columnas" style={{ gap: 16 }}>
        <div className="card">
          <h3><span className="icono-kpi" style={{ marginRight: 8 }}>🔒</span>Validación de datos</h3>
          <table>
            <tbody>
              <tr>
                <td>Umbral de anomalía</td>
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
          <h3><span className="icono-kpi" style={{ marginRight: 8 }}>🌐</span>Conexión y sincronización</h3>
          <table>
            <tbody>
              <tr><td>Modo sin conexión</td>
                <td><Interruptor activo={offline} onChange={setOffline} disabled={!esAuditor} /></td></tr>
              <tr><td>Refresco del tablero</td><td><b>tiempo real</b></td></tr>
            </tbody>
          </table>

          <h3 style={{ marginTop: 20 }}>
            <span className="icono-kpi" style={{ marginRight: 8 }}>🛡️</span>Acerca de CuentaVoz
          </h3>
          <table>
            <tbody>
              <tr><td>Versión</td><td><b>{cfg.version}</b></td></tr>
              <tr><td>Modelo del agente</td><td><b>{cfg.modelo}</b></td></tr>
              <tr><td>Base de datos</td><td><b>{cfg.base_datos}</b></td></tr>
              <tr><td>Idioma del reconocimiento</td><td><b>{cfg.idioma_voz}</b></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {esAuditor && (
        <div className="grilla-botones" style={{ marginTop: 4 }}>
          <button className="btn" onClick={guardar}
                  style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Icono nombre="aprobar" tam={18} />
            Guardar configuración
          </button>
          <button className="btn borde" onClick={cargar}
                  style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Icono nombre="refrescar" tam={18} />
            Restaurar valores
          </button>
        </div>
      )}
      {msg && <p className="msg-ok">{msg}</p>}
    </>
  );
}

function TabUsuarios({ token, usuario }) {
  const [usuarios, setUsuarios] = useState([]);
  const [bodegas, setBodegas] = useState([]);
  const [msg, setMsg] = useState("");
  const [nuevo, setNuevo] = useState(null);
  const [asignando, setAsignando] = useState(null);   // usuario al que se le estan marcando bodegas
  const [marcadas, setMarcadas] = useState(new Set());
  const [cobertura, setCobertura] = useState(null);
  const [verCobertura, setVerCobertura] = useState(false);
  const [editando, setEditando] = useState(null);     // usuario que se esta editando (correo/rol)
  const [filtro, setFiltro] = useState("todos");

  function cargar() {
    pedir("/api/usuarios", {}, token).then(setUsuarios).catch(() => {});
    pedir("/api/bodegas", {}, token).then(setBodegas).catch(() => {});
    if (verCobertura) cargarCobertura();
  }
  useEffect(cargar, [token]);
  // El agente ("Pregúntele al agente", arriba de las pestañas) puede
  // activar/desactivar a alguien por voz - cuando lo hace, avisa con
  // este evento para que esta lista refleje el cambio sin recargar.
  useEffect(() => {
    window.addEventListener("cuentavoz:ajustes-actualizados", cargar);
    return () => window.removeEventListener("cuentavoz:ajustes-actualizados", cargar);
  }, [token]);

  function cargarCobertura() {
    pedir("/api/bodegas/asignaciones", {}, token).then(setCobertura).catch(() => {});
  }

  // "muéstrame/oculta la asignación por bodega" por voz - mismo botón
  // «Ver/Ocultar asignación por bodega», solo que disparado por el
  // agente en vez del clic.
  useEffect(() => {
    const mostrar = () => { setVerCobertura(true); cargarCobertura(); };
    const ocultar = () => setVerCobertura(false);
    window.addEventListener("cuentavoz:accion:mostrar_cobertura", mostrar);
    window.addEventListener("cuentavoz:accion:ocultar_cobertura", ocultar);
    return () => {
      window.removeEventListener("cuentavoz:accion:mostrar_cobertura", mostrar);
      window.removeEventListener("cuentavoz:accion:ocultar_cobertura", ocultar);
    };
  }, [token]);

  async function crear() {
    if (!nuevo?.nombre?.trim()) return;
    try {
      // sin "pin" en el body: el backend genera uno temporal distinto
      // para cada persona en vez de reusar siempre la misma clave.
      const r = await pedir("/api/usuarios", {
        method: "POST",
        body: JSON.stringify({ nombre: nuevo.nombre, perfil: nuevo.perfil || "auxiliar",
                               correo: nuevo.correo || "" }),
      }, token);
      setMsg(`Usuario ${nuevo.nombre} creado. PIN temporal: ${r.pin_temporal} `
             + "(cambíelo al primer ingreso, en Mi perfil).");
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

  async function guardarEdicion() {
    const u = editando;
    setEditando(null);
    try {
      await pedir(`/api/usuarios/${u.id}`, {
        method: "PUT", body: JSON.stringify({ correo: u.correo, perfil: u.perfil }),
      }, token);
      setMsg(`${u.nombre} actualizado.`);
      cargar();
    } catch (e) { setMsg(e.message); }
  }

  async function alternarActivo(persona) {
    try {
      await pedir(`/api/usuarios/${persona.id}`, {
        method: "PUT", body: JSON.stringify({ activo: !persona.activo }),
      }, token);
      setMsg(`${persona.nombre} ${persona.activo ? "desactivado" : "activado"}.`);
      cargar();
    } catch (e) { setMsg(e.message); }
  }

  const nAux = usuarios.filter((u) => u.perfil === "auxiliar").length;
  const nAdmin = usuarios.filter((u) => u.perfil === "auditor").length;
  const nInactivos = usuarios.filter((u) => !u.activo).length;
  const usuariosFiltrados = usuarios.filter((u) => {
    if (filtro === "auxiliar") return u.perfil === "auxiliar";
    if (filtro === "auditor") return u.perfil === "auditor";
    if (filtro === "inactivo") return !u.activo;
    return true;
  });

  return (
    <div className="card">
      <h3><span className="icono-kpi" style={{ marginRight: 8 }}>👥</span>
        Gestión de usuarios ({usuarios.length})</h3>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                    marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <div className="chips" style={{ marginBottom: 0 }}>
          <button className={`chip ${filtro === "auxiliar" ? "azul" : ""}`}
                  onClick={() => setFiltro(filtro === "auxiliar" ? "todos" : "auxiliar")}>
            {nAux} auxiliares
          </button>
          <button className={`chip ${filtro === "auditor" ? "azul" : ""}`}
                  onClick={() => setFiltro(filtro === "auditor" ? "todos" : "auditor")}>
            {nAdmin} administradores
          </button>
          <button className={`chip ${filtro === "inactivo" ? "azul" : ""}`}
                  onClick={() => setFiltro(filtro === "inactivo" ? "todos" : "inactivo")}>
            {nInactivos} inactivos
          </button>
        </div>
        {!nuevo && (
          <button className="btn" onClick={() => setNuevo({})}>+ Nuevo usuario</button>
        )}
      </div>
      {msg && <p className="msg-ok">{msg}</p>}
      <table>
        <thead><tr><th>Persona</th><th>Perfil</th><th>Bodegas asignadas</th>
                    <th>Último acceso</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {usuariosFiltrados.map((u) => (
            <tr key={u.id}>
              <td style={{ textTransform: "capitalize", display: "flex", alignItems: "center", gap: 8 }}>
                <span className="avatar-chico">{u.nombre[0]?.toUpperCase()}</span>
                {u.nombre}
              </td>
              <td>{u.perfil === "auditor" ? "Administrador" : "Auxiliar"}</td>
              <td>{u.bodegas_asignadas}</td>
              <td>{u.ultimo_acceso ? u.ultimo_acceso.slice(5).replace("-", "/") : "nunca"}</td>
              <td style={{ color: u.activo ? "var(--verde)" : "var(--grafito)", fontWeight: 700 }}>
                {u.activo ? "Activo" : "Inactivo"}
              </td>
              <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="btn borde" style={{ padding: "4px 10px", minHeight: 0 }}
                        onClick={async () => {
                          setAsignando(u);
                          const propias = await pedir(`/api/usuarios/${u.id}/bodegas`, {}, token).catch(() => []);
                          setMarcadas(new Set(propias));
                        }}>
                  Asignar bodegas
                </button>
                <button className="btn borde" style={{ padding: "4px 10px", minHeight: 0 }}
                        onClick={() => setEditando({ id: u.id, nombre: u.nombre,
                                                     correo: u.correo, perfil: u.perfil })}>
                  Editar
                </button>
                <button className={`btn ${u.activo ? "gris" : "verde"}`}
                        style={{ padding: "4px 10px", minHeight: 0 }}
                        disabled={u.id === usuario?.id}
                        title={u.id === usuario?.id ? "No puede desactivar su propia cuenta" : ""}
                        onClick={() => alternarActivo(u)}>
                  {u.activo ? "Desactivar" : "Activar"}
                </button>
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
          <button className="btn" onClick={crear}>Crear (PIN StockXperts)</button>
          <button className="btn gris" onClick={() => setNuevo(null)}>Cancelar</button>
        </div>
      ) : null}

      <div className="grilla-botones" style={{ marginTop: 14 }}>
        <button className="btn borde"
                onClick={() => {
                  const abrir = !verCobertura;
                  setVerCobertura(abrir);
                  if (abrir && !cobertura) cargarCobertura();
                }}>
          {verCobertura ? "Ocultar asignación por bodega" : "Ver asignación por bodega"}
        </button>
      </div>

      {verCobertura && (
        <div style={{ marginTop: 14 }}>
          <h3>Quién tiene cada bodega</h3>
          <p className="pista" style={{ marginBottom: 10 }}>
            Para repartir 54 bodegas entre varios auxiliares sin dejar ninguna sin dueño
            ni asignarla dos veces por error.
          </p>
          {cobertura === null ? (
            <p className="cargando">Cargando…</p>
          ) : (
            <div style={{ maxHeight: 420, overflowY: "auto" }}>
              <table>
                <thead><tr><th>Bodega</th><th>Asignada a</th></tr></thead>
                <tbody>
                  {cobertura.map((b) => (
                    <tr key={b.id}>
                      <td>{b.bodega}</td>
                      <td>
                        {b.asignados.length === 0 ? (
                          <span className="chip oro">Sin asignar</span>
                        ) : (
                          b.asignados.map((p) => (
                            <span key={p.id} className={`chip ${p.perfil === "auditor" ? "azul" : "gris"}`}
                                  style={{ marginRight: 6, textTransform: "capitalize" }}>
                              {p.nombre}
                            </span>
                          ))
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ background: "var(--fondo)", marginTop: 14 }}>
        <h3>Qué puede hacer cada perfil</h3>
        <table>
          <tbody>
            <tr>
              <td>✅ Contar por voz y corregir sus propios registros</td>
              <td style={{ textAlign: "right", color: "var(--verde)", fontWeight: 700 }}>
                Auxiliar y administrador
              </td>
            </tr>
            <tr>
              <td>✅ Crear productos y bodegas (quedan pendientes)</td>
              <td style={{ textAlign: "right", color: "var(--verde)", fontWeight: 700 }}>
                Auxiliar y administrador
              </td>
            </tr>
            <tr>
              <td>✅ Aprobar creaciones, auditar y cerrar bodegas</td>
              <td style={{ textAlign: "right", color: "var(--azul)", fontWeight: 700 }}>
                Solo administrador
              </td>
            </tr>
            <tr>
              <td>✅ Gestionar usuarios y cambiar los ajustes del sistema</td>
              <td style={{ textAlign: "right", color: "var(--azul)", fontWeight: 700 }}>
                Solo administrador
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {editando && (
        <div className="overlay" onClick={() => setEditando(null)}>
          <div className="modal" style={{ maxWidth: 420, textAlign: "left" }}
               onClick={(e) => e.stopPropagation()}>
            <h2 style={{ textTransform: "capitalize" }}>Editar a {editando.nombre}</h2>
            <label className="pista">Correo</label>
            <input value={editando.correo || ""}
                   onChange={(e) => setEditando({ ...editando, correo: e.target.value })}
                   style={{ width: "100%", padding: "10px 12px", marginTop: 6, marginBottom: 14,
                            border: "1px solid var(--borde)", borderRadius: 10 }} />
            <label className="pista">Perfil</label>
            <select value={editando.perfil}
                    onChange={(e) => setEditando({ ...editando, perfil: e.target.value })}
                    style={{ width: "100%", padding: "10px 12px", marginTop: 6,
                             border: "1px solid var(--borde)", borderRadius: 10 }}
                    disabled={editando.id === usuario?.id}>
              <option value="auxiliar">Auxiliar</option>
              <option value="auditor">Administrador</option>
            </select>
            {editando.id === usuario?.id && (
              <p className="pista" style={{ marginTop: 6 }}>
                No puede cambiar su propio rol desde aquí.
              </p>
            )}
            <div className="botones" style={{ marginTop: 18 }}>
              <button className="btn borde" onClick={() => setEditando(null)}>Cancelar</button>
              <button className="btn" onClick={guardarEdicion}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {asignando && (
        <div className="overlay" onClick={() => setAsignando(null)}>
          <div className="modal" style={{ maxWidth: 520, textAlign: "left" }}
               onClick={(e) => e.stopPropagation()}>
            <h2 style={{ textTransform: "capitalize" }}>Bodegas para {asignando.nombre}</h2>
            <p className="pista">
              {asignando.perfil === "auditor"
                ? "Marque las bodegas de las que esta persona es responsable como administradora (recuento ciego, cierre)."
                : "Marque las bodegas que va a poder contar esta persona."}
            </p>
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

function TabRecetas({ token, recetaInicial }) {
  const [recetas, setRecetas] = useState([]);
  const [catalogo, setCatalogo] = useState([]);
  const [msg, setMsg] = useState("");
  const [editando, setEditando] = useState(null);
  // { id: null|number, nombre, rendimiento, lineas: [{articulo_codigo, cantidad_por_porcion}] }
  const abrioInicial = useState(false);

  function cargar() {
    pedir("/api/recetas", {}, token).then(setRecetas).catch(() => {});
    pedir("/api/articulos/catalogo-ligero", {}, token).then(setCatalogo).catch(() => {});
  }
  useEffect(cargar, [token]);

  useEffect(() => {
    window.addEventListener("cuentavoz:ajustes-actualizados", cargar);
    return () => window.removeEventListener("cuentavoz:ajustes-actualizados", cargar);
  }, [token]);

  useEffect(() => {
    if (recetaInicial && recetas.length && !abrioInicial[0]) {
      abrioInicial[1](true);
      abrir(recetaInicial);
    }
  }, [recetaInicial, recetas]);

  async function abrir(id) {
    try {
      const r = await pedir(`/api/recetas/${id}`, {}, token);
      setEditando({
        id: r.id, nombre: r.nombre, rendimiento: r.rendimiento,
        preparacion: r.preparacion || "",
        lineas: r.lineas.map((l) => ({ articulo_codigo: l.articulo_codigo,
                                       cantidad_por_porcion: l.cantidad_por_porcion })),
      });
    } catch (e) { setMsg(e.message); }
  }

  function nueva() {
    setEditando({ id: null, nombre: "", rendimiento: 1, preparacion: "",
                 lineas: [{ articulo_codigo: "", cantidad_por_porcion: "" }] });
  }

  function actualizarLinea(i, campo, valor) {
    setEditando((e) => {
      const lineas = e.lineas.map((l, idx) => idx === i ? { ...l, [campo]: valor } : l);
      return { ...e, lineas };
    });
  }

  function agregarLinea() {
    setEditando((e) => ({ ...e, lineas: [...e.lineas, { articulo_codigo: "", cantidad_por_porcion: "" }] }));
  }

  function quitarLinea(i) {
    setEditando((e) => ({ ...e, lineas: e.lineas.filter((_, idx) => idx !== i) }));
  }

  async function guardar() {
    const cuerpo = {
      nombre: editando.nombre.trim(),
      rendimiento: Number(editando.rendimiento) || 1,
      preparacion: (editando.preparacion || "").trim(),
      ingredientes: editando.lineas
        .filter((l) => l.articulo_codigo && l.cantidad_por_porcion)
        .map((l) => ({ articulo_codigo: l.articulo_codigo,
                       cantidad_por_porcion: Number(l.cantidad_por_porcion) })),
    };
    if (!cuerpo.nombre) { setMsg("Póngale un nombre a la receta."); return; }
    try {
      if (editando.id) {
        await pedir(`/api/recetas/${editando.id}`, { method: "PUT", body: JSON.stringify(cuerpo) }, token);
        setMsg(`Receta «${cuerpo.nombre}» actualizada.`);
      } else {
        await pedir("/api/recetas", { method: "POST", body: JSON.stringify(cuerpo) }, token);
        setMsg(`Receta «${cuerpo.nombre}» creada.`);
      }
      setEditando(null);
      cargar();
    } catch (e) { setMsg(e.message); }
  }

  async function eliminar(r) {
    if (!window.confirm(`¿Eliminar la receta «${r.nombre}»? Esta acción no se puede deshacer.`)) return;
    try {
      await pedir(`/api/recetas/${r.id}`, { method: "DELETE" }, token);
      setMsg(`Receta «${r.nombre}» eliminada.`);
      cargar();
    } catch (e) { setMsg(e.message); }
  }

  return (
    <div className="card">
      <h3>
        <span className="icono-kpi" style={{ marginRight: 8 }}>🍲</span>
        Recetas ({recetas.length})
      </h3>
      <p className="pista">
        Las porciones que dicte el chef se calculan sobre estas recetas: cantidad por
        porción × porciones, menos lo que ya haya en la bodega. Aquí se crean, editan
        y borran — CuentaVoz sí gestiona el catálogo de recetas y menús.
      </p>
      {msg && <p className="msg-ok">{msg}</p>}
      {recetas.length === 0 ? (
        <p className="vacio">Todavía no hay recetas creadas.</p>
      ) : (
        <table>
          <thead><tr><th>Receta</th><th>Rendimiento</th><th>Ingredientes</th><th></th></tr></thead>
          <tbody>
            {recetas.map((r) => (
              <tr key={r.id}>
                <td style={{ textTransform: "capitalize" }}>{r.nombre}</td>
                <td>{r.rendimiento} porción</td>
                <td>{r.ingredientes}</td>
                <td style={{ display: "flex", gap: 6 }}>
                  <button className="btn borde" style={{ padding: "4px 10px", minHeight: 0 }}
                          onClick={() => abrir(r.id)}>Editar</button>
                  <button className="btn gris" style={{ padding: "4px 10px", minHeight: 0 }}
                          onClick={() => eliminar(r)}>Eliminar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="grilla-botones" style={{ marginTop: 14 }}>
        <button className="btn" onClick={nueva}>+ Nueva receta</button>
      </div>

      {editando && (
        <div className="overlay" onClick={() => setEditando(null)}>
          <div className="modal" style={{ maxWidth: 660, textAlign: "left", maxHeight: "88vh",
                                          overflowY: "auto" }}
               onClick={(e) => e.stopPropagation()}>
            <h2>{editando.id ? `Editar ${editando.nombre}` : "Nueva receta"}</h2>
            <p className="pista" style={{ marginTop: -6, marginBottom: 18 }}>
              Cada campo queda disponible de inmediato para calcular pedidos por voz.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 20 }}>
              <div>
                <label className="pista" style={{ display: "block", marginBottom: 6 }}>
                  Nombre del plato
                </label>
                <input value={editando.nombre}
                       onChange={(e) => setEditando({ ...editando, nombre: e.target.value })}
                       placeholder="ej. ajiaco"
                       style={{ width: "100%", padding: "10px 12px",
                                border: "1px solid var(--borde)", borderRadius: 10 }} />
              </div>
              <div>
                <label className="pista" style={{ display: "block", marginBottom: 6 }}>
                  Rendimiento (porciones)
                </label>
                <input type="number" min="1" value={editando.rendimiento}
                       onChange={(e) => setEditando({ ...editando, rendimiento: e.target.value })}
                       style={{ width: "100%", padding: "10px 12px",
                                border: "1px solid var(--borde)", borderRadius: 10 }} />
              </div>
            </div>

            <div style={{ background: "var(--fondo)", borderRadius: 12, padding: 16, marginBottom: 18 }}>
              <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: ".95rem", color: "var(--azul)" }}>
                🧂 Ingredientes
              </h3>
              <p className="pista" style={{ marginBottom: 12 }}>Cantidad por cada porción de la receta.</p>
              <div style={{ maxHeight: 280, overflowY: "auto" }}>
                {editando.lineas.map((l, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <select value={l.articulo_codigo}
                            onChange={(e) => actualizarLinea(i, "articulo_codigo", e.target.value)}
                            style={{ flex: 1, padding: "8px 10px", border: "1px solid var(--borde)",
                                     borderRadius: 8, background: "#fff" }}>
                      <option value="">— elija un artículo del catálogo —</option>
                      {catalogo.map((a) => (
                        <option key={a.codigo} value={a.codigo}>{a.nombre} ({a.unidad})</option>
                      ))}
                    </select>
                    <input type="number" step="0.001" min="0" placeholder="cantidad"
                           value={l.cantidad_por_porcion}
                           onChange={(e) => actualizarLinea(i, "cantidad_por_porcion", e.target.value)}
                           style={{ width: 100, padding: "8px 10px", border: "1px solid var(--borde)",
                                    borderRadius: 8, background: "#fff" }} />
                    <button className="btn gris" style={{ padding: "6px 10px", minHeight: 0, flex: "none" }}
                            onClick={() => quitarLinea(i)}>✕</button>
                  </div>
                ))}
              </div>
              <button className="btn borde" style={{ marginTop: 4 }} onClick={agregarLinea}>
                + Agregar ingrediente
              </button>
            </div>

            <div style={{ background: "var(--fondo)", borderRadius: 12, padding: 16, marginBottom: 4 }}>
              <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: ".95rem", color: "var(--azul)" }}>
                📋 Preparación paso a paso
              </h3>
              <p className="pista" style={{ marginBottom: 12 }}>
                Opcional: lo que ve el auxiliar al consultar esta receta desde Pedidos.
              </p>
              <textarea value={editando.preparacion}
                        onChange={(e) => setEditando({ ...editando, preparacion: e.target.value })}
                        placeholder="1. Pele y pique las papas...&#10;2. Sofría la cebolla...&#10;3. ..."
                        rows={5}
                        style={{ width: "100%", padding: "10px 12px",
                                 border: "1px solid var(--borde)", borderRadius: 10,
                                 fontFamily: "inherit", resize: "vertical", background: "#fff" }} />
            </div>

            <div className="botones" style={{ marginTop: 20 }}>
              <button className="btn borde" onClick={() => setEditando(null)}>Cancelar</button>
              <button className="btn" onClick={guardar}>Guardar receta</button>
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
  const [rango, setRango] = useState("hoy");
  const [msg, setMsg] = useState("");
  const [todasPersonas, setTodasPersonas] = useState([]);
  const [escuchandoFiltro, setEscuchandoFiltro] = useState(false);

  function cargar() {
    const q = new URLSearchParams();
    if (persona) q.set("persona", persona);
    if (accion) q.set("accion", accion);
    if (rango) q.set("rango", rango);
    pedir(`/api/trazabilidad?${q}`, {}, token).then(setTraza).catch(() => {});
  }
  useEffect(cargar, [token, persona, accion, rango]);
  // Lista COMPLETA de personas (no solo las que aparecen en el filtro
  // actual) para que el filtro por voz reconozca un nombre aunque el
  // rango/persona ya aplicado lo haya dejado fuera de "traza".
  useEffect(() => {
    pedir("/api/usuarios", {}, token).then((us) => setTodasPersonas(us.map((x) => x.nombre)))
      .catch(() => {});
  }, [token]);

  const acciones = ["", "INGRESO", "APERTURA", "CONTEO", "CORRECCION", "CREACION",
                    "FIRMA", "AUDITORIA", "CIERRE", "REAPERTURA", "APROBACION", "ALERTA",
                    "REPORTE", "PEDIDO", "RECETA", "LEGALIZACION", "AJUSTE", "USUARIO",
                    "ASIGNACION", "SEGURIDAD", "PERFIL", "SOPORTE"];
  const personas = [...new Set(traza.map((t) => t.persona))].sort();

  // "Muéstrame las acciones de Luis hoy" - determinístico y local, sin
  // pasar por el agente general: solo reconoce palabras contra las
  // listas que YA existen en esta pantalla (rango, tipos de acción,
  // personas), así que no hace falta ninguna llamada a Gemini para
  // filtrar. Combina lo dicho con lo que YA estaba marcado (decir solo
  // "esta semana" no borra la persona/acción que ya tenía puesta) -
  // por eso lee rango/persona/accion actuales como punto de partida en
  // vez de siempre resetear a "todos".
  function _resolverFiltroVoz(texto) {
    const t = quitarTildes(texto.toLowerCase());
    let coincidio = false;
    let nuevoRango = rango, nuevaAccion = accion, nuevaPersona = persona;
    if (/\btodo\b/.test(t)) { nuevoRango = ""; coincidio = true; }
    else if (/\bhoy\b/.test(t)) { nuevoRango = "hoy"; coincidio = true; }
    else if (/semana/.test(t)) { nuevoRango = "semana"; coincidio = true; }
    else if (/\bmes\b/.test(t)) { nuevoRango = "mes"; coincidio = true; }

    if (/todas las acciones/.test(t)) { nuevaAccion = ""; coincidio = true; }
    else {
      const accionEncontrada = acciones.find((a) => a && t.includes(a.toLowerCase()));
      if (accionEncontrada) { nuevaAccion = accionEncontrada; coincidio = true; }
    }

    if (/todas las personas/.test(t)) { nuevaPersona = ""; coincidio = true; }
    else {
      const personaEncontrada = todasPersonas.find(
        (p) => p && t.includes(quitarTildes(p.toLowerCase())));
      if (personaEncontrada) { nuevaPersona = personaEncontrada; coincidio = true; }
    }
    return coincidio ? { rango: nuevoRango, persona: nuevaPersona, accion: nuevaAccion } : null;
  }

  // Aplica el filtro resuelto Y dice el resultado real (cuántas filas
  // encontró), no un "listo, apliqué el filtro" que no cuenta nada -
  // pedido explícito del usuario. Trae los datos de una (en vez de
  // esperar a que el useEffect de cargar() reaccione al cambio de
  // estado) para poder anunciar la cifra exacta apenas llega.
  async function _aplicarFiltroYAnunciar(resuelto) {
    const { rango: r, persona: p, accion: a } = resuelto;
    setRango(r); setPersona(p); setAccion(a);
    setMsg("");
    try {
      const q = new URLSearchParams();
      if (p) q.set("persona", p);
      if (a) q.set("accion", a);
      if (r) q.set("rango", r);
      const filas = await pedir(`/api/trazabilidad?${q}`, {}, token);
      setTraza(filas);
      const partes = [];
      if (a) partes.push(`de ${a.toLowerCase()}`);
      if (p) partes.push(`de ${p}`);
      const etiquetaRango = r === "hoy" ? "hoy" : r === "semana" ? "en la última semana"
                           : r === "mes" ? "en el último mes" : "en total";
      const texto = `Encontré ${filas.length} acciones${partes.length ? " " + partes.join(" ") : ""} ${etiquetaRango}.`;
      setMsg(texto);
      hablar(texto);
    } catch (e) { setMsg(e.message); }
  }

  // El cuadro "Pregúntele al agente" (arriba de las pestañas) es el
  // MISMO cuadro que muestra los ejemplos «acciones de Luis hoy» - una
  // persona que escribe/dice esa frase ahí espera que funcione, no
  // solo desde el micrófono chiquito junto a los filtros. Como el
  // filtro ya vive aquí (sin pasar por el backend), se intercepta la
  // frase ANTES de que AsistenteVoz llegue a preguntarle al agente -
  // event.preventDefault() debe llamarse de una, ANTES de cualquier
  // await, para que AsistenteVoz vea la señal en el mismo ciclo
  // síncrono del dispatchEvent (el fetch+anuncio siguen aparte, ya de
  // forma asíncrona, sin que eso afecte esa señal).
  useEffect(() => {
    const interceptar = (e) => {
      const resuelto = _resolverFiltroVoz(e.detail.texto);
      if (!resuelto) return;
      e.preventDefault();
      _aplicarFiltroYAnunciar(resuelto);
    };
    window.addEventListener("cuentavoz:filtro-local", interceptar);
    return () => window.removeEventListener("cuentavoz:filtro-local", interceptar);
  }, [todasPersonas, acciones, token, rango, persona, accion]);

  function escucharFiltro() {
    setMsg("");
    escuchar({
      alTexto: (texto) => {
        const resuelto = _resolverFiltroVoz(texto);
        if (resuelto) _aplicarFiltroYAnunciar(resuelto);
        else setMsg("No reconocí ningún filtro en lo que dijo.");
      },
      alEstado: (e) => setEscuchandoFiltro(e === "escuchando"),
      alError: setMsg,
    });
  }

  async function exportar() {
    setMsg("");
    try {
      const q = new URLSearchParams();
      if (persona) q.set("persona", persona);
      if (accion) q.set("accion", accion);
      if (rango) q.set("rango", rango);
      const d = await pedir(`/api/trazabilidad/exportar?${q}`, { method: "GET" }, token);
      await descargarReporte(d.archivo, token);
      setMsg(`Exportado: ${d.filas} filas.`);
    } catch (e) { setMsg(e.message); }
  }

  // "exporta el registro de trazabilidad" por voz - mismo botón
  // «Exportar», con los filtros que ya estén puestos en pantalla (el
  // agente no los conoce, viven aquí como estado de React).
  useEffect(() => {
    window.addEventListener("cuentavoz:accion:exportar_trazabilidad", exportar);
    return () => window.removeEventListener("cuentavoz:accion:exportar_trazabilidad", exportar);
  }, [token, persona, accion, rango]);

  return (
    <div className="card">
      <h3><span className="icono-kpi" style={{ marginRight: 8 }}>🕘</span>
        Registro de trazabilidad ({traza.length} acciones)</h3>
      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <select value={rango} onChange={(e) => setRango(e.target.value)}
                style={{ padding: "9px 12px", border: "1px solid var(--borde)", borderRadius: 10 }}>
          <option value="hoy">Hoy</option>
          <option value="semana">Última semana</option>
          <option value="mes">Último mes</option>
          <option value="">Todo</option>
        </select>
        <select value={persona} onChange={(e) => setPersona(e.target.value)}
                style={{ padding: "9px 12px", border: "1px solid var(--borde)", borderRadius: 10 }}>
          <option value="">Todas las personas</option>
          {personas.map((p) => <option key={p} value={p} style={{ textTransform: "capitalize" }}>{p}</option>)}
        </select>
        <select value={accion} onChange={(e) => setAccion(e.target.value)}
                style={{ padding: "9px 12px", border: "1px solid var(--borde)", borderRadius: 10 }}>
          {acciones.map((a) => <option key={a} value={a}>{a || "Todas las acciones"}</option>)}
        </select>
        <button className={`mic-btn ${escuchandoFiltro ? "escuchando" : ""}`}
                style={{ width: 46, height: 46, fontSize: "1.2rem" }}
                onClick={escucharFiltro} title="filtrar por voz: «acciones de Luis hoy»"
                aria-label="Filtrar el registro de trazabilidad por voz">
          <Icono nombre="microfono" tam={20} /></button>
        <button className="btn verde"
                style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}
                onClick={exportar}>
          <Icono nombre="descargar" tam={18} />
          Exportar
        </button>
      </div>
      {msg && (
        <div className={`banner ${msg.startsWith("Encontré") || msg.startsWith("Exportado") ? "ok" : ""}`}
             style={{ marginBottom: 12 }}>
          <span className="ico">
            {msg.startsWith("Encontré") || msg.startsWith("Exportado") ? "✓" : "!"}
          </span>
          <span>{msg}</span>
        </div>
      )}
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
      <p className="pista" style={{ marginTop: 10 }}>
        Cumple la Ley 1581 de 2012: se registra la acción, no datos personales sensibles.
        El registro no se puede editar ni borrar.
      </p>
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
