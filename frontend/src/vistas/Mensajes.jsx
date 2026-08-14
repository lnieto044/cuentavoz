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

  return (
    <Marco titulo="Mensajes  ·  soporte en vivo"
           chip={{ texto: esAdmin ? "BANDEJA DEL ADMINISTRADOR" : "MIS MENSAJES", tipo: "azul" }}>
      <div className="card">
        {msg && <p className="msg-ok" style={{ marginBottom: 10 }}>{msg}</p>}
        {mensajes === null ? (
          <p className="pista">Cargando…</p>
        ) : mensajes.length === 0 ? (
          <p className="vacio">
            {esAdmin ? "Nadie le ha escrito todavía." : "No ha escrito ningún mensaje todavía."}
          </p>
        ) : (
          mensajes.map((m) => (
            <div key={m.id} style={{ padding: "14px 0", borderBottom: "1px solid var(--borde)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <strong style={{ textTransform: "capitalize", color: "var(--azul-prof)" }}>
                  {esAdmin ? m.de : `Para ${m.para}`}
                </strong>
                <span className="pista">{m.creado}</span>
              </div>
              <p style={{ fontSize: ".9rem", marginTop: 4 }}>{m.mensaje}</p>
              {m.respuesta ? (
                <div style={{ marginTop: 8, paddingLeft: 12, borderLeft: "3px solid var(--azul)" }}>
                  <p style={{ fontSize: ".86rem" }}>
                    <strong style={{ color: "var(--azul)" }}>
                      {esAdmin ? "Su respuesta" : `Respuesta de ${capitalizar(m.para)}`}:
                    </strong> {m.respuesta}
                  </p>
                  <span className="pista">{m.respondido}</span>
                </div>
              ) : esAdmin ? (
                <button className="btn borde" disabled={enviandoRespuesta}
                        style={{ marginTop: 8, fontSize: ".85rem", padding: "6px 16px" }}
                        onClick={() => setRespondiendoId(m.id)}>
                  Responder
                </button>
              ) : (
                <p className="pista" style={{ marginTop: 6 }}>Pendiente de respuesta…</p>
              )}
            </div>
          ))
        )}
      </div>

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
