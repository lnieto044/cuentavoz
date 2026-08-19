import { useEffect, useState } from "react";
import { pedir, BASE, leerToken, borrarSesion, esFalloRed } from "../api";
import { cambiarClave, cerrarSesionLocal, tieneMFAActiva, desactivarMFA } from "../cognito";
import { configurarVoz, hablar } from "../voz";
import ChecklistClave, { claveCumplePolitica } from "../ChecklistClave";
import ConfigurarMFA from "../ConfigurarMFA";
import Marco from "../Marco";
import Dialogo from "../Dialogo";
import AsistenteVoz from "../AsistenteVoz";

function formatoAcceso(fechaStr) {
  if (!fechaStr) return "—";
  const [fecha, hora] = fechaStr.split(" ");
  const hoy = new Date().toISOString().slice(0, 10);
  return fecha === hoy ? `hoy ${hora}` : `${fecha.slice(5).replace("-", "/")} ${hora}`;
}

// Lo que YA se puede cambiar por voz aquí (la voz, la velocidad, la
// confirmación hablada, y preguntar por los datos de la cuenta). La clave
// y la foto son a propósito solo manuales, por seguridad - el agente lo
// explica si se le pide, en vez de fingir que puede hacerlo.
const _EJEMPLOS_PERFIL = [
  "cambia mi voz a puck", "usa la voz aoede", "habla más lento", "velocidad normal",
  "activa la confirmación hablada", "desactiva la confirmación hablada",
  "¿cuándo fue mi último acceso?", "¿cuántos días le quedan a mi PIN?",
  "¿qué bodegas tengo asignadas?",
];

export default function MiPerfil({ token, ir }) {
  const [datos, setDatos] = useState(null);
  const [bodegas, setBodegas] = useState([]);
  const [msg, setMsg] = useState("");
  const [claveActual, setClaveActual] = useState("");
  const [claveNueva, setClaveNueva] = useState("");
  const [claveNueva2, setClaveNueva2] = useState("");
  const [err, setErr] = useState("");
  const [fotoUrl, setFotoUrl] = useState(null);
  const [confirmarCierre, setConfirmarCierre] = useState(false);
  const [voces, setVoces] = useState([]);
  // verificación en dos pasos (MFA con app autenticadora)
  const [mfaActiva, setMfaActiva] = useState(null);   // null = todavía no se sabe
  const [configurandoMFA, setConfigurandoMFA] = useState(false);
  const [confirmarQuitarMFA, setConfirmarQuitarMFA] = useState(false);

  // <img src> no puede mandar el header Authorization, y /foto exige
  // sesion - por eso se trae como blob autenticado (mismo patron que
  // descargarReporte) en vez de apuntar la imagen directo al endpoint.
  function cargarFoto() {
    fetch(`${BASE}/api/usuarios/yo/foto`, {
      headers: { Authorization: `Bearer ${token || leerToken()}` },
    }).then((r) => (r.ok ? r.blob() : null))
      .then((b) => setFotoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return b ? URL.createObjectURL(b) : null;
      }))
      .catch(() => setFotoUrl(null));
  }

  useEffect(() => {
    pedir("/api/usuarios/yo", {}, token).then(setDatos).catch(() => {});
    pedir("/api/usuarios/yo/bodegas", {}, token).then(setBodegas).catch(() => {});
    pedir("/api/voz/voces", {}, token).then((r) => setVoces(r.voces)).catch(() => {});
    tieneMFAActiva().then(setMfaActiva).catch(() => setMfaActiva(false));
    cargarFoto();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function guardar() {
    setErr(""); setMsg("");
    try {
      await pedir("/api/usuarios/yo", { method: "PUT", body: JSON.stringify(datos) }, token);
      await pedir("/api/usuarios/yo/preferencias", {
        method: "PUT", body: JSON.stringify({
          idioma_voz: datos.idioma_voz, velocidad_voz: datos.velocidad_voz,
          confirmacion_hablada: datos.confirmacion_hablada,
        }),
      }, token);
      setMsg("Cambios guardados correctamente.");
    } catch (e) { setErr(e.message); }
  }
  async function subirFoto(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr(""); setMsg("");
    const form = new FormData();
    form.append("foto", f);
    try {
      const r = await fetch(`${BASE}/api/usuarios/yo/foto`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token || leerToken()}` },
        body: form,
      });
      if (!r.ok) throw new Error("No se pudo subir la foto.");
      cargarFoto();
      window.dispatchEvent(new Event("cuentavoz:foto-actualizada"));
      setMsg("Foto actualizada.");
    } catch (e2) {
      setErr(esFalloRed(e2)
        ? "Sin conexión con el servidor. Revise el Wi-Fi e intente de nuevo."
        : e2.message);
    }
  }
  async function cambiarClavePropia() {
    setErr(""); setMsg("");
    if (!claveActual) return setErr("Digite su clave actual.");
    if (!claveCumplePolitica(claveNueva)) return setErr("La clave nueva no cumple todos los requisitos.");
    if (claveNueva !== claveNueva2) return setErr("Las dos claves no coinciden.");
    try {
      // habla directo con Cognito (no con este backend, que nunca ve la
      // clave) - a diferencia del PIN de antes, esto NO invalida la sesión
      // actual, así que no hace falta recargar la página.
      await cambiarClave(claveActual, claveNueva);
      setClaveActual(""); setClaveNueva(""); setClaveNueva2("");
      setMsg("Clave actualizada.");
    } catch (e) { setErr(e.message); }
  }
  async function cerrarTodas() {
    try {
      await pedir("/api/usuarios/yo/cerrar-todas", { method: "POST" }, token);
      // revoca las sesiones en TODOS los dispositivos, incluido este -
      // por consistencia se cierra tambien aqui en vez de seguir en la
      // pantalla con un token que ya no sirve para pedir uno nuevo.
      cerrarSesionLocal();
      borrarSesion();
      window.location.reload();
    } catch (e) { setErr(e.message); }
  }
  function alActivarMFA() {
    setConfigurandoMFA(false);
    setMfaActiva(true);
    setMsg("Verificación en dos pasos activada.");
  }
  async function quitarMFA() {
    setErr(""); setMsg("");
    try {
      await desactivarMFA();
      setMfaActiva(false);
      setMsg("Verificación en dos pasos desactivada.");
    } catch (e) { setErr(e.message); }
  }
  function probarVoz() {
    hablar("Hola, soy CuentaVoz. Así voy a sonar de ahora en adelante.", { forzar: true });
  }

  // Solo actualiza en memoria (para que "Probar voz" suene distinto de una
  // vez): el guardado real de estas preferencias queda para "Guardar
  // cambios", junto con los datos personales - un solo botón, un solo
  // guardado, como el resto de la pantalla.
  function elegirPreferencia(cambios) {
    const nuevos = { ...datos, ...cambios };
    setDatos(nuevos);
    configurarVoz({ idioma: nuevos.idioma_voz, velocidad: nuevos.velocidad_voz,
                    confirmacionHablada: nuevos.confirmacion_hablada });
  }

  // El agente ("Pregúntele al agente", arriba) SÍ puede cambiar la voz, la
  // velocidad y la confirmación hablada directo en la base de datos - a
  // diferencia de elegirPreferencia() (que solo actualiza en memoria hasta
  // "Guardar cambios"), aquí ya quedó guardado en el servidor, así que se
  // trae de nuevo (en vez de adivinar qué cambió) y se aplica de una con
  // configurarVoz(), para que la SIGUIENTE frase que diga el agente ya
  // suene con la preferencia nueva sin esperar a recargar la página.
  function recargarPreferencias() {
    pedir("/api/usuarios/yo", {}, token).then((d) => {
      setDatos(d);
      configurarVoz({ idioma: d.idioma_voz, velocidad: d.velocidad_voz,
                      confirmacionHablada: d.confirmacion_hablada });
    }).catch(() => {});
  }

  if (!datos) return <Marco titulo="Mi perfil"><p className="cargando">Cargando…</p></Marco>;

  return (
    <Marco titulo="Mi perfil  ·  datos personales"
           chip={{ texto: "SESIÓN ACTIVA", tipo: "verde" }}>
      <AsistenteVoz token={token} vista="perfil" ir={ir} ejemplos={_EJEMPLOS_PERFIL}
                    placeholder="cambia mi voz a puck, ¿cuándo fue mi último acceso?…"
                    alActualizar={recargarPreferencias} />
      <div className="perfil-cols">
        <div className="card mic-caja">
          {fotoUrl ? (
            <img src={fotoUrl} alt=""
                 style={{ width: 110, height: 110, borderRadius: "50%",
                          objectFit: "cover", border: "3px solid var(--azul)" }} />
          ) : (
            <span className="avatar-grande">{(datos.nombre || "?")[0].toUpperCase()}</span>
          )}
          <b style={{ textTransform: "capitalize" }}>{datos.nombre}</b>
          <small>{datos.perfil === "auditor" ? "Administrador de bodega"
                                             : "Auxiliar de inventarios"}</small>
          <label className="btn borde" style={{ textAlign: "center" }}>
            Cambiar foto
            <input type="file" accept="image/*" hidden onChange={subirFoto} />
          </label>
        </div>

        <div className="card">
          <h3>Datos personales</h3>
          <div className="campos-2col">
            {[["Nombre completo", "nombre"], ["Correo corporativo", "correo"],
              ["Teléfono de contacto", "telefono"], ["Código de empleado", "codigo"]].map(([l, k]) => (
              <div key={k} style={{ marginBottom: 10 }}>
                <label className="pista" htmlFor={`campo-perfil-${k}`}>{l}</label>
                <input id={`campo-perfil-${k}`} value={datos[k] || ""}
                       onChange={(e) => setDatos({ ...datos, [k]: e.target.value })}
                       style={{ width: "100%", padding: "11px 13px",
                                border: "1px solid var(--borde)", borderRadius: 12 }} />
              </div>
            ))}
          </div>
          <label className="pista" id="etiqueta-bodegas-asignadas">Bodegas asignadas</label>
          <div className="chips" style={{ marginTop: 6 }} aria-labelledby="etiqueta-bodegas-asignadas">
            {bodegas.length === 0 ? (
              <span className="pista">Sin bodegas asignadas todavía.</span>
            ) : bodegas.map((b) => <span key={b.id} className="chip">{b.bodega}</span>)}
          </div>
        </div>
      </div>

      <div className="dos-columnas">
        <div className="card">
          <h3>Seguridad de la cuenta</h3>
          <p style={{ fontSize: ".87rem", marginBottom: 4 }}>
            Último acceso: <b>{formatoAcceso(datos.ultimo_acceso)}</b>
          </p>
          <p style={{ fontSize: ".87rem", marginBottom: 14 }}>
            Su PIN vence en <b>{datos.pin_vence_en_dias} días</b>
          </p>

          <input type="password" placeholder="Clave actual" value={claveActual}
                 autoComplete="current-password"
                 onChange={(e) => setClaveActual(e.target.value)}
                 aria-label="Clave actual"
                 style={{ width: "100%", padding: "11px 13px", marginBottom: 8,
                          border: "1px solid var(--borde)", borderRadius: 12 }} />
          <input type="password" placeholder="Clave nueva"
                 value={claveNueva}
                 autoComplete="new-password"
                 onChange={(e) => setClaveNueva(e.target.value)}
                 aria-label="Clave nueva"
                 style={{ width: "100%", padding: "11px 13px", marginBottom: 4,
                          border: "1px solid var(--borde)", borderRadius: 12 }} />
          <ChecklistClave clave={claveNueva} />
          <input type="password" placeholder="Confirmar clave nueva" value={claveNueva2}
                 autoComplete="new-password"
                 onChange={(e) => setClaveNueva2(e.target.value)}
                 aria-label="Confirmar clave nueva"
                 style={{ width: "100%", padding: "11px 13px",
                          border: "1px solid var(--borde)", borderRadius: 12 }} />
          <div className="grilla-botones">
            <button className="btn borde" onClick={cambiarClavePropia}>Cambiar clave</button>
          </div>

          <div className="grilla-botones" style={{ marginTop: 10 }}>
            <button className="btn gris" onClick={() => setConfirmarCierre(true)}>
              Cerrar sesión en todos los dispositivos
            </button>
          </div>
          <p className="pista" style={{ marginTop: 8 }}>
            La identidad y la clave las administra AWS Cognito, no CuentaVoz -
            este backend nunca ve ni guarda su clave.
          </p>

          <hr style={{ border: "none", borderTop: "1px solid var(--borde)", margin: "18px 0" }} />
          <h3 style={{ fontSize: "1rem" }}>Verificación en dos pasos</h3>
          {mfaActiva === null ? (
            <p className="pista">Comprobando…</p>
          ) : configurandoMFA ? (
            <ConfigurarMFA nombreUsuario={datos.nombre} onActivado={alActivarMFA}
                           onCancelar={() => setConfigurandoMFA(false)} />
          ) : mfaActiva ? (
            <>
              <p className="pista" style={{ color: "var(--verde)", fontStyle: "normal" }}>
                ✓ Activada con una app autenticadora.
              </p>
              <div className="grilla-botones">
                <button className="btn gris" onClick={() => setConfirmarQuitarMFA(true)}>Desactivar</button>
              </div>
            </>
          ) : (
            <>
              <p className="pista">
                Pida un código de 6 dígitos generado en su celular además de la clave, al ingresar. Opcional.
              </p>
              <div className="grilla-botones">
                <button className="btn borde" onClick={() => setConfigurandoMFA(true)}>Activar</button>
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h3>Preferencias de voz</h3>
          <label className="pista" htmlFor="campo-voz">Voz de CuentaVoz</label>
          <select id="campo-voz" value={datos.idioma_voz}
                  onChange={(e) => elegirPreferencia({ idioma_voz: e.target.value })}
                  style={{ width: "100%", marginTop: 6, marginBottom: 8, padding: "10px 12px",
                           border: "1px solid var(--borde)", borderRadius: 10 }}>
            {voces.map((v) => (
              <option key={v.clave} value={v.clave}>{v.nombre} — {v.etiqueta}</option>
            ))}
          </select>
          <div className="grilla-botones" style={{ marginBottom: 6 }}>
            <button className="btn borde" onClick={probarVoz}>🔊 Probar voz</button>
          </div>
          <p className="pista" style={{ marginBottom: 12 }}>
            Voz neuronal real (no la del navegador): suena humana y fluida.
            El reconocimiento de lo que usted dice sigue siempre en español
            de Colombia; esto solo cambia cómo suena CuentaVoz al responder.
          </p>

          <label className="pista" id="etiqueta-velocidad">Velocidad de la respuesta</label>
          <div className="grilla-botones" style={{ marginTop: 6, marginBottom: 12 }}
               role="group" aria-labelledby="etiqueta-velocidad">
            {["lenta", "normal", "rapida"].map((v2) => (
              <button key={v2}
                      className={`btn ${datos.velocidad_voz === v2 ? "" : "borde"}`}
                      onClick={() => elegirPreferencia({ velocidad_voz: v2 })}
                      aria-pressed={datos.velocidad_voz === v2}>
                {v2[0].toUpperCase() + v2.slice(1)}
              </button>
            ))}
          </div>

          <label className="pista" id="etiqueta-confirmacion">Confirmación hablada</label>
          <div className="grilla-botones" style={{ marginTop: 6, marginBottom: 18 }}
               role="group" aria-labelledby="etiqueta-confirmacion">
            <button className={`btn ${datos.confirmacion_hablada ? "" : "borde"}`}
                    onClick={() => elegirPreferencia({ confirmacion_hablada: true })}
                    aria-pressed={!!datos.confirmacion_hablada}>
              Activada
            </button>
            <button className={`btn ${!datos.confirmacion_hablada ? "" : "borde"}`}
                    onClick={() => elegirPreferencia({ confirmacion_hablada: false })}
                    aria-pressed={!datos.confirmacion_hablada}>
              Desactivada
            </button>
          </div>

          {err && <p className="error" role="alert">{err}</p>}
          {msg && <p className="msg-ok" aria-live="polite">{msg}</p>}
          <button className="btn" style={{ width: "100%" }} onClick={guardar}>
            Guardar cambios
          </button>
        </div>
      </div>

      {confirmarCierre && (
        <Dialogo titulo="Cerrar sesión en todos los dispositivos"
                 mensaje="Esto cierra la sesión en todas las tabletas donde haya entrado, incluida esta. ¿Continuar?"
                 textoAceptar="Cerrar todas" peligro
                 onAceptar={() => { setConfirmarCierre(false); cerrarTodas(); }}
                 onCancelar={() => setConfirmarCierre(false)} />
      )}

      {confirmarQuitarMFA && (
        <Dialogo titulo="Desactivar verificación en dos pasos"
                 mensaje="La próxima vez que entre, bastará con la clave - ya no se pedirá el código de la app autenticadora. ¿Continuar?"
                 textoAceptar="Desactivar" peligro
                 onAceptar={() => { setConfirmarQuitarMFA(false); quitarMFA(); }}
                 onCancelar={() => setConfirmarQuitarMFA(false)} />
      )}
    </Marco>
  );
}
