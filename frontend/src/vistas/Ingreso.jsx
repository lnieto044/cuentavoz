import { useEffect, useState } from "react";
import { pedir, esFalloRed } from "../api";
import {
  registrarse, reenviarCodigoRegistro, confirmarRegistro, iniciarSesion,
  confirmarCodigoMFA, recuperarClave, confirmarNuevaClave, obtenerAtributosUsuario,
} from "../cognito";
import ChecklistClave, { claveCumplePolitica } from "../ChecklistClave";
import ConfigurarMFA from "../ConfigurarMFA";
import Icono from "../Iconos";

const ETIQUETAS_PERFIL = {
  auxiliar: "Auxiliar de inventarios",
  auditor: "Administrador de bodega",
};

/** Junta el token de Cognito con el perfil guardado en esta app (perfil,
    id, nombre...) - lo que App.jsx espera recibir de alEntrar(). Cognito
    ya confirmó a la persona, pero la fila local (creada por
    /api/registro-completado, ver confirmarYEntrar) a veces nunca llegó a
    crearse - por ejemplo si cerró la pestaña justo después de confirmar
    el código, antes de esa última llamada. En vez de dejar a alguien con
    una cuenta "a medias" varado en un 401 sin salida, se autocompleta
    aquí mismo con los datos que Cognito sí tiene (nombre/correo) y se
    reintenta - transparente para quien inicia sesión. */
// El backend responde esto (503) cuando no pudo consultarle a Cognito las
// llaves para verificar el token - no es culpa del token ni de la persona
// (ver seguridad.py: ServicioIdentidadCaido), así que vale la pena
// reintentar solo en vez de mandarla de vuelta al login.
function esCognitoNoDisponible(e) {
  return e.message === "No se pudo verificar su sesion en este momento. Intente de nuevo.";
}

/** Reintenta lo que falló por algo pasajero, no por culpa de quien ingresa.
    Dos casos, los dos reales:
    - El backend vive en el plan gratuito de Render: si lleva 15 minutos sin
      tráfico se duerme, y la petición que lo despierta tarda 30-50 segundos
      o se corta en seco. Sin esto, quien se está registrando ve el botón
      congelado en «Confirmando…», y al reintentar un «Sin conexión con el
      servidor» que además es falso - su Wi-Fi está bien, el servidor estaba
      dormido.
    - Cognito no respondió al verificar el token (ver seguridad.py).
    alEsperar avisa a la pantalla para que diga qué está pasando en vez de
    dejar un botón mudo. */
// Despertar el servicio dormido de Render tarda entre 30 y 50 segundos, asi
// que la espera total tiene que cubrir eso con margen: 2+4+6+8+10+12+15 = 57
// segundos repartidos en 8 intentos. Un reintento corto (los 9 s que habia
// antes) se agota entero DENTRO de la ventana de arranque y falla igual.
const ESPERAS = [2000, 4000, 6000, 8000, 10000, 12000, 15000];

async function conPaciencia(fn, alEsperar) {
  for (let intento = 0; ; intento++) {
    try {
      return await fn();
    } catch (e) {
      const recuperable = esFalloRed(e) || esCognitoNoDisponible(e);
      if (!recuperable || intento >= ESPERAS.length) {
        if (recuperable) {
          // Ya no es "revise su Wi-Fi": la red de esta persona esta bien,
          // el servidor no alcanzo a despertar. Culpar al Wi-Fi manda a
          // buscar el problema donde no esta.
          const falla = new Error("El servidor está tardando en responder. "
            + "Espere unos segundos y vuelva a intentarlo.");
          falla.esFalloRed = true;
          throw falla;
        }
        throw e;
      }
      alEsperar?.(intento + 1);
      await new Promise((r) => setTimeout(r, ESPERAS[intento]));
    }
  }
}

async function sesionCompleta(token, alEsperar) {
  const perfil = () => conPaciencia(() => pedir("/api/usuarios/yo", {}, token), alEsperar);
  try {
    return { token, usuario: await perfil() };
  } catch (e) {
    if (e.message !== "Usuario no reconocido.") throw e;
    const atributos = await obtenerAtributosUsuario();
    await conPaciencia(() => pedir("/api/registro-completado", {
      method: "POST",
      body: JSON.stringify({ nombre_completo: atributos.nombreCompleto, correo: atributos.correo }),
    }, token), alEsperar);
    return { token, usuario: await perfil() };
  }
}

/** Aviso de código enviado por correo, con el icono de sobre y el
    destino ya enmascarado por Cognito (p***@m***) - misma idea que la
    pantalla "Confirm your account" de Cognito. */
function AvisoCodigo({ destino, onReenviar, reenviando, reenviado }) {
  return (
    <>
      <div className="aviso-codigo">
        <Icono nombre="mensajes" tam={18} />
        <span>
          Le enviamos un código a <b>{destino || "su correo"}</b>. Ingréselo para continuar.
        </span>
      </div>
      <button type="button" className="reenviar-codigo" onClick={onReenviar} disabled={reenviando}>
        {reenviando ? "Reenviando…" : reenviado ? "Código reenviado" : "Reenviar código"}
      </button>
    </>
  );
}

export default function Ingreso({ alEntrar, avisoInicial }) {
  // "login" | "login-mfa" | "registro" | "registro-codigo" | "registro-mfa" |
  // "recuperar" | "recuperar-codigo"
  const [modo, setModo] = useState("login");
  // la sesión ya está lista (Cognito + fila local) apenas se confirma el
  // registro - se guarda aquí mientras se ofrece activar la verificación
  // en dos pasos, y solo se entrega a alEntrar() al terminar ese paso
  // (activarla o saltarla).
  const [sesionPendiente, setSesionPendiente] = useState(null);
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [err, setErr] = useState(avisoInicial || "");
  // errores DE UN CAMPO puntual (falta diligenciarlo, o quedó mal), para
  // señalar justo debajo de ese campo - "err" (arriba) queda para lo que
  // no es de un campo en particular (usuario o clave incorrectos, fallas
  // del servidor...).
  const [errCampo, setErrCampo] = useState({});
  const [cargando, setCargando] = useState(false);
  // Lo que está pasando mientras se espera - solo aparece si de verdad hay
  // que esperar (servidor dormido, ver conPaciencia), para que el botón no
  // se quede mudo y parezca colgado.
  const [avisoEspera, setAvisoEspera] = useState("");
  const avisarEspera = (intento) =>
    setAvisoEspera("El servidor estaba en reposo y está despertando "
                   + `(intento ${intento})… puede tardar hasta un minuto.`);
  const [perfil, setPerfil] = useState(null);

  /** onChange que además borra el error de ESE campo apenas la persona
      empieza a corregirlo, en vez de dejarlo marcado en rojo hasta el
      próximo intento de enviar. */
  function actualizar(setter, campo) {
    return (e) => {
      setter(e.target.value);
      setErrCampo((prev) => (prev[campo] ? { ...prev, [campo]: null } : prev));
    };
  }

  // registro
  const [nombreCompleto, setNombreCompleto] = useState("");
  const [codigoEmpleado, setCodigoEmpleado] = useState("");
  const [correo, setCorreo] = useState("");
  const [clave2, setClave2] = useState("");
  const [codigo, setCodigo] = useState("");
  const [destinoCodigo, setDestinoCodigo] = useState("");
  const [reenviando, setReenviando] = useState(false);
  const [reenviado, setReenviado] = useState(false);
  // recuperar
  const [claveNueva, setClaveNueva] = useState("");
  const [claveNueva2, setClaveNueva2] = useState("");
  // login con verificación en dos pasos
  const [mfaPendiente, setMfaPendiente] = useState(null);
  const [codigoMFA, setCodigoMFA] = useState("");

  // Despierta el backend apenas se abre esta pantalla, sin esperar a que
  // alguien pulse nada. En el plan gratuito de Render el servicio se duerme
  // tras 15 minutos sin tráfico y tarda 30-50 segundos en levantarse; ese
  // tiempo se lo comía la primera acción de la persona (confirmar el código
  // del correo, justo el peor momento). Iniciándolo aquí, mientras se
  // escriben los datos y llega el correo, el servidor ya está listo cuando
  // de verdad hace falta. /api/salud no pide sesión y no cambia nada.
  useEffect(() => {
    pedir("/api/salud").catch(() => {});
  }, []);

  // apenas escribe el usuario se identifica el perfil solo - no hay que
  // elegirlo a mano. Con demora corta para no disparar una llamada por
  // cada tecla. Solo aplica en login: en registro el usuario es nuevo,
  // no tiene perfil todavía que detectar.
  useEffect(() => {
    if (modo !== "login") { setPerfil(null); return; }
    const entrada = usuario.trim();
    if (!entrada) { setPerfil(null); return; }
    const espera = setTimeout(() => {
      pedir(`/api/usuarios/perfil?usuario=${encodeURIComponent(entrada)}`)
        .then((r) => setPerfil(r.perfil))
        .catch(() => setPerfil(null));
    }, 350);
    return () => clearTimeout(espera);
  }, [usuario, modo]);

  function cambiarModo(nuevo) {
    setModo(nuevo);
    setErr(""); setErrCampo({}); setReenviado(false); setAvisoEspera("");
  }

  /** Cierra el registro después del paso de la verificación en dos pasos,
      se haya activado o saltado: entra directo a la aplicación. */
  function terminarRegistro() {
    alEntrar(sesionPendiente);
  }

  async function entrar(e) {
    e?.preventDefault();
    setErr("");
    const errores = {};
    if (!usuario.trim()) errores.usuario = "Digite su usuario.";
    if (!clave) errores.clave = "Digite su clave.";
    if (Object.keys(errores).length) return setErrCampo(errores);
    setErrCampo({});
    setCargando(true);
    try {
      const r = await iniciarSesion(usuario.trim(), clave);
      if (r.mfaPendiente) {
        setMfaPendiente(r.mfaPendiente);
        setModo("login-mfa");
        return;
      }
      alEntrar(await sesionCompleta(r.token, avisarEspera));
    } catch (e2) {
      if (e2.code === "UserNotConfirmedException") {
        // se registró antes pero nunca terminó de confirmar el código
        // (cerró la pestaña, se le olvidó...) - en vez de dejarlo
        // varado con un error sin salida, se le reenvía un código
        // nuevo y se le lleva directo a esa pantalla.
        try {
          const { destino } = await reenviarCodigoRegistro(usuario.trim());
          setDestinoCodigo(destino);
          setModo("registro-codigo");
        } catch (e3) {
          setErr(e3.message);
        }
      } else {
        setErr(e2.message);
      }
    } finally {
      setCargando(false);
      setAvisoEspera("");
    }
  }

  async function confirmarMFALogin(e) {
    e?.preventDefault();
    setErr("");
    if (!codigoMFA.trim()) return setErrCampo({ codigoMFA: "Digite el código de 6 dígitos." });
    setErrCampo({});
    setCargando(true);
    try {
      const token = await confirmarCodigoMFA(mfaPendiente, codigoMFA.trim());
      alEntrar(await sesionCompleta(token, avisarEspera));
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setCargando(false);
      setAvisoEspera("");
    }
  }

  async function pedirRegistro(e) {
    e?.preventDefault();
    setErr("");
    const errores = {};
    if (!nombreCompleto.trim()) errores.nombreCompleto = "Digite su nombre completo.";
    if (!correo.trim()) errores.correo = "Digite su correo.";
    else if (!correo.includes("@") || !correo.includes(".")) errores.correo = "Ese correo no parece válido.";
    if (!usuario.trim()) errores.usuario = "Elija un usuario.";
    if (!clave) errores.clave = "Digite una clave.";
    else if (!claveCumplePolitica(clave)) errores.clave = "La clave no cumple los requisitos de arriba.";
    if (!clave2) errores.clave2 = "Confirme la clave.";
    else if (clave !== clave2) errores.clave2 = "Las dos claves no coinciden.";
    if (Object.keys(errores).length) return setErrCampo(errores);
    setErrCampo({});
    setCargando(true);
    try {
      const { destino } = await registrarse(usuario.trim(), clave, correo.trim(), nombreCompleto.trim());
      setDestinoCodigo(destino);
      setModo("registro-codigo");
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setCargando(false);
      setAvisoEspera("");
    }
  }

  async function reenviarRegistro() {
    setReenviando(true); setErr("");
    try {
      const { destino } = await reenviarCodigoRegistro(usuario.trim());
      if (destino) setDestinoCodigo(destino);
      setReenviado(true);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setReenviando(false);
    }
  }

  async function confirmarYEntrar(e) {
    e?.preventDefault();
    setErr("");
    if (!codigo.trim()) return setErrCampo({ codigo: "Digite el código de 6 dígitos." });
    setErrCampo({});
    setCargando(true);
    try {
      await confirmarRegistro(usuario.trim(), codigo.trim());
      const r = await iniciarSesion(usuario.trim(), clave);
      // (una cuenta recién registrada nunca tiene MFA activo todavía,
      // r.mfaPendiente no aplica aquí)
      const token = r.token;
      // el nombre/correo se piden de nuevo a Cognito (no del formulario en
      // memoria): si esta pantalla se llegó desde "reanudar confirmación"
      // tras un login fallido (ver entrar()), nunca se llenó el formulario
      // de registro en esta sesión del navegador - solo Cognito los tiene.
      const atributos = await obtenerAtributosUsuario();
      // crea la fila local (perfil auxiliar, siempre - ver main.py) con
      // los datos personales que Cognito no guarda. Con conPaciencia porque
      // esta es la PRIMERA llamada al backend de todo el registro: si el
      // servicio estaba dormido (plan gratuito de Render), le toca a ella
      // despertarlo, y sin reintento fallaba dejando la cuenta a medias -
      // confirmada en Cognito pero sin fila local.
      await conPaciencia(() => pedir("/api/registro-completado", {
        method: "POST",
        body: JSON.stringify({
          nombre_completo: atributos.nombreCompleto,
          codigo: codigoEmpleado.trim(),
          correo: atributos.correo,
        }),
      }, token), avisarEspera);
      // antes de entrar del todo, se ofrece (opcional, se puede saltar)
      // activar la verificación en dos pasos - más fácil que alguien la
      // active aquí, recién registrado, que que se acuerde de ir a
      // buscarla después en Mi perfil.
      setSesionPendiente(await sesionCompleta(token, avisarEspera));
      setModo("registro-mfa");
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setCargando(false);
      setAvisoEspera("");
    }
  }

  async function pedirRecuperar(e) {
    e?.preventDefault();
    setErr("");
    if (!usuario.trim()) return setErrCampo({ usuario: "Digite su usuario." });
    setErrCampo({});
    setCargando(true);
    try {
      const { destino } = await recuperarClave(usuario.trim());
      setDestinoCodigo(destino);
      setModo("recuperar-codigo");
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setCargando(false);
      setAvisoEspera("");
    }
  }

  async function reenviarRecuperar() {
    setReenviando(true); setErr("");
    try {
      const { destino } = await recuperarClave(usuario.trim());
      if (destino) setDestinoCodigo(destino);
      setReenviado(true);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setReenviando(false);
    }
  }

  async function confirmarRecuperar(e) {
    e?.preventDefault();
    setErr("");
    const errores = {};
    if (!codigo.trim()) errores.codigo = "Digite el código de 6 dígitos.";
    if (!claveNueva) errores.claveNueva = "Digite una clave nueva.";
    else if (!claveCumplePolitica(claveNueva)) errores.claveNueva = "La clave no cumple los requisitos de arriba.";
    if (!claveNueva2) errores.claveNueva2 = "Confirme la clave nueva.";
    else if (claveNueva !== claveNueva2) errores.claveNueva2 = "Las dos claves no coinciden.";
    if (Object.keys(errores).length) return setErrCampo(errores);
    setErrCampo({});
    setCargando(true);
    try {
      await confirmarNuevaClave(usuario.trim(), codigo.trim(), claveNueva);
      setClave(""); setCodigo(""); setClaveNueva(""); setClaveNueva2("");
      setModo("login");
      setErr("");
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setCargando(false);
      setAvisoEspera("");
    }
  }

  const campo = { width: "100%", padding: "11px 13px", marginBottom: 8,
                  border: "1px solid var(--borde)", borderRadius: 12 };

  // <main> aquí también: en el ingreso no hay navegación que saltarse,
  // pero un lector de pantalla sigue necesitando saber dónde empieza el
  // contenido de la página.
  return (
    <main className="ingreso-fondo">
      <div className="ingreso">
        <div className="marca-cabecera">
          <img className="app" src="/logo.png" alt="CuentaVoz" width={52} />
          <h1>CuentaVoz</h1>
          <i>Tu voz cuenta</i>
          <p className="hackathon">Hackathon Colsubsidio × 30X</p>
        </div>

        {modo === "login" && (
          <form className="form" onSubmit={entrar} noValidate>
            <h2>Iniciar sesión</h2>
            <p className="pista">Ingrese con su usuario corporativo.</p>

            <label htmlFor="campo-usuario">Usuario</label>
            <div className="campo-icono">
              <Icono nombre="perfil" tam={18} />
              <input
                id="campo-usuario"
                value={usuario}
                onChange={actualizar(setUsuario, "usuario")}
                autoComplete="username"
                aria-invalid={!!errCampo.usuario}
                autoFocus
              />
            </div>
            {errCampo.usuario && <span className="error-campo" role="alert">{errCampo.usuario}</span>}

            <label htmlFor="campo-clave">Clave</label>
            <div className="campo-icono">
              <Icono nombre="candado" tam={18} />
              <input
                id="campo-clave"
                type="password"
                value={clave}
                onChange={actualizar(setClave, "clave")}
                autoComplete="current-password"
                aria-invalid={!!errCampo.clave}
              />
            </div>
            {errCampo.clave && <span className="error-campo" role="alert">{errCampo.clave}</span>}

            <div>
              <span id="etiqueta-perfil" style={{ fontSize: ".8rem", color: "var(--grafito)" }}>
                Perfil
              </span>
              <p aria-live="polite" className="pista" style={{ minHeight: "1.1em", margin: "2px 0 4px" }}>
                {perfil ? `Perfil detectado: ${ETIQUETAS_PERFIL[perfil]}` : ""}
              </p>
              <div className="perfiles" role="group" aria-labelledby="etiqueta-perfil">
                <span className={perfil === "auxiliar" ? "sel" : ""}>{ETIQUETAS_PERFIL.auxiliar}</span>
                <span className={perfil === "auditor" ? "sel" : ""}>{ETIQUETAS_PERFIL.auditor}</span>
              </div>
            </div>

            {err && <span className="error" role="alert">{err}</span>}
            {avisoEspera && <span className="pista" role="status">{avisoEspera}</span>}

            <button className="btn" type="submit" disabled={cargando}>
              {cargando ? "Entrando…" : "ENTRAR"}
            </button>

            <p className="enlaces-ingreso">
              <button type="button" className="enlace" onClick={() => cambiarModo("recuperar")}>
                Olvidé mi clave
              </button>
              {" · "}
              <button type="button" className="enlace" onClick={() => cambiarModo("registro")}>
                Crear una cuenta
              </button>
            </p>
          </form>
        )}

        {modo === "login-mfa" && (
          <form className="form" onSubmit={confirmarMFALogin} noValidate>
            <h2>Verificación en dos pasos</h2>
            <p className="pista">Digite el código de 6 dígitos de su app autenticadora.</p>

            <label htmlFor="mfa-codigo">Código</label>
            <input id="mfa-codigo" style={campo} value={codigoMFA} inputMode="numeric"
                   onChange={actualizar(setCodigoMFA, "codigoMFA")}
                   aria-invalid={!!errCampo.codigoMFA} autoFocus />
            {errCampo.codigoMFA && <span className="error-campo" role="alert">{errCampo.codigoMFA}</span>}

            {err && <span className="error" role="alert">{err}</span>}
            {avisoEspera && <span className="pista" role="status">{avisoEspera}</span>}

            <button className="btn" type="submit" disabled={cargando}>
              {cargando ? "Verificando…" : "VERIFICAR Y ENTRAR"}
            </button>
          </form>
        )}

        {modo === "registro" && (
          <form className="form" onSubmit={pedirRegistro} noValidate>
            <h2>Crear una cuenta</h2>
            <p className="pista">La cuenta queda como auxiliar de inventarios.</p>

            <div className="campos-2col">
              <div>
                <label htmlFor="reg-nombre">Nombre completo</label>
                <input id="reg-nombre" style={campo} value={nombreCompleto}
                       onChange={actualizar(setNombreCompleto, "nombreCompleto")}
                       aria-invalid={!!errCampo.nombreCompleto} autoFocus />
                {errCampo.nombreCompleto && <span className="error-campo" role="alert">{errCampo.nombreCompleto}</span>}
              </div>
              <div>
                <label htmlFor="reg-codigo-empleado">Código de empleado (opcional)</label>
                <input id="reg-codigo-empleado" style={campo} value={codigoEmpleado}
                       onChange={(e) => setCodigoEmpleado(e.target.value)} />
              </div>
            </div>

            <div className="campos-2col">
              <div>
                <label htmlFor="reg-correo">Correo corporativo</label>
                <input id="reg-correo" type="email" style={campo} value={correo}
                       onChange={actualizar(setCorreo, "correo")} autoComplete="email"
                       aria-invalid={!!errCampo.correo} />
                {errCampo.correo && <span className="error-campo" role="alert">{errCampo.correo}</span>}
              </div>
              <div>
                <label htmlFor="reg-usuario">Usuario</label>
                <input id="reg-usuario" style={campo} value={usuario}
                       onChange={actualizar(setUsuario, "usuario")} autoComplete="username"
                       aria-invalid={!!errCampo.usuario} />
                {errCampo.usuario && <span className="error-campo" role="alert">{errCampo.usuario}</span>}
              </div>
            </div>

            <div className="campos-2col">
              <div>
                <label htmlFor="reg-clave">Clave</label>
                <input id="reg-clave" type="password" style={campo} value={clave}
                       onChange={actualizar(setClave, "clave")} autoComplete="new-password"
                       aria-invalid={!!errCampo.clave} />
                {errCampo.clave && <span className="error-campo" role="alert">{errCampo.clave}</span>}
              </div>
              <div>
                <label htmlFor="reg-clave2">Confirmar clave</label>
                <input id="reg-clave2" type="password" style={campo} value={clave2}
                       onChange={actualizar(setClave2, "clave2")} autoComplete="new-password"
                       aria-invalid={!!errCampo.clave2} />
                {errCampo.clave2 && <span className="error-campo" role="alert">{errCampo.clave2}</span>}
              </div>
            </div>
            <ChecklistClave clave={clave} />

            {err && <span className="error" role="alert">{err}</span>}
            {avisoEspera && <span className="pista" role="status">{avisoEspera}</span>}

            <button className="btn" type="submit" disabled={cargando}>
              {cargando ? "Creando cuenta…" : "CREAR CUENTA"}
            </button>
            <p className="enlaces-ingreso">
              <button type="button" className="enlace" onClick={() => cambiarModo("login")}>
                Ya tengo una cuenta
              </button>
            </p>
          </form>
        )}

        {modo === "registro-codigo" && (
          <form className="form" onSubmit={confirmarYEntrar} noValidate>
            <h2>Confirmar correo</h2>
            <AvisoCodigo destino={destinoCodigo} onReenviar={reenviarRegistro}
                         reenviando={reenviando} reenviado={reenviado} />

            <label htmlFor="reg-codigo">Código de 6 dígitos</label>
            <input id="reg-codigo" style={campo} value={codigo} inputMode="numeric"
                   onChange={actualizar(setCodigo, "codigo")} aria-invalid={!!errCampo.codigo} autoFocus />
            {errCampo.codigo && <span className="error-campo" role="alert">{errCampo.codigo}</span>}

            {err && <span className="error" role="alert">{err}</span>}
            {avisoEspera && <span className="pista" role="status">{avisoEspera}</span>}

            <button className="btn" type="submit" disabled={cargando}>
              {cargando ? "Confirmando…" : "CONFIRMAR Y ENTRAR"}
            </button>
          </form>
        )}

        {modo === "registro-mfa" && (
          <div className="form">
            <h2>¿Verificación en dos pasos?</h2>
            <p className="pista">
              Opcional: pida un código de su celular además de la clave, al ingresar. Se puede
              activar o desactivar después desde Mi perfil.
            </p>
            <ConfigurarMFA nombreUsuario={usuario.trim()}
                           onActivado={terminarRegistro}
                           onCancelar={terminarRegistro}
                           textoCancelar="Ahora no" />
          </div>
        )}

        {modo === "recuperar" && (
          <form className="form" onSubmit={pedirRecuperar} noValidate>
            <h2>Olvidé mi clave</h2>
            <p className="pista">Le enviaremos un código al correo registrado.</p>

            <label htmlFor="rec-usuario">Usuario</label>
            <input id="rec-usuario" style={campo} value={usuario}
                   onChange={actualizar(setUsuario, "usuario")} autoComplete="username"
                   aria-invalid={!!errCampo.usuario} autoFocus />
            {errCampo.usuario && <span className="error-campo" role="alert">{errCampo.usuario}</span>}

            {err && <span className="error" role="alert">{err}</span>}
            {avisoEspera && <span className="pista" role="status">{avisoEspera}</span>}

            <button className="btn" type="submit" disabled={cargando}>
              {cargando ? "Enviando…" : "ENVIAR CÓDIGO"}
            </button>
            <p className="enlaces-ingreso">
              <button type="button" className="enlace" onClick={() => cambiarModo("login")}>
                Volver a iniciar sesión
              </button>
            </p>
          </form>
        )}

        {modo === "recuperar-codigo" && (
          <form className="form" onSubmit={confirmarRecuperar} noValidate>
            <h2>Nueva clave</h2>
            <AvisoCodigo destino={destinoCodigo} onReenviar={reenviarRecuperar}
                         reenviando={reenviando} reenviado={reenviado} />

            <label htmlFor="rec-codigo">Código de 6 dígitos</label>
            <input id="rec-codigo" style={campo} value={codigo} inputMode="numeric"
                   onChange={actualizar(setCodigo, "codigo")} aria-invalid={!!errCampo.codigo} autoFocus />
            {errCampo.codigo && <span className="error-campo" role="alert">{errCampo.codigo}</span>}

            <label htmlFor="rec-clave">Clave nueva</label>
            <input id="rec-clave" type="password" style={campo} value={claveNueva}
                   onChange={actualizar(setClaveNueva, "claveNueva")} autoComplete="new-password"
                   aria-invalid={!!errCampo.claveNueva} />
            {errCampo.claveNueva && <span className="error-campo" role="alert">{errCampo.claveNueva}</span>}
            <ChecklistClave clave={claveNueva} />

            <label htmlFor="rec-clave2">Confirmar clave nueva</label>
            <input id="rec-clave2" type="password" style={campo} value={claveNueva2}
                   onChange={actualizar(setClaveNueva2, "claveNueva2")} autoComplete="new-password"
                   aria-invalid={!!errCampo.claveNueva2} />
            {errCampo.claveNueva2 && <span className="error-campo" role="alert">{errCampo.claveNueva2}</span>}

            {err && <span className="error" role="alert">{err}</span>}
            {avisoEspera && <span className="pista" role="status">{avisoEspera}</span>}

            <button className="btn" type="submit" disabled={cargando}>
              {cargando ? "Guardando…" : "GUARDAR CLAVE NUEVA"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
