import { useEffect, useState } from "react";
import { pedir, BASE, leerToken, guardarToken } from "../api";
import { configurarVoz, hablar } from "../voz";
import Marco from "../Marco";
import Dialogo from "../Dialogo";

export default function MiPerfil({ token }) {
  const [datos, setDatos] = useState(null);
  const [bodegas, setBodegas] = useState([]);
  const [msg, setMsg] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [err, setErr] = useState("");
  const [v, setV] = useState(Date.now());
  const [fotoOk, setFotoOk] = useState(true);
  const [confirmarCierre, setConfirmarCierre] = useState(false);

  useEffect(() => {
    pedir("/api/usuarios/yo", {}, token).then(setDatos).catch(() => {});
    pedir("/api/usuarios/yo/bodegas", {}, token).then(setBodegas).catch(() => {});
  }, [token]);

  async function guardar() {
    try {
      await pedir("/api/usuarios/yo", { method: "PUT", body: JSON.stringify(datos) }, token);
      setMsg("Cambios guardados correctamente.");
    } catch (e) { setErr(e.message); }
  }
  async function subirFoto(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const form = new FormData();
    form.append("foto", f);
    await fetch(`${BASE}/api/usuarios/yo/foto`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token || leerToken()}` },
      body: form,
    });
    setV(Date.now());
    setFotoOk(true);
    setMsg("Foto actualizada.");
  }
  async function cambiarPin() {
    setErr("");
    if (pin.length < 6) return setErr("El PIN debe tener al menos 6 dígitos.");
    if (pin !== pin2) return setErr("Los dos PIN no coinciden.");
    try {
      await pedir("/api/usuarios/yo/pin", {
        method: "PUT", body: JSON.stringify({ pin }),
      }, token);
      setMsg("PIN actualizado.");
      setPin(""); setPin2("");
    } catch (e) { setErr(e.message); }
  }
  async function registrarHuella() {
    try {
      await pedir("/api/usuarios/yo/huella", { method: "POST" }, token);
      setDatos({ ...datos, huella_registrada: true });
      setMsg("Huella registrada (simulada: esta tableta no tiene lector real).");
    } catch (e) { setErr(e.message); }
  }
  async function cerrarTodas() {
    try {
      const r = await pedir("/api/usuarios/yo/cerrar-todas", { method: "POST" }, token);
      guardarToken(r.token);
      window.location.reload();
    } catch (e) { setErr(e.message); }
  }
  function probarVoz() {
    hablar("Hola, soy CuentaVoz. Así voy a sonar de ahora en adelante.", { forzar: true });
  }

  async function guardarPreferencias(cambios) {
    const nuevos = { ...datos, ...cambios };
    setDatos(nuevos);
    configurarVoz({ idioma: nuevos.idioma_voz, velocidad: nuevos.velocidad_voz,
                    confirmacionHablada: nuevos.confirmacion_hablada });
    try {
      await pedir("/api/usuarios/yo/preferencias", {
        method: "PUT", body: JSON.stringify(cambios),
      }, token);
    } catch (e) { setErr(e.message); }
  }

  if (!datos) return <Marco titulo="Mi perfil"><p className="cargando">Cargando…</p></Marco>;

  return (
    <Marco titulo="Mi perfil  ·  datos personales"
           chip={{ texto: "SESIÓN ACTIVA", tipo: "verde" }}>
      <div className="perfil-cols">
        <div className="card mic-caja">
          {fotoOk ? (
            <img src={`${BASE}/api/usuarios/yo/foto?t=${v}`} alt=""
                 onError={() => setFotoOk(false)}
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
            {[["Nombre", "nombre"], ["Correo corporativo", "correo"],
              ["Teléfono", "telefono"], ["Código de empleado", "codigo"]].map(([l, k]) => (
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
          <div className="grilla-botones">
            <button className="btn" onClick={guardar}>Guardar cambios</button>
          </div>

          {err && <p className="error">{err}</p>}
          {msg && <p className="msg-ok">{msg}</p>}
        </div>
      </div>

      <div className="dos-columnas">
        <div className="card">
          <h3>Seguridad de la cuenta</h3>
          <p style={{ fontSize: ".87rem", marginBottom: 4 }}>
            Último acceso: <b>{datos.ultimo_acceso || "—"}</b>
          </p>
          <p style={{ fontSize: ".87rem", marginBottom: 14 }}>
            Su PIN vence en <b>{datos.pin_vence_en_dias} días</b>
          </p>

          <input type="password" placeholder="PIN nuevo (6 dígitos)" value={pin}
                 onChange={(e) => setPin(e.target.value)}
                 style={{ width: "100%", padding: "11px 13px", marginBottom: 8,
                          border: "1px solid var(--borde)", borderRadius: 12 }} />
          <input type="password" placeholder="Confirmar PIN" value={pin2}
                 onChange={(e) => setPin2(e.target.value)}
                 style={{ width: "100%", padding: "11px 13px",
                          border: "1px solid var(--borde)", borderRadius: 12 }} />
          <div className="grilla-botones">
            <button className="btn borde" onClick={cambiarPin}>Cambiar PIN</button>
          </div>

          <div className="grilla-botones" style={{ marginTop: 10 }}>
            <button className={`btn ${datos.huella_registrada ? "verde" : "borde"}`}
                    onClick={registrarHuella} disabled={datos.huella_registrada}>
              {datos.huella_registrada ? "✓ Huella registrada" : "Registrar huella"}
            </button>
            <button className="btn gris" onClick={() => setConfirmarCierre(true)}>
              Cerrar sesión en todos los dispositivos
            </button>
          </div>
          <p className="pista" style={{ marginTop: 8 }}>
            El PIN se guarda cifrado (bcrypt); la huella es simulada porque esta
            tableta web no tiene lector biométrico real.
          </p>
        </div>

        <div className="card">
          <h3>Preferencias de voz</h3>
          <label className="pista">Acento de la voz que le habla (CuentaVoz)</label>
          <select value={datos.idioma_voz}
                  onChange={(e) => guardarPreferencias({ idioma_voz: e.target.value })}
                  style={{ width: "100%", marginTop: 6, marginBottom: 8, padding: "10px 12px",
                           border: "1px solid var(--borde)", borderRadius: 10 }}>
            <option value="es-MX">Español (México) — recomendado</option>
            <option value="es-CO">Español (Colombia)</option>
            <option value="es-419">Español (Latinoamérica)</option>
            <option value="es-US">Español (Estados Unidos)</option>
            <option value="es-ES">Español (España)</option>
          </select>
          <div className="grilla-botones" style={{ marginBottom: 6 }}>
            <button className="btn borde" onClick={probarVoz}>🔊 Probar voz</button>
          </div>
          <p className="pista" style={{ marginBottom: 12 }}>
            El reconocimiento de lo que usted dice sigue siempre en español de
            Colombia; esto solo cambia cómo suena CuentaVoz al responder.
          </p>

          <label className="pista">Velocidad de la respuesta</label>
          <div className="grilla-botones" style={{ marginTop: 6, marginBottom: 12 }}>
            {["lenta", "normal", "rapida"].map((v2) => (
              <button key={v2}
                      className={`btn ${datos.velocidad_voz === v2 ? "" : "borde"}`}
                      onClick={() => guardarPreferencias({ velocidad_voz: v2 })}>
                {v2[0].toUpperCase() + v2.slice(1)}
              </button>
            ))}
          </div>

          <label className="pista">Confirmación hablada</label>
          <div className="grilla-botones" style={{ marginTop: 6 }}>
            <button className={`btn ${datos.confirmacion_hablada ? "" : "borde"}`}
                    onClick={() => guardarPreferencias({ confirmacion_hablada: true })}>
              Activada
            </button>
            <button className={`btn ${!datos.confirmacion_hablada ? "" : "borde"}`}
                    onClick={() => guardarPreferencias({ confirmacion_hablada: false })}>
              Desactivada
            </button>
          </div>
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
