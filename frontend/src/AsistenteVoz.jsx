import { useState } from "react";
import { escuchar, hablar } from "./voz";
import { preguntarAsistente } from "./api";
import Icono from "./Iconos";

/** El mismo microfono que ya existe en Bodegas/Conteo/Pedido, pero para
    pantallas sin conversacion (Inicio, Ajustes, Ayuda, Reportes, Panel):
    una pregunta suelta sobre lo que hay en esta pantalla, o una orden de
    ir a otra - sin el estado de "pendiente"/"opciones" que solo tiene
    sentido en un conteo o un pedido en curso. */
export default function AsistenteVoz({ token, vista, ir, placeholder, alActualizar, ejemplos }) {
  const [texto, setTexto] = useState("");
  const [respuesta, setRespuesta] = useState("");
  const [error, setError] = useState("");
  const [escuchando, setEscuchando] = useState(false);
  const [pensando, setPensando] = useState(false);

  async function preguntar(dicho) {
    if (!dicho || !dicho.trim()) return;
    setTexto(dicho);
    setError("");
    // Algunas pantallas (ej. el filtro de Registro de trazabilidad)
    // resuelven ciertas frases del todo en el frontend, sin backend ni
    // Gemini de por medio - si un componente hijo la reconoce, llama
    // preventDefault() y avisa así que ya quedó resuelta, para no
    // preguntarle al agente algo que esta pantalla ya sabe contestar
    // sola. Sin esto, decir aquí arriba exactamente uno de los
    // ejemplos de la lista (que sí describen esas frases) no hacía
    // nada, porque solo el micrófono chiquito junto a los filtros
    // estaba conectado a esa lógica.
    const evento = new CustomEvent("cuentavoz:filtro-local", {
      detail: { texto: dicho }, cancelable: true,
    });
    window.dispatchEvent(evento);
    if (evento.defaultPrevented) {
      // El componente que lo reclamó (ej. TabTraza) es quien sabe el
      // resultado real (cuántas filas encontró) - anuncia ESO por su
      // cuenta de forma asíncrona en vez de un "listo, apliqué el
      // filtro" genérico que no dice nada útil.
      return;
    }
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
        // que se entraba a Conteo por otro camino la abría sola. Lo mismo
        // para bodegaAuditar, su equivalente en Auditoría.
        ir(r.destino, { tabInicial: r.pestana || undefined, bodegaSugerida: r.bodega || undefined,
                        bodegaAuditar: r.bodega_auditar || undefined });
      } else if (r.archivo && r.titulo_archivo && r.pestana && ir) {
        // Cubre dos casos: "previsualizar_reporte" (pedir VER un archivo
        // ya generado) y "actualizar" con archivo (GENERAR uno nuevo por
        // voz - "genera el consolidado", "exporta las diferencias") -
        // ninguno trae "destino" (no cambian de PANTALLA: ya estamos en
        // Reportes), pero sí pueden pedirse desde OTRA pestaña de esta
        // misma pantalla. Sin este ir(), el evento de abajo llegaba a un
        // TabConsolidado que ni siquiera estaba montado - solo se dibuja
        // cuando la pestaña activa YA es "consolidado" - así que la vista
        // previa no aparecía nunca si no se estaba, por casualidad, ya en
        // esa pestaña (ni al pedir verla, ni al generarla). Va por props
        // (como bodegaSugerida) en vez del evento genérico de abajo,
        // precisamente porque necesita sobrevivir a un cambio de pestaña
        // que todavía no ocurrió cuando se dispara el evento.
        // r.titulo_archivo exigido a proposito: "exporta el análisis de
        // consumo" trae archivo+pestana ("analisis") pero SIN
        // titulo_archivo (usa su propio evento "descargar_reporte", ver
        // TabAnalisis) - sin este chequeo, ese caso también disparaba
        // este ir() con titulo undefined, y al volver a la pestaña
        // "Consolidado" a mano, TabConsolidado remontaba y previsualizaba
        // ese archivo viejo con "Vista previa · undefined" de encabezado.
        ir(vista, { tabInicial: r.pestana,
                    archivoPrevisualizar: { archivo: r.archivo, titulo: r.titulo_archivo } });
      }
      // "actualizar": el agente cambió algo de verdad (ej. el modo sin
      // conexión en Ajustes) - la pantalla que lo pidió es quien sabe
      // cómo refrescar su propio dato, este componente no.
      if (r.accion === "actualizar" && alActualizar) alActualizar();
      // Cualquier otra acción (ej. "mostrar_cobertura"/"ocultar_cobertura"
      // para abrir/cerrar un panel especifico de la pantalla) se avisa
      // como evento genérico - así un componente hijo que le interesa
      // puede escucharlo sin que este componente necesite saber qué es
      // cada pantalla ni acumular una prop nueva por cada acción. Ojo:
      // "previsualizar_reporte" queda afuera a propósito (va por props,
      // ver arriba) para no disparar el mismo aviso dos veces.
      if (r.accion && r.accion !== "navegar" && r.accion !== "actualizar"
          && r.accion !== "previsualizar_reporte") {
        // detail: r - para acciones que traen datos propios, no solo la
        // señal de que pasó algo. Las que no lo necesitan lo ignoran.
        window.dispatchEvent(new CustomEvent(`cuentavoz:accion:${r.accion}`, { detail: r }));
      }
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
               aria-label="Pregúntele al agente"
               style={{ flex: 1, minWidth: 200, padding: "13px 14px", fontSize: "1rem",
                        border: "1px solid var(--borde)", borderRadius: 12 }} />
        <button className={`mic-btn ${escuchando ? "escuchando" : ""}`}
                style={{ width: 46, height: 46, fontSize: "1.2rem" }}
                onClick={porVoz} title="pregúntele por voz" aria-label="Pregúntele al agente por voz">
          <Icono nombre="microfono" tam={22} /></button>
      </div>
      <p className="pista" style={{ marginTop: 8 }}>o pregunte por voz</p>
      {ejemplos && ejemplos.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="pista" style={{ cursor: "pointer" }}>
            Ver frases exactas que entiende el agente aquí
          </summary>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {ejemplos.map((ej, i) => (
              <li key={i} className="pista" style={{ marginBottom: 4 }}>«{ej}»</li>
            ))}
          </ul>
        </details>
      )}
      {pensando && <p className="cargando" style={{ marginTop: 10 }}>Pensando…</p>}
      {respuesta && !pensando && (
        <>
          <p className="rotulo" style={{ marginTop: 10 }}>CuentaVoz responde</p>
          <p className="burbuja" aria-live="polite" aria-atomic="true">{respuesta}</p>
        </>
      )}
      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
    </div>
  );
}
