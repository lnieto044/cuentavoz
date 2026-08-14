import { useState } from "react";
import { escuchar, hablar } from "./voz";
import { preguntarAsistente } from "./api";

/** El mismo microfono que ya existe en Bodegas/Conteo/Pedido, pero para
    pantallas sin conversacion (Inicio, Ajustes, Ayuda, Reportes, Panel):
    una pregunta suelta sobre lo que hay en esta pantalla, o una orden de
    ir a otra - sin el estado de "pendiente"/"opciones" que solo tiene
    sentido en un conteo o un pedido en curso. */
export default function AsistenteVoz({ token, vista, ir, placeholder, alActualizar }) {
  const [texto, setTexto] = useState("");
  const [respuesta, setRespuesta] = useState("");
  const [error, setError] = useState("");
  const [escuchando, setEscuchando] = useState(false);
  const [pensando, setPensando] = useState(false);

  async function preguntar(dicho) {
    if (!dicho || !dicho.trim()) return;
    setTexto(dicho);
    setError("");
    setPensando(true);
    try {
      const r = await preguntarAsistente(dicho, vista, token);
      setRespuesta(r.respuesta_hablada || "");
      hablar(r.respuesta_hablada);
      if (r.accion === "navegar" && r.destino && ir) {
        // ir() combina el contexto en vez de reemplazarlo: sin fijar
        // tabInicial explicitamente (aunque sea undefined), una pestaña
        // pedida en una navegacion anterior por otro camino se quedaba
        // pegada y aparecia en un destino que no la tiene. Lo mismo para
        // bodegaSugerida: sin fijarlo a undefined cuando no aplica, un
        // "abra kiosco" pedido antes se quedaba pegado y la próxima vez
        // que se entraba a Conteo por otro camino la abría sola.
        ir(r.destino, { tabInicial: r.pestana || undefined, bodegaSugerida: r.bodega || undefined });
      }
      // "actualizar": el agente cambió algo de verdad (ej. el modo sin
      // conexión en Ajustes) - la pantalla que lo pidió es quien sabe
      // cómo refrescar su propio dato, este componente no.
      if (r.accion === "actualizar" && alActualizar) alActualizar();
    } catch (e) {
      setError(e.message);
    }
    setPensando(false);
  }

  function porVoz() {
    escuchar({
      alTexto: preguntar,
      alEstado: (e) => setEscuchando(e === "escuchando"),
      alError: setError,
    });
  }

  return (
    <div className="card">
      <p className="rotulo">Pregúntele al agente</p>
      <div style={{ display: "flex", gap: 10 }}>
        <input value={texto} onChange={(e) => setTexto(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && preguntar(texto)}
               placeholder={placeholder || "pregunte algo, o pida ir a otra pantalla…"}
               style={{ flex: 1, minWidth: 200, padding: "13px 14px", fontSize: "1rem",
                        border: "1px solid var(--borde)", borderRadius: 12 }} />
        <button className={`mic-btn ${escuchando ? "escuchando" : ""}`}
                style={{ width: 46, height: 46, fontSize: "1.2rem" }}
                onClick={porVoz} title="pregúntele por voz">🎤</button>
      </div>
      <p className="pista" style={{ marginTop: 8 }}>o pregunte por voz</p>
      {pensando && <p className="cargando" style={{ marginTop: 10 }}>Pensando…</p>}
      {respuesta && !pensando && (
        <>
          <p className="rotulo" style={{ marginTop: 10 }}>CuentaVoz responde</p>
          <p className="burbuja">{respuesta}</p>
        </>
      )}
      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
    </div>
  );
}
