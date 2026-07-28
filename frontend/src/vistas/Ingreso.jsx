import { useEffect, useState } from "react";
import { ingresar, guardarToken, pedir } from "../api";
import { hayAutenticadorDisponible, ingresarConHuella } from "../webauthn";
import Icono from "../Iconos";

const ETIQUETAS_PERFIL = {
  auxiliar: "Auxiliar de inventarios",
  auditor: "Administrador de bodega",
};

export default function Ingreso({ alEntrar }) {
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [err, setErr] = useState("");
  const [cargando, setCargando] = useState(false);
  const [perfil, setPerfil] = useState(null);
  const [tieneHuella, setTieneHuella] = useState(false);
  const [entrandoConHuella, setEntrandoConHuella] = useState(false);
  const [hayLector, setHayLector] = useState(false);

  useEffect(() => { hayAutenticadorDisponible().then(setHayLector); }, []);

  // apenas escribe el usuario (o el codigo de empleado) se identifica el
  // perfil solo - no hay que elegirlo a mano. Con demora corta para no
  // disparar una llamada por cada tecla.
  useEffect(() => {
    const entrada = usuario.trim();
    if (!entrada) { setPerfil(null); setTieneHuella(false); return; }
    const espera = setTimeout(() => {
      pedir(`/api/usuarios/perfil?usuario=${encodeURIComponent(entrada)}`)
        .then((r) => { setPerfil(r.perfil); setTieneHuella(r.tiene_huella); })
        .catch(() => { setPerfil(null); setTieneHuella(false); });
    }, 350);
    return () => clearTimeout(espera);
  }, [usuario]);

  async function entrar(e) {
    e?.preventDefault();
    setCargando(true);
    setErr("");
    try {
      const r = await ingresar(usuario.trim(), clave);
      guardarToken(r.token);
      alEntrar(r);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setCargando(false);
    }
  }

  async function entrarConHuella() {
    setErr("");
    setEntrandoConHuella(true);
    try {
      const r = await ingresarConHuella(usuario.trim());
      guardarToken(r.token);
      alEntrar(r);
    } catch (e2) {
      setErr(e2.name === "NotAllowedError"
        ? "No se reconoció la huella o se canceló la lectura."
        : e2.message);
    } finally {
      setEntrandoConHuella(false);
    }
  }

  return (
    <div className="ingreso-fondo">
      <div className="ingreso">
        <div className="marca-lado">
          <img className="app" src="/logo.png" alt="CuentaVoz" />
          <h1>CuentaVoz</h1>
          <i>Tu voz cuenta</i>
          <hr />
          <p>Asistente conversacional para la toma física de inventarios</p>
          <img className="cs" src="/colsubsidio-blanco.png" alt="Colsubsidio" />
          <p className="hackathon">Hackathon Colsubsidio × 30X</p>
        </div>

        <form className="form" onSubmit={entrar}>
          <h2>Iniciar sesión</h2>
          <p className="pista">Ingrese con su usuario corporativo.</p>

          <label>Usuario o código de empleado</label>
          <div className="campo-icono">
            <Icono nombre="perfil" tam={18} />
            <input
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </div>

          <label>PIN</label>
          <div className="campo-icono">
            <Icono nombre="candado" tam={18} />
            <input
              type="password"
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          <div>
            <label>Perfil</label>
            <div className="perfiles">
              <span className={perfil === "auxiliar" ? "sel" : ""}>
                {ETIQUETAS_PERFIL.auxiliar}
              </span>
              <span className={perfil === "auditor" ? "sel" : ""}>
                {ETIQUETAS_PERFIL.auditor}
              </span>
            </div>
          </div>

          {err && <span className="error">{err}</span>}

          <button className="btn" type="submit" disabled={cargando || !usuario || !clave}>
            {cargando ? "Entrando…" : "ENTRAR"}
          </button>

          {hayLector && tieneHuella && (
            <button type="button" className="btn borde" disabled={entrandoConHuella}
                    onClick={entrarConHuella}>
              {entrandoConHuella ? "Leyendo huella…" : "Entrar con la huella del dispositivo"}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
