/** Envío real de correo para "Soporte en vivo" (mensajes y respuestas
    entre auxiliares y administrador), compartido entre Ayuda.jsx y
    Mensajes.jsx para no duplicar credenciales ni lógica.

    La Public Key de EmailJS está hecha para ir en el código del
    frontend (a diferencia de una clave de API común, no es secreta -
    así lo documenta EmailJS). El correo sale desde el navegador de
    quien escribe, usando la cuenta de Gmail conectada en el panel de
    EmailJS - por eso no pasa por la red de Render, que es lo que
    bloqueaba el SMTP directo a Gmail y la API de Resend. */
const EMAILJS_SERVICE_ID = "service_9dgu33i";
const EMAILJS_TEMPLATE_ID = "template_9ddkqpa";
const EMAILJS_PUBLIC_KEY = "raCRzjMA9m2ymYuwk";

export async function enviarPorEmailJS(destinatario, nombreRemitente, mensaje, rol, correoRemitente) {
  try {
    const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        template_params: {
          to_email: destinatario, name: nombreRemitente, message: mensaje,
          rol: rol || "", correo_remitente: correoRemitente || "",
          fecha: new Date().toLocaleString("es-CO", {
            day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit",
          }),
        },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// admin.nombre y usuario.nombre llegan en minúscula (el resto de la app
// los capitaliza con CSS) - para texto plano (firma del correo, mensajes
// de la bandeja) hay que capitalizarlos en JS.
export function capitalizar(nombre) {
  if (!nombre) return "";
  return nombre.split(" ").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

// Misma etiqueta que usa el resto de la app (BarraLateral, MiPerfil,
// Ingreso) para el rol - así la firma del correo y la bandeja dicen lo
// mismo que ve la persona dentro de CuentaVoz.
export function rolDe(usuario) {
  return usuario?.perfil === "auditor" ? "Administrador de bodega" : "Auxiliar de inventarios";
}
