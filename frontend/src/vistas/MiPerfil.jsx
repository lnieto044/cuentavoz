import { useEffect, useState } from "react";
import { pedir, BASE, leerToken, actualizarTokenSesion, esFalloRed } from "../api";
import { configurarVoz, hablar } from "../voz";
import { hayAutenticadorDisponible, registrarHuellaDispositivo } from "../webauthn";
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
// confirmación hablada, y preguntar por los datos de la cuenta). El PIN,
// la huella y la foto son a propósito solo manuales, por seguridad - el
// agente lo explica si se le pide, en vez de fingir que puede hacerlo.
const _EJEMPLOS_PERFIL = [
  "cambia mi voz a puck", "usa la voz aoede", "habla más lento", "velocidad normal",
  "activa la confirmación hablada", "desactiva la confirmación hablada",
  "¿cuándo fue mi último acceso?", "¿cuántos días le quedan a mi PIN?",
  "¿qué bodegas tengo asignadas?", "¿tengo la huella registrada?",
];

export default function MiPerfil({ token, ir }) {
  const [datos, setDatos] = useState(null);
  const [bodegas, setBodegas] = useState([]);
  const [msg, setMsg] = useState("");
  const [pinActual, setPinActual] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [err, setErr] = useState("");
  const [fotoUrl, setFotoUrl] = useState(null);
  const [confirmarCierre, setConfirmarCierre] = useState(false);
  const [hayLector, setHayLector] = useState(false);
  const [voces, setVoces] = useState([]);

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
    hayAutenticadorDisponible().then(setHayLector);
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
  async function cambiarPin() {
    setErr("");
    if (!pinActual) return setErr("Digite su PIN actual.");
    if (pin.length < 6) return setErr("El PIN debe tener al menos 6 dígitos.");
    if (pin !== pin2) return setErr("Los dos PIN no coinciden.");
    try {
      const r = await pedir("/api/usuarios/yo/pin", {
        method: "PUT", body: JSON.stringify({ pin_actual: pinActual, pin }),
      }, token);
      // el PIN nuevo invalida el token con el que se pidió el cambio (igual
      // que "cerrar todas las sesiones"): sin recargar, el resto de llamadas
      // de esta pantalla seguirían usando el token viejo ya sin validez.
      actualizarTokenSesion(r.token);
      window.location.reload();
    } catch (e) { setErr(e.message); }
  }
  async function registrarHuella() {
    setErr(""); setMsg("");
    try {
      await registrarHuellaDispositivo(token);
      setDatos({ ...datos, huella_registrada: true });
      setMsg("Huella registrada en este dispositivo.");
    } catch (e) {
      setErr(e.name === "NotAllowedError"
        ? "Se canceló el registro de la huella."
        : e.message);
    }
  }
  async function eliminarHuella() {
    setErr(""); setMsg("");
    try {
      await pedir("/api/usuarios/yo/huella", { method: "DELETE" }, token);
      setDatos({ ...datos, huella_registrada: false });
      setMsg("Huella eliminada de este dispositivo.");
    } catch (e) { setErr(e.message); }
  }
  async function cerrarTodas() {
    try {
      const r = await pedir("/api/usuarios/yo/cerrar-todas", { method: "POST" }, token);
      actualizarTokenSesion(r.token);
      window.location.reload();
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
                <label className="pista">{l}</label>
                <input value={datos[k] || ""}
                       onChange={(e) => setDatos({ ...datos, [k]: e.target.value })}
                       style={{ width: "100%", padding: "11px 13px",
                                border: "1px solid var(--borde)", borderRadius: 12 }} />
              </div>
            ))}
          </div>
          <label className="pista">Bodegas asignadas</label>
          <div className="chips" style={{ marginTop: 6 }}>
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

          <input type="password" placeholder="PIN actual" value={pinActual}
                 autoComplete="current-password"
                 onChange={(e) => setPinActual(e.target.value)}
                 style={{ width: "100%", padding: "11px 13px", marginBottom: 8,
                          border: "1px solid var(--borde)", borderRadius: 12 }} />
          <input type="password" placeholder="PIN nuevo (6 dígitos)" value={pin}
                 autoComplete="new-password"
                 onChange={(e) => setPin(e.target.value)}
                 style={{ width: "100%", padding: "11px 13px", marginBottom: 8,
                          border: "1px solid var(--borde)", borderRadius: 12 }} />
          <input type="password" placeholder="Confirmar PIN" value={pin2}
                 autoComplete="new-password"
                 onChange={(e) => setPin2(e.target.value)}
                 style={{ width: "100%", padding: "11px 13px",
                          border: "1px solid var(--borde)", borderRadius: 12 }} />
          <div className="grilla-botones">
            <button className="btn borde" onClick={cambiarPin}>Cambiar PIN</button>
          </div>

          <div className="grilla-botones" style={{ marginTop: 10 }}>
            {datos.huella_registrada ? (
              <button className="btn gris" onClick={eliminarHuella}>
                ✓ Huella registrada — quitar de este dispositivo
              </button>
            ) : (
              <button className="btn borde" onClick={registrarHuella} disabled={!hayLector}>
                Registrar huella de este dispositivo
              </button>
            )}
            <button className="btn gris" onClick={() => setConfirmarCierre(true)}>
              Cerrar sesión en todos los dispositivos
            </button>
          </div>
          <p className="pista" style={{ marginTop: 8 }}>
            {hayLector
              ? "El PIN se guarda cifrado (bcrypt); la huella usa el lector o " +
                "Windows Hello de este equipo (WebAuthn) y solo sirve para " +
                "ingresar desde este mismo dispositivo."
              : "El PIN se guarda cifrado (bcrypt); este equipo o navegador no " +
                "tiene un lector de huella / Windows Hello configurado, así " +
                "que el ingreso con huella no está disponible aquí."}
          </p>
        </div>

        <div className="card">
          <h3>Preferencias de voz</h3>
          <label className="pista">Voz de CuentaVoz</label>
          <select value={datos.idioma_voz}
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

          <label className="pista">Velocidad de la respuesta</label>
          <div className="grilla-botones" style={{ marginTop: 6, marginBottom: 12 }}>
            {["lenta", "normal", "rapida"].map((v2) => (
              <button key={v2}
                      className={`btn ${datos.velocidad_voz === v2 ? "" : "borde"}`}
                      onClick={() => elegirPreferencia({ velocidad_voz: v2 })}>
                {v2[0].toUpperCase() + v2.slice(1)}
              </button>
            ))}
          </div>

          <label className="pista">Confirmación hablada</label>
          <div className="grilla-botones" style={{ marginTop: 6, marginBottom: 18 }}>
            <button className={`btn ${datos.confirmacion_hablada ? "" : "borde"}`}
                    onClick={() => elegirPreferencia({ confirmacion_hablada: true })}>
              Activada
            </button>
            <button className={`btn ${!datos.confirmacion_hablada ? "" : "borde"}`}
                    onClick={() => elegirPreferencia({ confirmacion_hablada: false })}>
              Desactivada
            </button>
          </div>

          {err && <p className="error">{err}</p>}
          {msg && <p className="msg-ok">{msg}</p>}
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
    </Marco>
  );
}
