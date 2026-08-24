// Identidad con AWS Cognito: registro, login y recuperar clave hablan
// DIRECTO con Cognito desde aquí (nunca por el backend - por eso el App
// Client no tiene secreto, está pensado para vivir en el navegador). El
// User Pool Id y el Client Id no son secretos (son el equivalente al
// "project id" de cualquier SDK de identidad que corre en el cliente);
// por eso llevan un valor por defecto, igual que VITE_API_URL en api.js,
// para que el proyecto funcione en local sin un .env aparte.
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
} from "amazon-cognito-identity-js";

const REGION = import.meta.env.VITE_COGNITO_REGION || "us-east-2";
const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID || "us-east-2_6HbrPruvL";
const CLIENT_ID = import.meta.env.VITE_COGNITO_APP_CLIENT_ID || "847jtkc5sem7mr4tb8csrrkqp";

const poolDatos = { UserPoolId: USER_POOL_ID, ClientId: CLIENT_ID };
const pool = new CognitoUserPool(poolDatos);

/** Traduce los códigos de error que Cognito manda (en inglés, pensados
    para un desarrollador) a algo que alguien en una bodega entienda. Los
    demás mensajes de Cognito ya vienen razonablemente claros en español
    parcial/inglés corto, así que solo se traducen los que de verdad
    confunden. */
function mensajeClaro(error) {
  const mapa = {
    UsernameExistsException: "Ese usuario ya existe. Inicie sesión o recupere su clave.",
    UserNotFoundException: "No existe ese usuario.",
    NotAuthorizedException: "Usuario o clave incorrectos.",
    CodeMismatchException: "El código no es correcto.",
    ExpiredCodeException: "El código venció. Pida uno nuevo.",
    InvalidPasswordException: "La clave debe tener al menos 8 caracteres, con mayúscula, "
      + "minúscula y número.",
    LimitExceededException: "Demasiados intentos. Espere un momento e intente de nuevo.",
    UserNotConfirmedException: "Falta confirmar el registro con el código enviado por correo.",
    EnableSoftwareTokenMFAException: "El código de la app autenticadora no es correcto.",
  };
  const msg = mapa[error?.code];
  const final = new Error(msg || error?.message || "No se pudo completar la operación.");
  final.code = error?.code;
  return final;
}

function usuarioCognito(nombre) {
  return new CognitoUser({ Username: nombre.trim().toLowerCase(), Pool: pool });
}

/** Crea la cuenta en Cognito. "name" es un atributo obligatorio del User
    Pool (además de email) - sin él Cognito rechaza el registro. Devuelve
    el destino enmascarado (p***@m***) que ya calcula Cognito, para
    mostrarlo igual que su propia pantalla "Confirm your account". */
export function registrarse(usuario, clave, correo, nombreCompleto) {
  return new Promise((resolve, reject) => {
    const atributos = [
      new CognitoUserAttribute({ Name: "email", Value: correo.trim() }),
      new CognitoUserAttribute({ Name: "name", Value: nombreCompleto.trim() }),
    ];
    pool.signUp(usuario.trim().toLowerCase(), clave, atributos, null, (error, resultado) => {
      if (error) return reject(mensajeClaro(error));
      resolve({ destino: resultado?.codeDeliveryDetails?.Destination || correo.trim() });
    });
  });
}

/** Reenvía el código de confirmación del registro (botón "Resend code"). */
export function reenviarCodigoRegistro(usuario) {
  return new Promise((resolve, reject) => {
    usuarioCognito(usuario).resendConfirmationCode((error, resultado) => {
      if (error) return reject(mensajeClaro(error));
      resolve({ destino: resultado?.CodeDeliveryDetails?.Destination || "" });
    });
  });
}

/** Confirma el código de 6 dígitos que Cognito manda por correo al
    registrarse - solo después de esto la cuenta puede iniciar sesión. */
export function confirmarRegistro(usuario, codigo) {
  return new Promise((resolve, reject) => {
    usuarioCognito(usuario).confirmRegistration(codigo, true, (error, resultado) => {
      // Si la cuenta YA estaba confirmada, no es un fallo: el objetivo de
      // esta función es "que quede confirmada", y ya lo está. Pasa de
      // verdad cuando el código se confirmó bien pero el paso siguiente
      // (crear la fila local) se cayó - al reintentar, Cognito responde
      // NotAuthorizedException, que mensajeClaro traduce a "Usuario o clave
      // incorrectos" y deja a la persona atascada sin salida, culpándola de
      // un dato que escribió bien. Se trata como exitoso y el flujo sigue.
      if (error) {
        const yaConfirmada = error.code === "NotAuthorizedException"
          && /current status is confirmed/i.test(error.message || "");
        if (yaConfirmada) return resolve({ yaEstaba: true });
        return reject(mensajeClaro(error));
      }
      resolve(resultado);
    });
  });
}

/** Nombre completo y correo tal cual quedaron en Cognito para la cuenta
    YA AUTENTICADA (sesión recién abierta) - se usa para completar el
    registro local (/api/registro-completado) cuando esos datos no
    vienen ya en memoria (p. ej. alguien que se registró, cerró la
    pestaña antes de confirmar el código, y vuelve después: en ese
    camino nunca se volvió a escribir el nombre/correo en el
    formulario, así que se recuperan de Cognito en vez de mandar
    campos vacíos). */
export function obtenerAtributosUsuario() {
  return new Promise((resolve, reject) => {
    const cu = pool.getCurrentUser();
    if (!cu) return reject(new Error("No hay una sesión activa."));
    cu.getSession((error) => {
      if (error) return reject(mensajeClaro(error));
      cu.getUserAttributes((error2, atributos) => {
        if (error2) return reject(mensajeClaro(error2));
        const porNombre = Object.fromEntries(
          (atributos || []).map((a) => [a.getName(), a.getValue()]));
        resolve({ nombreCompleto: porNombre.name || "", correo: porNombre.email || "" });
      });
    });
  });
}

/** Inicia sesión. Si la cuenta tiene activada la verificación en dos
    pasos (Mi perfil > Verificación en dos pasos - es opcional, no todos
    la tienen), Cognito no da el token de una vez sino que pide el código
    de la app autenticadora: devuelve { mfaPendiente } en vez de { token },
    y ese CognitoUser en curso hay que pasárselo tal cual a
    confirmarCodigoMFA() para terminar el ingreso (no se puede reconstruir
    solo con el usuario/clave: Cognito ata el reto a esa sesión de login
    específica). Con el token, el refresh token queda guardado por el
    propio SDK en localStorage, con su propio ciclo de refresco automático
    (ver obtenerTokenValido). */
export function iniciarSesion(usuario, clave) {
  return new Promise((resolve, reject) => {
    const cu = usuarioCognito(usuario);
    const detalles = new AuthenticationDetails({
      Username: usuario.trim().toLowerCase(), Password: clave,
    });
    cu.authenticateUser(detalles, {
      onSuccess: (sesion) => resolve({ token: sesion.getAccessToken().getJwtToken() }),
      onFailure: (error) => reject(mensajeClaro(error)),
      totpRequired: () => resolve({ mfaPendiente: cu }),
    });
  });
}

/** Termina un ingreso que quedó pendiente de código de verificación en
    dos pasos (ver iniciarSesion). */
export function confirmarCodigoMFA(mfaPendiente, codigo) {
  return new Promise((resolve, reject) => {
    mfaPendiente.sendMFACode(codigo, {
      onSuccess: (sesion) => resolve(sesion.getAccessToken().getJwtToken()),
      onFailure: (error) => reject(mensajeClaro(error)),
    }, "SOFTWARE_TOKEN_MFA");
  });
}

/** Pide el código de recuperación de clave, mandado al correo registrado.
    Devuelve el destino enmascarado que calcula Cognito (p***@m***). */
export function recuperarClave(usuario) {
  return new Promise((resolve, reject) => {
    usuarioCognito(usuario).forgotPassword({
      inputVerificationCode: (datos) => resolve({ destino: datos?.CodeDeliveryDetails?.Destination || "" }),
      onSuccess: () => resolve({ destino: "" }),
      onFailure: (error) => reject(mensajeClaro(error)),
    });
  });
}

/** Confirma el código de recuperación con la clave nueva. */
export function confirmarNuevaClave(usuario, codigo, claveNueva) {
  return new Promise((resolve, reject) => {
    usuarioCognito(usuario).confirmPassword(codigo, claveNueva, {
      onSuccess: () => resolve(),
      onFailure: (error) => reject(mensajeClaro(error)),
    });
  });
}

/** Cambia la clave con la sesión ya abierta (Mi perfil) - exige la clave
    vigente, igual que el cambio de PIN de antes. */
export function cambiarClave(claveActual, claveNueva) {
  return new Promise((resolve, reject) => {
    const cu = pool.getCurrentUser();
    if (!cu) return reject(new Error("No hay una sesión activa."));
    cu.getSession((error) => {
      if (error) return reject(mensajeClaro(error));
      cu.changePassword(claveActual, claveNueva, (error2) => {
        if (error2) return reject(mensajeClaro(error2));
        resolve();
      });
    });
  });
}

/** Si la persona ya autenticada tiene activa la verificación en dos pasos
    (TOTP) - para saber qué mostrar en Mi perfil: "activar" o "desactivar". */
export function tieneMFAActiva() {
  return new Promise((resolve, reject) => {
    const cu = pool.getCurrentUser();
    if (!cu) return reject(new Error("No hay una sesión activa."));
    cu.getSession((error) => {
      if (error) return reject(mensajeClaro(error));
      cu.getUserData((error2, datos) => {
        if (error2) return reject(mensajeClaro(error2));
        resolve((datos?.UserMFASettingList || []).includes("SOFTWARE_TOKEN_MFA"));
      }, { bypassCache: true });
    });
  });
}

/** Primer paso de activar la verificación en dos pasos: le pide a Cognito
    una llave secreta nueva para esta cuenta (para el QR/la llave manual)
    - todavía no queda activada, eso pasa en confirmarActivacionMFA(). */
export function iniciarActivacionMFA() {
  return new Promise((resolve, reject) => {
    const cu = pool.getCurrentUser();
    if (!cu) return reject(new Error("No hay una sesión activa."));
    cu.getSession((error) => {
      if (error) return reject(mensajeClaro(error));
      cu.associateSoftwareToken({
        associateSecretCode: (llave) => resolve(llave),
        onFailure: (error2) => reject(mensajeClaro(error2)),
      });
    });
  });
}

/** Segundo paso: confirma con el código de 6 dígitos que generó la app
    autenticadora a partir de la llave, y de una vez la marca como el
    método de verificación en dos pasos de la cuenta. */
export function confirmarActivacionMFA(codigo) {
  return new Promise((resolve, reject) => {
    const cu = pool.getCurrentUser();
    if (!cu) return reject(new Error("No hay una sesión activa."));
    // Sin getSession() primero, cu.signInUserSession queda null (recién
    // construido por getCurrentUser(), no hidratado desde el localStorage
    // del SDK) - verifySoftwareToken() lo interpreta como una sesion de
    // RETO en curso (usa this.Session, que aqui no existe) en vez de
    // usuario-ya-autenticado (usa el AccessToken), y Cognito responde
    // NotAuthorizedException en vez de validar el codigo.
    cu.getSession((error0) => {
      if (error0) return reject(mensajeClaro(error0));
      cu.verifySoftwareToken(codigo, "CuentaVoz", {
        onSuccess: () => {
          cu.setUserMfaPreference(null, { Enabled: true, PreferredMfa: true }, (error) => {
            if (error) return reject(mensajeClaro(error));
            resolve();
          });
        },
        onFailure: (error) => reject(mensajeClaro(error)),
      });
    });
  });
}

/** Desactiva la verificación en dos pasos para esta cuenta. */
export function desactivarMFA() {
  return new Promise((resolve, reject) => {
    const cu = pool.getCurrentUser();
    if (!cu) return reject(new Error("No hay una sesión activa."));
    cu.getSession((error) => {
      if (error) return reject(mensajeClaro(error));
      cu.setUserMfaPreference(null, { Enabled: false, PreferredMfa: false }, (error2) => {
        if (error2) return reject(mensajeClaro(error2));
        resolve();
      });
    });
  });
}

/** El URI estándar (otpauth://) que cualquier app autenticadora (Google
    Authenticator, Authy, etc.) sabe leer desde un QR - MiPerfil.jsx lo
    convierte en imagen con la librería "qrcode". */
export function uriOtpAuth(llaveSecreta, usuario) {
  const etiqueta = encodeURIComponent(`CuentaVoz:${usuario}`);
  return `otpauth://totp/${etiqueta}?secret=${llaveSecreta}&issuer=CuentaVoz`;
}

/** Access token vigente del usuario ya autenticado, refrescándolo solo
    con el refresh token si ya venció (el SDK lo hace por su cuenta al
    llamar getSession, sin pedirle nada a la persona) - así el access
    token corto (1 hora, ver ARQUITECTURA.md) no obliga a reingresar cada
    hora. Devuelve null si no hay sesión (nunca ingresó o el refresh token
    también venció, a los 30 días). */
export function obtenerTokenValido() {
  return new Promise((resolve) => {
    const cu = pool.getCurrentUser();
    if (!cu) return resolve(null);
    cu.getSession((error, sesion) => {
      if (error || !sesion?.isValid()) return resolve(null);
      resolve(sesion.getAccessToken().getJwtToken());
    });
  });
}

/** Cierra la sesión guardada por el SDK en ESTE navegador (no revoca nada
    en Cognito - para eso está "cerrar todas las sesiones" en Mi perfil,
    que sí llama al backend). */
export function cerrarSesionLocal() {
  pool.getCurrentUser()?.signOut();
}
