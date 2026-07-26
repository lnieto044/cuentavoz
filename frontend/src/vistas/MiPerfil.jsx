import { useEffect, useState } from "react";
import { pedir, BASE, leerToken, guardarToken } from "../api";
import { configurarVoz } from "../voz";
import Marco from "../Marco";

export default function MiPerfil({ token }) {
  const [datos, setDatos] = useState(null);
  const [bodegas, setBodegas] = useState([]);
  const [msg, setMsg] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [err, setErr] = useState("");
  const [v, setV] = useState(Date.now());

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
    if (!window.confirm("Esto cierra la sesión en todos los dispositivos, incluido este. ¿Continuar?")) return;
    try {
      const r = await pedir("/api/usuarios/yo/cerrar-todas", { method: "POST" }, token);
      guardarToken(r.token);
      window.location.reload();
    } catch (e) { setErr(e.message); }
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
      <div className="conteo-cols">
        <div className="card">
          <h3>Datos personales</h3>
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

        <div className="card mic-caja">
          <img src={`${BASE}/api/usuarios/yo/foto?t=${v}`} alt=""
               onError={(e) => { e.currentTarget.style.display = "none"; }}
               style={{ width: 120, height: 120, borderRadius: "50%",
                        objectFit: "cover", border: "3px solid var(--azul)" }} />
          <b style={{ textTransform: "capitalize" }}>{datos.nombre}</b>
          <small>{datos.perfil === "auditor" ? "Administrador de bodega"
                                             : "Auxiliar de inventarios"}</small>
          <label className="btn borde" style={{ textAlign: "center" }}>
            Cambiar foto
            <input type="file" accept="image/*" hidden onChange={subirFoto} />
          </label>
        </div>
      </div>

      <div className="conteo-cols">
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
            <button className="btn gris" onClick={cerrarTodas}>
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
          <label className="pista">Idioma del reconocimiento</label>
          <p style={{ marginBottom: 12 }}><b>{datos.idioma_voz}</b></p>

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
    </Marco>
  );
}
