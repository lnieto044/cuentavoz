import { useEffect, useState, useRef } from "react";
import { pedir, preguntarAsistente } from "../api";
import { escuchar, hablar, quitarTildes } from "../voz";
import Marco from "../Marco";
import Dialogo from "../Dialogo";

const FAQ = [
  ["¿Cómo corrijo un conteo ya confirmado?",
   "Diga «corregir» y luego el valor correcto. El valor anterior se conserva."],
  ["El agente no me entiende un producto",
   "Dígalo como aparece en la etiqueta. Si no existe, se puede crear: queda pendiente."],
  ["¿Qué hago si sale una alerta?",
   "Recuente. Si el número es correcto, confirme: queda marcado para el administrador."],
  ["Se cayó el internet en plena bodega",
   "Siga contando: el intérprete local mantiene el flujo y sincroniza al volver la señal."],
  ["¿Puedo contar dos bodegas a la vez?",
   "No en el mismo dispositivo. El candado de sesión evita conteos duplicados."],
];

const COMANDOS = [
  ["«Iniciar conteo en almacén de suministros»", "abrir una bodega"],
  ["«Tres tablas para picar blancas»", "registrar un conteo"],
  ["«Corregir» · «Son nueve»", "corregir sin borrar el original"],
  ["«¿Cuánto arroz hay y en qué bodegas?»", "consultar el inventario"],
  ["«Hoy preparamos cincuenta ajiacos»", "pedir insumos por receta"],
];

// Envía "Escribirle al administrador" de verdad, sin abrir otra
// aplicación ni depender de una cuenta de correo propia de CuentaVoz: la
// Public Key de EmailJS está hecha para ir en el código del frontend
// (a diferencia de una clave de API común, no es secreta - así lo
// documenta EmailJS). El correo sale desde el navegador de quien
// escribe, usando la cuenta de Gmail conectada en el panel de EmailJS -
// por eso no pasa por la red de Render, que es lo que bloqueaba el SMTP
// directo a Gmail y la API de Resend.
const EMAILJS_SERVICE_ID = "service_9dgu33i";
const EMAILJS_TEMPLATE_ID = "template_9ddkqpa";
const EMAILJS_PUBLIC_KEY = "raCRzjMA9m2ymYuwk";

async function _enviarPorEmailJS(destinatario, nombreRemitente, mensaje, rol, correoRemitente) {
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

export default function Ayuda({ token, usuario, ir }) {
  const [salud, setSalud] = useState(null);
  const [busca, setBusca] = useState("");
  const [reportando, setReportando] = useState(false);
  const [msg, setMsg] = useState("");
  const [pedirDetalle, setPedirDetalle] = useState(false);
  const [escribiendoAdmin, setEscribiendoAdmin] = useState(false);
  const [enviandoAdmin, setEnviandoAdmin] = useState(false);
  const [admin, setAdmin] = useState(null);
  const [miPerfil, setMiPerfil] = useState(null);
  // Bandeja de "Soporte en vivo" dentro de la app: para un auxiliar, sus
  // mensajes enviados y si ya le respondieron; para el administrador,
  // los mensajes que le han escrito y cuáles faltan por responder.
  const [misMensajes, setMisMensajes] = useState([]);
  const [respondiendoId, setRespondiendoId] = useState(null);
  const [enviandoRespuesta, setEnviandoRespuesta] = useState(false);
  // Si lo escrito/dicho no encuentra nada en las preguntas frecuentes ni
  // en la guía de comandos, la respuesta del agente general - mismo
  // patrón que el buscador de Bodegas: un solo cuadro para todo, en vez
  // de dos cuadros separados (uno para el agente, otro para filtrar)
  // que además se veían mal juntos, uno encima del otro.
  const [respuestaAgente, setRespuestaAgente] = useState(null);
  const [escuchando, setEscuchando] = useState(false);
  const [errorBusca, setErrorBusca] = useState("");
  const rec = useRef(null);
  const idEscucha = useRef(0);

  useEffect(() => {
    pedir("/api/salud", {}, token).then(setSalud).catch(() => setSalud({ api: "caido" }));
    pedir("/api/soporte/administrador", {}, token).then(setAdmin).catch(() => {});
    // Para la firma del correo a el administrador (nombre, rol y correo
    // de quien escribe) - "usuario" (la sesión) solo trae id/nombre/perfil.
    pedir("/api/usuarios/yo", {}, token).then(setMiPerfil).catch(() => {});
    cargarMisMensajes();
  }, [token]);

  function cargarMisMensajes() {
    pedir("/api/soporte/mensajes", {}, token).then(setMisMensajes).catch(() => {});
  }

  async function reportarProblema(detalle) {
    setPedirDetalle(false);
    if (!detalle || !detalle.trim()) return;
    setReportando(true);
    try {
      await pedir("/api/soporte/reportar", {
        method: "POST", body: JSON.stringify({ detalle }),
      }, token);
      setMsg("Reportado a la mesa de ayuda. Quedó en el registro de trazabilidad.");
    } catch (e) { setMsg(e.message); }
    setReportando(false);
  }

  // Reemplaza el enlace mailto: de antes - dependía de que el equipo
  // tuviera un cliente de correo instalado, y sin uno mostraba el cuadro
  // genérico del sistema operativo ("seleccionar una aplicación para
  // abrir este vínculo") en vez de algo propio de CuentaVoz. Este envío
  // queda en el registro de trazabilidad, con el mismo aviso honesto que
  // ya usa "Reportar un problema": no promete un correo real que la app
  // no puede garantizar.
  async function enviarMensajeAdministrador(mensaje) {
    setEscribiendoAdmin(false);
    if (!mensaje || !mensaje.trim()) return;
    setEnviandoAdmin(true);
    try {
      const r = await pedir("/api/soporte/mensaje-administrador", {
        method: "POST", body: JSON.stringify({ mensaje }),
      }, token);
      const nombre = _capitalizar(admin?.nombre) || "el administrador";
      // Misma etiqueta que usa el resto de la app (BarraLateral, MiPerfil,
      // Ingreso) para el rol - así la firma del correo dice lo mismo que
      // ve la persona dentro de CuentaVoz.
      const rol = usuario?.perfil === "auditor" ? "Administrador de bodega" : "Auxiliar de inventarios";
      let listo;
      if (r?.correo_enviado) {
        listo = `Correo enviado a ${nombre}.`;
      } else if (admin?.correo &&
                 await _enviarPorEmailJS(admin.correo, _capitalizar(usuario?.nombre) || "Usuario",
                                          mensaje, rol, miPerfil?.correo)) {
        listo = `Correo enviado a ${nombre}.`;
      } else if (admin?.correo) {
        // Último respaldo si EmailJS tampoco responde: abre el correo ya
        // instalado en el dispositivo con todo listo.
        const asunto = encodeURIComponent("Mensaje desde CuentaVoz");
        const cuerpo = encodeURIComponent(`De: ${usuario?.nombre || "usted"}\n\n${mensaje}`);
        window.location.href = `mailto:${admin.correo}?subject=${asunto}&body=${cuerpo}`;
        listo = `Mensaje registrado. Se abrió su correo para enviarlo a ${nombre}.`;
      } else {
        listo = "Mensaje registrado.";
      }
      setMsg(listo);
      hablar(listo);
      cargarMisMensajes();
    } catch (e) { setMsg(e.message); }
    setEnviandoAdmin(false);
  }

  // El administrador responde un mensaje desde la bandeja de esta
  // pantalla (no desde su correo) - queda guardado en CuentaVoz Y,
  // además, se intenta un correo real de vuelta al remitente por el
  // mismo camino que el mensaje original (EmailJS desde este navegador).
  async function responderMensaje(respuesta) {
    const id = respondiendoId;
    setRespondiendoId(null);
    if (!respuesta || !respuesta.trim() || !id) return;
    setEnviandoRespuesta(true);
    try {
      const r = await pedir(`/api/soporte/mensajes/${id}/responder`, {
        method: "POST", body: JSON.stringify({ respuesta }),
      }, token);
      const rol = usuario?.perfil === "auditor" ? "Administrador de bodega" : "Auxiliar de inventarios";
      if (r?.correo_destinatario) {
        await _enviarPorEmailJS(r.correo_destinatario, _capitalizar(usuario?.nombre) || "Usuario",
                                 respuesta, rol, miPerfil?.correo);
      }
      const listo = `Respuesta enviada a ${_capitalizar(r?.destinatario) || "la persona"}.`;
      setMsg(listo);
      hablar(listo);
      cargarMisMensajes();
    } catch (e) { setMsg(e.message); }
    setEnviandoRespuesta(false);
  }

  // admin.nombre y usuario.nombre llegan en minúscula (el resto de la
  // pantalla los capitaliza con CSS) - aquí van dentro de texto plano de
  // un mensaje, así que hay que capitalizarlos en JS.
  function _capitalizar(nombre) {
    if (!nombre) return "";
    return nombre.split(" ").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
  }

  function _hayCoincidenciaLocal(texto) {
    const t = texto.trim().toLowerCase();
    return FAQ.some(([p, r]) => p.toLowerCase().includes(t) || r.toLowerCase().includes(t))
        || COMANDOS.some(([c, d]) => c.toLowerCase().includes(t) || d.toLowerCase().includes(t));
  }

  function alEscribir(texto) {
    setBusca(texto);
    setRespuestaAgente(null);
  }

  // Los botones de "Soporte en vivo" ("Escribirle al administrador",
  // "Reportar un problema") también son órdenes reconocibles - se
  // revisan antes que cualquier otra cosa, porque el agente general no
  // sabe qué botones hay en esta pantalla en particular (por eso decía
  // "no puedo enviarle mensajes... esa función no está disponible", aun
  // cuando el botón para hacerlo está ahí mismo, a la vista).
  function _accionLocalDeAyuda(texto) {
    const t = quitarTildes(texto.toLowerCase()).replace(/[.,;:!¿?¡]/g, "").trim();
    // "\bescrib" (sin \b de cierre) para que agarre CUALQUIER conjugación
    // - "escribir", "escríbale", y sobre todo "escribirle" (como dice el
    // botón mismo: "Escribirle al administrador") - un \b\escribir\b no
    // hacía match dentro de "escribirle" porque ahí "escribir" no es una
    // palabra completa, es solo el principio de una más larga.
    if (/\badministrador\b/.test(t) && /\b(escrib\w*|contactar|mensaje)\b/.test(t)) return "escribir";
    if (/\bproblema\b|\berror\b/.test(t) && /\breport\w*/.test(t)) return "reportar";
    return null;
  }

  // Al confirmar (Enter, o al terminar de dictar): primero las órdenes
  // sobre los botones de esta pantalla; si no aplica ninguna y lo dicho
  // no encuentra nada en las preguntas frecuentes ni en la guía de
  // comandos, cae al agente general - un solo cuadro para todo.
  async function confirmarBusqueda(texto, miId) {
    if (!texto || !texto.trim()) return;
    if (miId === undefined) miId = ++idEscucha.current;
    setBusca(texto);
    const accion = _accionLocalDeAyuda(texto);
    if (accion === "escribir" && admin) { setEscribiendoAdmin(true); return; }
    if (accion === "reportar") { setPedirDetalle(true); return; }
    if (_hayCoincidenciaLocal(texto)) { setRespuestaAgente(null); return; }
    setErrorBusca("");
    const r = await preguntarAsistente(texto, "ayuda", token);
    if (miId !== idEscucha.current) return;
    setRespuestaAgente(r);
    hablar(r.respuesta_hablada);
    if (r.accion === "navegar" && r.destino && ir) {
      ir(r.destino, { tabInicial: r.pestana || undefined });
    }
  }

  function buscarPorVoz() {
    setErrorBusca("");
    const miId = ++idEscucha.current;
    rec.current = escuchar({
      alTexto: (t) => {
        if (miId !== idEscucha.current) return;
        confirmarBusqueda(t, miId);
      },
      alEstado: (e) => setEscuchando(e === "escuchando"),
      alError: setErrorBusca,
    });
  }

  const q = busca.trim().toLowerCase();
  const faqFiltrado = q ? FAQ.filter(([p, r]) =>
    p.toLowerCase().includes(q) || r.toLowerCase().includes(q)) : FAQ;
  const comandosFiltrados = q ? COMANDOS.filter(([c, d]) =>
    c.toLowerCase().includes(q) || d.toLowerCase().includes(q)) : COMANDOS;

  const servicios = [
    ["API y base de datos", salud?.api === "ok"],
    ["Datos del inventario cargados", (salud?.stock || 0) > 0],
    ["Agente Gemini (AI Studio)", Boolean(salud?.gemini)],
  ];

  return (
    <Marco titulo="Ayuda  ·  cómo usar CuentaVoz" chip={{ texto: "SOPORTE", tipo: "azul" }}>
      <div className="card">
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input value={busca} onChange={(e) => alEscribir(e.target.value)}
                 onKeyDown={(e) => e.key === "Enter" && confirmarBusqueda(busca)}
                 placeholder="pregúntele al agente, o escriba para filtrar las preguntas frecuentes…"
                 style={{ flex: 1, padding: "12px 14px",
                          border: "1px solid var(--borde)", borderRadius: 12 }} />
          <button className={`mic-btn ${escuchando ? "escuchando" : ""}`}
                  style={{ width: 46, height: 46, fontSize: "1.2rem" }}
                  onClick={buscarPorVoz} title="o pregunte por voz">🎤</button>
        </div>
        <p className="pista" style={{ marginTop: 8 }}>o pregunte por voz</p>
        {respuestaAgente && (
          <>
            <p className="rotulo" style={{ marginTop: 10 }}>CuentaVoz responde</p>
            <p className="burbuja">{respuestaAgente.respuesta_hablada}</p>
          </>
        )}
        {errorBusca && <p className="error" style={{ marginTop: 8 }}>{errorBusca}</p>}
      </div>
      <div className="conteo-cols">
        <div className="card">
          <h3>Preguntas frecuentes</h3>
          {faqFiltrado.length === 0 && <p className="vacio">Sin resultados para «{busca}».</p>}
          {faqFiltrado.map(([p, r], i) => (
            <div key={i} style={{ marginBottom: 12, paddingBottom: 12,
                 borderBottom: i < faqFiltrado.length - 1 ? "1px solid var(--borde)" : "none" }}>
              <b style={{ color: "var(--azul)", fontSize: ".92rem" }}>{p}</b>
              <p style={{ fontSize: ".86rem", color: "var(--grafito)", marginTop: 3 }}>{r}</p>
            </div>
          ))}

          <h3 style={{ marginTop: 18 }}>Guía rápida de comandos de voz</h3>
          {comandosFiltrados.length === 0 && <p className="vacio">Sin resultados para «{busca}».</p>}
          {comandosFiltrados.map(([c, d], i) => (
            <div className="registro" key={i}>
              <span style={{ color: "var(--azul)", fontWeight: 700 }}>{c}</span>
              <span className="cant">{d}</span>
            </div>
          ))}
        </div>

        <div>
          <div className="card">
            <h3>Soporte en vivo</h3>
            {admin?.nombre ? (
              <>
                <p style={{ fontSize: ".88rem" }}>
                  Administrador de bodega · <span style={{ textTransform: "capitalize" }}>{admin.nombre}</span>
                  <span style={{ color: "var(--verde)", fontWeight: 700 }}> · disponible</span>
                </p>
                <div className="grilla-botones">
                  <button className="btn" disabled={enviandoAdmin}
                          onClick={() => setEscribiendoAdmin(true)}>
                    {enviandoAdmin ? "Enviando…" : "Escribirle al administrador"}
                  </button>
                </div>
                {misMensajes.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    {misMensajes.map((m) => (
                      <div key={m.id} style={{ padding: "8px 0", borderTop: "1px solid var(--borde)" }}>
                        <p style={{ fontSize: ".82rem", color: "var(--grafito)" }}>{m.mensaje}</p>
                        {m.respuesta ? (
                          <p style={{ fontSize: ".82rem", marginTop: 4 }}>
                            <strong style={{ color: "var(--azul)" }}>
                              Respuesta de {_capitalizar(m.para)}:
                            </strong> {m.respuesta}
                          </p>
                        ) : (
                          <p className="pista" style={{ marginTop: 2 }}>Pendiente de respuesta…</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : admin?.es_usted ? (
              <>
                <p style={{ fontSize: ".88rem" }}>
                  Usted es la administradora de turno: los auxiliares le escriben a
                  usted. Para algo que se salga de su alcance, use la mesa de ayuda
                  de Colsubsidio.
                </p>
                {misMensajes.length === 0 ? (
                  <p className="pista" style={{ marginTop: 8 }}>Sin mensajes por ahora.</p>
                ) : (
                  <div style={{ marginTop: 10 }}>
                    {misMensajes.map((m) => (
                      <div key={m.id} style={{ padding: "10px 0", borderTop: "1px solid var(--borde)" }}>
                        <p style={{ fontSize: ".82rem" }}>
                          <strong style={{ textTransform: "capitalize" }}>{m.de}</strong>: {m.mensaje}
                        </p>
                        {m.respuesta ? (
                          <p style={{ fontSize: ".82rem", color: "var(--verde)", marginTop: 4 }}>
                            Ya respondido: {m.respuesta}
                          </p>
                        ) : (
                          <button className="btn borde" disabled={enviandoRespuesta}
                                  style={{ marginTop: 6, fontSize: ".82rem", padding: "6px 14px" }}
                                  onClick={() => setRespondiendoId(m.id)}>
                            Responder
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p style={{ fontSize: ".88rem" }}>
                No hay otro administrador registrado por ahora. Use la mesa de
                ayuda de Colsubsidio.
              </p>
            )}
            {msg && <p className="msg-ok">{msg}</p>}
            <p className="pista" style={{ margin: "10px 0" }}>
              Mesa de ayuda Colsubsidio · ext. 4040 · 7 por 24
            </p>
            <div className="grilla-botones">
              <button className="btn oro" disabled={reportando} onClick={() => setPedirDetalle(true)}>
                {reportando ? "Enviando…" : "Reportar un problema"}
              </button>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h3>Estado del sistema</h3>
            {servicios.map(([t, ok], i) => (
              <div className="registro" key={i}>
                <span className="ok" style={{ background: ok ? "var(--verde)" : "#B3261E" }}>
                  {ok ? "✓" : "!"}
                </span>
                <span>{t}</span>
                <span className="cant" style={{ color: ok ? "var(--verde)" : "#B3261E",
                      fontWeight: 700 }}>
                  {ok ? "operativo" : "revisar"}
                </span>
              </div>
            ))}
            {!salud?.gemini && (
              <p className="pista" style={{ marginTop: 10 }}>
                Sin la llave de Gemini el agente usa el intérprete local: el flujo
                funciona igual, pero entiende menos variantes de frase. Ponga
                GOOGLE_API_KEY en el archivo .env para activarlo.
              </p>
            )}
          </div>
        </div>
      </div>

      {pedirDetalle && (
        <Dialogo titulo="Reportar un problema"
                 mensaje="Describa el problema que encontró:"
                 conCampo conVoz multilinea placeholder="Se cayó el micrófono al confirmar un conteo…"
                 textoAceptar="Enviar"
                 onAceptar={reportarProblema}
                 onCancelar={() => setPedirDetalle(false)} />
      )}

      {escribiendoAdmin && (
        <Dialogo titulo="Escribirle al administrador"
                 mensaje={`Para: ${_capitalizar(admin?.nombre) || "Administrador"}\nDe: ${_capitalizar(usuario?.nombre) || "Usted"}\nAsunto: Mensaje desde CuentaVoz\n\nEscriba su mensaje:`}
                 conCampo conVoz multilinea placeholder="Necesito que me asigne la bodega de Kiosco Taquilla…"
                 textoAceptar="Enviar"
                 onAceptar={enviarMensajeAdministrador}
                 onCancelar={() => setEscribiendoAdmin(false)} />
      )}

      {respondiendoId && (() => {
        const original = misMensajes.find((m) => m.id === respondiendoId);
        return (
          <Dialogo titulo="Responder mensaje"
                   mensaje={`Para: ${_capitalizar(original?.de) || "la persona"}\nDe: ${_capitalizar(usuario?.nombre) || "Usted"}\n\nMensaje original:\n${original?.mensaje || ""}\n\nEscriba su respuesta:`}
                   conCampo conVoz multilinea placeholder="Ya quedó asignada esa bodega, revise en unos minutos…"
                   textoAceptar="Enviar"
                   onAceptar={responderMensaje}
                   onCancelar={() => setRespondiendoId(null)} />
        );
      })()}
    </Marco>
  );
}
