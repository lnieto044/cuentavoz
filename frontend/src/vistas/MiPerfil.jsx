import { useState, useEffect } from "react";
import { BASE, pedir } from "../api";
 
export default function MiPerfil({ token }) {
  const [datos, setDatos] = useState(null);
  const [msg, setMsg]     = useState("");
 
  useEffect(() => {
    pedir("/api/usuarios/yo", {}, token).then(setDatos);
  }, [token]);
 
  async function guardar() {
    await pedir("/api/usuarios/yo",
      { method: "PUT", body: JSON.stringify(datos) }, token);
    setMsg("Cambios guardados correctamente.");
  }
 
  async function subirFoto(e) {
    const form = new FormData();
    form.append("foto", e.target.files[0]);
    await fetch(BASE + "/api/usuarios/yo/foto", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: form,
    });
    setMsg("Foto actualizada.");
  }
 
  async function cambiarPin(pin) {
    await pedir("/api/usuarios/yo/pin",
      { method: "PUT", body: JSON.stringify({ pin }) }, token);
    setMsg("PIN actualizado.");
  }
 
  if (!datos) return <div className="cargando">Cargando...</div>;
 
  return (
    <div className="mi-perfil">
 
      <div className="perfil-foto">
        <img className="avatar" alt="foto"
             src={BASE + "/api/usuarios/yo/foto?t=" + Date.now()} />
        <label className="btn btn-borde">
          Cambiar foto
          <input type="file" accept="image/*" hidden
                 onChange={subirFoto} />
        </label>
      </div>
 
      <div className="perfil-datos">
        {[["Nombre completo", "nombre"],
          ["Correo corporativo", "correo"],
          ["Telefono de contacto", "telefono"],
          ["Codigo de empleado", "codigo"]].map(([lbl, k]) => (
          <div className="campo" key={k}>
            <label>{lbl}</label>
            <input value={datos[k] || ""}
                   onChange={(e) =>
                     setDatos({ ...datos, [k]: e.target.value })} />
          </div>
        ))}
      </div>
 
      <CambiarPin onGuardar={cambiarPin} />
 
      {msg && <p className="msg-ok">{msg}</p>}
      <button className="btn btn-primario" onClick={guardar}>
        Guardar cambios</button>
    </div>
  );
}
 
/* ---- subcomponente: cambio de PIN con validacion ---- */
function CambiarPin({ onGuardar }) {
  const [pin, setPin]   = useState("");
  const [pin2, setPin2] = useState("");
  const [err, setErr]   = useState("");
 
  function guardar() {
    if (pin.length < 6) { setErr("El PIN debe tener 6 digitos."); return; }
    if (pin !== pin2)   { setErr("Los dos PIN no coinciden."); return; }
    setErr("");
    onGuardar(pin);
    setPin(""); setPin2("");
  }
 
  return (
    <div className="cambiar-pin">
      <h4>Cambiar PIN</h4>
      <input type="password" placeholder="PIN nuevo"
             value={pin}  onChange={(e) => setPin(e.target.value)} />
      <input type="password" placeholder="Confirmar PIN"
             value={pin2} onChange={(e) => setPin2(e.target.value)} />
      {err && <p className="msg-err">{err}</p>}
      <button className="btn btn-borde" onClick={guardar}>
        Actualizar PIN</button>
    </div>
  );
}

