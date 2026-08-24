import { useEffect, useState, useRef } from "react";
import { pedir, preguntarAsistente } from "../api";
import { EVENTO_ABRIR_TUTORIAL, EVENTO_ABRIR_VIDEO } from "../tutorial";
import { escuchar, hablar, quitarTildes } from "../voz";
import { enviarPorEmailJS, capitalizar, rolDe } from "../correoAdmin";
import Marco from "../Marco";
import Dialogo from "../Dialogo";
import Icono from "../Iconos";

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
  }, [token]);

  async function reportarProblema(detalle) {
    setPedirDetalle(false);
    if (!detalle || !detalle.trim()) return;
    setReportando(true);
    try {
      await pedir("/api/soporte/reportar", {
        method: "POST", body: JSON.stringify({ detalle }),
      }, token);
      const listo = "Reportado a la mesa de ayuda. Quedó en el registro de trazabilidad.";
      setMsg(listo);
      hablar(listo);
    } catch (e) { setMsg(e.message); hablar(e.message); }
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
      const nombre = capitalizar(admin?.nombre) || "el administrador";
      const rol = rolDe(usuario);
      let listo;
      if (r?.correo_enviado) {
        listo = `Correo enviado a ${nombre}.`;
      } else if (admin?.correo &&
                 await enviarPorEmailJS(admin.correo, capitalizar(usuario?.nombre) || "Usuario",
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
    } catch (e) { setMsg(e.message); hablar(e.message); }
    setEnviandoAdmin(false);
  }

  // Devuelve lo que hay que DECIR cuando lo preguntado ya está resuelto
  // localmente (sin pasar por el agente general), o null si no coincide
  // con nada. Antes solo se sabía SI coincidía (booleano) y la pantalla
  // se limitaba a filtrar la lista visualmente, sin decir nada - quien
  // pregunta por voz sin mirar la pantalla se quedaba sin ninguna
  // respuesta hablada, justo lo contrario de lo que promete "pregúntele
  // al agente" en esta misma pantalla.
  function _respuestaLocal(texto) {
    const t = texto.trim().toLowerCase();
    const faq = FAQ.find(([p, r]) => p.toLowerCase().includes(t) || r.toLowerCase().includes(t));
    if (faq) return faq[1];
    const comando = COMANDOS.find(([c, d]) => c.toLowerCase().includes(t) || d.toLowerCase().includes(t));
    if (comando) return `${comando[0]} sirve para ${comando[1]}.`;
    return null;
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
    const respuestaLocal = _respuestaLocal(texto);
    if (respuestaLocal) {
      setRespuestaAgente(null);
      hablar(respuestaLocal);
      return;
    }
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
        <div className="grilla-botones" style={{ justifyContent: "flex-end", marginBottom: 10 }}>
          <button className="btn borde"
                  onClick={() => window.dispatchEvent(new Event(EVENTO_ABRIR_TUTORIAL))}>
            Ver el recorrido guiado
          </button>
          <button className="btn borde"
                  onClick={() => window.dispatchEvent(new Event(EVENTO_ABRIR_VIDEO))}>
            Ver el recorrido en video
          </button>
        </div>
        <p className="rotulo">Pregúntele al agente</p>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input value={busca} onChange={(e) => alEscribir(e.target.value)}
                 onKeyDown={(e) => e.key === "Enter" && confirmarBusqueda(busca)}
                 placeholder="pregúntele al agente, o escriba para filtrar las preguntas frecuentes…"
                 aria-label="Pregúntele al agente, o escriba para filtrar las preguntas frecuentes"
                 style={{ flex: 1, padding: "12px 14px",
                          border: "1px solid var(--borde)", borderRadius: 12 }} />
          <button className={`mic-btn ${escuchando ? "escuchando" : ""}`}
                  style={{ width: 46, height: 46, fontSize: "1.2rem" }}
                  onClick={buscarPorVoz} title="o pregunte por voz"
                  aria-label="Pregúntele al agente por voz"><Icono nombre="microfono" tam={22} /></button>
        </div>
        <p className="pista" style={{ marginTop: 8 }}>o pregunte por voz</p>
        {respuestaAgente && (
          <>
            <p className="rotulo" style={{ marginTop: 10 }}>CuentaVoz responde</p>
            <p className="burbuja" aria-live="polite" aria-atomic="true">{respuestaAgente.respuesta_hablada}</p>
          </>
        )}
        {errorBusca && <p className="error" style={{ marginTop: 8 }}>{errorBusca}</p>}
      </div>
      <div className="conteo-cols">
        <div className="card">
          <h3><span className="icono-kpi" style={{ marginRight: 8 }}>❓</span>Preguntas frecuentes</h3>
          {faqFiltrado.length === 0 && <p className="vacio">Sin resultados para «{busca}».</p>}
          {faqFiltrado.map(([p, r], i) => (
            <div key={i} style={{ marginBottom: 12, paddingBottom: 12,
                 borderBottom: i < faqFiltrado.length - 1 ? "1px solid var(--borde)" : "none" }}>
              <b style={{ color: "var(--azul)", fontSize: ".92rem" }}>{p}</b>
              <p style={{ fontSize: ".86rem", color: "var(--grafito)", marginTop: 3 }}>{r}</p>
            </div>
          ))}

          <h3 style={{ marginTop: 18 }}>
            <span className="icono-kpi" style={{ marginRight: 8 }}>🎙️</span>
            Guía rápida de comandos de voz
          </h3>
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
            <h3><span className="icono-kpi" style={{ marginRight: 8 }}>🤝</span>Soporte en vivo</h3>
            {admin?.nombre ? (
              <>
                <p style={{ fontSize: ".88rem" }}>
                  Administrador de bodega · <span style={{ textTransform: "capitalize" }}>{admin.nombre}</span>
                  <span style={{ color: "var(--verde)", fontWeight: 700 }}> · disponible</span>
                </p>
                <div className="grilla-botones">
                  <button className="btn" disabled={enviandoAdmin}
                          onClick={() => setEscribiendoAdmin(true)}
                          style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <Icono nombre="mensajes" tam={18} />
                    {enviandoAdmin ? "Enviando…" : "Escribirle al administrador"}
                  </button>
                </div>
              </>
            ) : admin?.es_usted ? (
              <p style={{ fontSize: ".88rem" }}>
                Usted es la administradora de turno: los auxiliares le escriben a
                usted. Para algo que se salga de su alcance, use la mesa de ayuda
                de Colsubsidio.
              </p>
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
              {(admin?.nombre || admin?.es_usted) && (
                <button className="btn borde" onClick={() => ir("mensajes")}
                        style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Icono nombre="mensajes" tam={18} />
                  Ver mensajes
                </button>
              )}
              <button className="btn oro" disabled={reportando} onClick={() => setPedirDetalle(true)}
                      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Icono nombre="advertencia" tam={18} />
                {reportando ? "Enviando…" : "Reportar un problema"}
              </button>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h3><span className="icono-kpi" style={{ marginRight: 8 }}>🩺</span>Estado del sistema</h3>
            <div className="kpis" style={{ gridTemplateColumns: "1fr" }}>
              {servicios.map(([t, ok], i) => (
                <div className={ok ? "kpi verde" : "kpi"} key={i}
                     style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                              padding: "10px 16px" }}>
                  <div className="kpi-cabeza" style={{ marginBottom: 0 }}>
                    <span className="icono-kpi" style={{
                      background: ok ? "var(--verde-bg)" : "#FBE8E6",
                      color: ok ? "var(--verde)" : "#B3261E" }}>
                      {ok ? "✓" : "!"}
                    </span>
                    <small>{t}</small>
                  </div>
                  <b style={{ fontSize: ".92rem", color: ok ? "var(--verde)" : "#B3261E" }}>
                    {ok ? "operativo" : "revisar"}
                  </b>
                </div>
              ))}
            </div>
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
                 mensaje={`Para: ${capitalizar(admin?.nombre) || "Administrador"}\nDe: ${capitalizar(usuario?.nombre) || "Usted"}\nAsunto: Mensaje desde CuentaVoz\n\nEscriba su mensaje:`}
                 conCampo conVoz multilinea placeholder="Necesito que me asigne la bodega de Kiosco Taquilla…"
                 etiquetaCampo={`Su mensaje para ${capitalizar(admin?.nombre) || "el administrador"}`}
                 textoAceptar="Enviar"
                 onAceptar={enviarMensajeAdministrador}
                 onCancelar={() => setEscribiendoAdmin(false)} />
      )}
    </Marco>
  );
}
