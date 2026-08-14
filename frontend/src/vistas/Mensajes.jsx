import { useEffect, useState } from "react";
import { pedir } from "../api";
import { hablar } from "../voz";
import { enviarPorEmailJS, capitalizar, rolDe } from "../correoAdmin";
import Marco from "../Marco";
import Dialogo from "../Dialogo";

/** La bandeja completa de "Soporte en vivo": para un auxiliar, lo que ha
    escrito y si ya le respondieron; para el administrador, lo que le
    han escrito y lo que falta por responder. Antes esta lista vivía
    dentro de la tarjeta de Ayuda, pero con varios auxiliares escribiendo
    (Luis, Valentina...) esa tarjeta se llenaba y quedaba desordenada -
    aquí tiene su propio espacio, como Auditoría o Reportes. */
export default function Mensajes({ token, usuario }) {
  const [mensajes, setMensajes] = useState(null);
  const [miPerfil, setMiPerfil] = useState(null);
  const [respondiendoId, setRespondiendoId] = useState(null);
  const [enviandoRespuesta, setEnviandoRespuesta] = useState(false);
  const [msg, setMsg] = useState("");
  const esAdmin = usuario?.perfil === "auditor";

  useEffect(() => {
    cargar();
    pedir("/api/usuarios/yo", {}, token).then(setMiPerfil).catch(() => {});
  }, [token]);

  function cargar() {
    pedir("/api/soporte/mensajes", {}, token).then(setMensajes).catch(() => setMensajes([]));
  }

  async function responderMensaje(respuesta) {
    const id = respondiendoId;
    setRespondiendoId(null);
    if (!respuesta || !respuesta.trim() || !id) return;
    setEnviandoRespuesta(true);
    try {
      const r = await pedir(`/api/soporte/mensajes/${id}/responder`, {
        method: "POST", body: JSON.stringify({ respuesta }),
      }, token);
      if (r?.correo_destinatario) {
        await enviarPorEmailJS(r.correo_destinatario, capitalizar(usuario?.nombre) || "Usuario",
                                respuesta, rolDe(usuario), miPerfil?.correo);
      }
      const listo = `Respuesta enviada a ${capitalizar(r?.destinatario) || "la persona"}.`;
      setMsg(listo);
      hablar(listo);
      cargar();
    } catch (e) { setMsg(e.message); }
    setEnviandoRespuesta(false);
  }

  const original = mensajes?.find((m) => m.id === respondiendoId);
  const pendientes = mensajes?.filter((m) => !m.respuesta).length ?? 0;
  const respondidos = mensajes?.filter((m) => m.respuesta).length ?? 0;

  return (
    <Marco titulo="Mensajes  ·  soporte en vivo"
           chip={{ texto: esAdmin ? "BANDEJA DEL ADMINISTRADOR" : "MIS MENSAJES", tipo: "azul" }}>
      {mensajes !== null && mensajes.length > 0 && (
        <div className="kpis" style={{ marginBottom: 16 }}>
          <div className="kpi">
            <div className="kpi-cabeza">
              <span className="icono-kpi">✉️</span>
              <small>{esAdmin ? "Mensajes recibidos" : "Mensajes enviados"}</small>
            </div>
            <b>{mensajes.length}</b>
            <i>en total</i>
          </div>
          <div className={`kpi ${pendientes ? "oro" : "verde"}`}>
            <div className="kpi-cabeza">
              <span className="icono-kpi">{pendientes ? "⏳" : "✅"}</span>
              <small>Pendientes de respuesta</small>
            </div>
            <b>{pendientes}</b>
            <i>{esAdmin ? "por responder" : "esperando al administrador"}</i>
          </div>
          <div className="kpi verde">
            <div className="kpi-cabeza">
              <span className="icono-kpi">💬</span>
              <small>Respondidos</small>
            </div>
            <b>{respondidos}</b>
            <i>ya resueltos</i>
          </div>
        </div>
      )}

      {msg && <p className="msg-ok" style={{ marginBottom: 10 }}>{msg}</p>}

      {mensajes === null ? (
        <div className="card"><p className="pista">Cargando…</p></div>
      ) : mensajes.length === 0 ? (
        <div className="card">
          <p className="vacio">
            {esAdmin ? "Nadie le ha escrito todavía." : "No ha escrito ningún mensaje todavía."}
          </p>
        </div>
      ) : (
        mensajes.map((m) => (
          <div className="card" key={m.id} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <span className="avatar-chico" style={{ marginTop: 2 }}>
                {(esAdmin ? m.de : m.para)?.[0]?.toUpperCase() || "?"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between",
                              alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <strong style={{ textTransform: "capitalize", color: "var(--azul-prof)" }}>
                    {esAdmin ? capitalizar(m.de) : `Para ${capitalizar(m.para)}`}
                  </strong>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className={`etiqueta-actividad ${m.respuesta ? "verde" : "oro"}`}
                          style={{ marginLeft: 0 }}>
                      {m.respuesta ? "respondido" : "pendiente"}
                    </span>
                    <span className="pista">{m.creado}</span>
                  </span>
                </div>
                <p style={{ fontSize: ".92rem", marginTop: 6, lineHeight: 1.5 }}>{m.mensaje}</p>

                {m.respuesta ? (
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10,
                                marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--borde)" }}>
                    <span className="avatar-chico" style={{ background: "var(--verde-bg)", color: "var(--verde)" }}>
                      {(esAdmin ? usuario?.nombre : m.para)?.[0]?.toUpperCase() || "?"}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <strong style={{ color: "var(--verde)", fontSize: ".85rem" }}>
                          {esAdmin ? "Su respuesta" : `Respuesta de ${capitalizar(m.para)}`}
                        </strong>
                        <span className="pista">{m.respondido}</span>
                      </div>
                      <p style={{ fontSize: ".9rem", marginTop: 3, lineHeight: 1.5 }}>{m.respuesta}</p>
                    </div>
                  </div>
                ) : esAdmin ? (
                  <button className="btn borde" disabled={enviandoRespuesta}
                          style={{ marginTop: 12, fontSize: ".85rem", padding: "6px 16px" }}
                          onClick={() => setRespondiendoId(m.id)}>
                    Responder
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ))
      )}

      {respondiendoId && (
        <Dialogo titulo="Responder mensaje"
                 mensaje={`Para: ${capitalizar(original?.de) || "la persona"}\nDe: ${capitalizar(usuario?.nombre) || "Usted"}\n\nMensaje original:\n${original?.mensaje || ""}\n\nEscriba su respuesta:`}
                 conCampo conVoz multilinea placeholder="Ya quedó asignada esa bodega, revise en unos minutos…"
                 textoAceptar="Enviar"
                 onAceptar={responderMensaje}
                 onCancelar={() => setRespondiendoId(null)} />
      )}
    </Marco>
  );
}
