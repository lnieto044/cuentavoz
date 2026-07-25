import { useEffect, useState } from "react";
import { pedir, BASE, leerToken } from "../api";
import Marco from "../Marco";

export default function MiPerfil({ token }) {
  const [datos, setDatos] = useState(null);
  const [msg, setMsg] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [err, setErr] = useState("");
  const [v, setV] = useState(Date.now());

  useEffect(() => {
    pedir("/api/usuarios/yo", {}, token).then(setDatos).catch(() => {});
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
          <div className="grilla-botones">
            <button className="btn" onClick={guardar}>Guardar cambios</button>
          </div>

          <h3 style={{ marginTop: 20 }}>Cambiar PIN</h3>
          <input type="password" placeholder="PIN nuevo (6 dígitos)" value={pin}
                 onChange={(e) => setPin(e.target.value)}
                 style={{ width: "100%", padding: "11px 13px", marginBottom: 8,
                          border: "1px solid var(--borde)", borderRadius: 12 }} />
          <input type="password" placeholder="Confirmar PIN" value={pin2}
                 onChange={(e) => setPin2(e.target.value)}
                 style={{ width: "100%", padding: "11px 13px",
                          border: "1px solid var(--borde)", borderRadius: 12 }} />
          {err && <p className="error">{err}</p>}
          {msg && <p className="msg-ok">{msg}</p>}
          <div className="grilla-botones">
            <button className="btn borde" onClick={cambiarPin}>Actualizar PIN</button>
          </div>
          <p className="pista" style={{ marginTop: 8 }}>
            El PIN se guarda cifrado (bcrypt): nunca queda en texto plano.
          </p>
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
    </Marco>
  );
}
