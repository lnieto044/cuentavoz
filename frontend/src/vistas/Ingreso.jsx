import { useState } from "react";
import { ingresar, guardarToken } from "../api";

export default function Ingreso({ alEntrar }) {
  const [usuario, setUsuario] = useState("luis");
  const [clave, setClave] = useState("123456");
  const [err, setErr] = useState("");
  const [cargando, setCargando] = useState(false);

  async function entrar(e) {
    e?.preventDefault();
    setCargando(true);
    setErr("");
    try {
      const r = await ingresar(usuario.trim().toLowerCase(), clave);
      guardarToken(r.token);
      alEntrar(r);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="ingreso">
      <div className="marca-lado">
        <img className="app" src="/logo.png" alt="CuentaVoz" />
        <h1>CuentaVoz</h1>
        <i>Tu voz cuenta</i>
        <hr />
        <p>Asistente conversacional para la toma física de inventarios</p>
        <img className="cs" src="/colsubsidio-blanco.png" alt="Colsubsidio" />
      </div>

      <form className="form" onSubmit={entrar}>
        <h2>Iniciar sesión</h2>
        <p className="pista">Ingrese con su usuario corporativo.</p>

        <label>Usuario</label>
        <input
          value={usuario}
          onChange={(e) => setUsuario(e.target.value)}
          autoComplete="username"
        />

        <label>PIN</label>
        <input
          type="password"
          value={clave}
          onChange={(e) => setClave(e.target.value)}
          autoComplete="current-password"
        />

        <div className="perfiles">
          <button
            type="button"
            className={`btn ${usuario === "luis" ? "" : "borde"}`}
            onClick={() => setUsuario("luis")}
          >
            Auxiliar
          </button>
          <button
            type="button"
            className={`btn ${usuario === "diana" ? "" : "borde"}`}
            onClick={() => setUsuario("diana")}
          >
            Administrador
          </button>
        </div>

        {err && <span className="error">{err}</span>}

        <button className="btn" type="submit" disabled={cargando}>
          {cargando ? "Entrando…" : "ENTRAR"}
        </button>
        <p className="pista">
          Usuarios de prueba: luis (auxiliar) y diana (administradora). PIN 123456.
        </p>
      </form>
    </div>
  );
}
