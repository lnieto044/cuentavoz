import { useState, useRef, useEffect } from "react";
import { useDevolverFoco } from "./foco";
import { escuchar, hablar, esAfirmacion, esNegacion } from "./voz";
import { interpretarLocal } from "./interpreteLocal";
import Icono from "./Iconos";

/** Reemplaza a window.prompt()/window.confirm(): un modal con el estilo
    propio de la app, en vez del cuadro genérico y feo del navegador.
    Uso: <Dialogo titulo="..." mensaje="..." conCampo onAceptar={...} onCancelar={...} />

    conVoz agrega el mismo micrófono que ya existe en el resto de la app,
    con el mismo patrón de confirmación hablada que usa el agente al abrir
    una bodega: lo dicho llena el campo (visible, editable) Y el agente
    pregunta en voz alta "¿confirma X?" - un "sí" acepta directo, un "no"
    descarta y deja intentar de nuevo. El botón de Aceptar sigue ahí como
    respaldo (para quien prefiera escribir, o si la voz no entendió el
    sí/no). No se usa en los diálogos "Escribir en vez de hablar": esos ya
    son el respaldo a prueba de fallos cuando la voz no funciona. */
export default function Dialogo({
  titulo, mensaje, conCampo = false, conVoz = false, multilinea = false, tipo = "text",
  valorInicial = "", placeholder = "", textoAceptar = "Aceptar",
  textoCancelar = "Cancelar", peligro = false, confirmarAlAbrir = false, onAceptar, onCancelar,
  // Nombre accesible del campo para un lector de pantalla - por defecto se
  // usa "mensaje" (funciona bien cuando es una pregunta corta, como "¿Cuántas
  // porciones son en realidad?"), pero en varios diálogos "mensaje" es un
  // párrafo explicativo largo o hasta el contenido de un mensaje ajeno
  // (ver Mensajes.jsx "Responder mensaje": ahí incluye el mensaje ORIGINAL
  // completo) - leerlo entero cada vez que el campo recibe foco es
  // ruidoso e inútil como etiqueta. Estos casos pasan su propio
  // etiquetaCampo, corto y específico.
  etiquetaCampo,
}) {
  const [valor, setValor] = useState(valorInicial);
  const [escuchando, setEscuchando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [errorVoz, setErrorVoz] = useState("");
  // Igual que en el selector de bodega de Conteo: cada escucha lleva su
  // propio número, y si el micrófono anterior entrega su resultado tarde
  // (por ejemplo, mientras todavía se está diciendo "¿confirma X?") se
  // descarta en vez de procesarse como si fuera un nuevo valor dictado.
  const idEscucha = useRef(0);
  const modalRef = useRef(null);

  // Accesibilidad: quien navega con teclado o con un lector de pantalla
  // necesita que Escape cierre el modal (como cualquier diálogo nativo),
  // y que el foco entre al modal apenas aparece - sin esto, un lector de
  // pantalla seguía anunciando el contenido de atrás como si el modal ni
  // existiera. Si hay un campo, ese ya se autoenfoca solo (ver más abajo);
  // si no lo hay, el modal mismo recibe el foco.
  useEffect(() => {
    function alTecla(e) { if (e.key === "Escape") onCancelar(); }
    window.addEventListener("keydown", alTecla);
    return () => window.removeEventListener("keydown", alTecla);
  }, [onCancelar]);

  useDevolverFoco();

  useEffect(() => {
    if (!conCampo) modalRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function aceptar(valorAUsar = valor) {
    if (conCampo && !String(valorAUsar).trim()) return;
    onAceptar(valorAUsar);
  }

  async function preguntarConfirmacion(valorDictado, miId) {
    setConfirmando(true);
    // Con un campo de varias líneas (un mensaje libre, no un dato corto)
    // no se repite todo lo dictado - sería una lectura larga, y encima
    // alarga la ventana en la que la persona ya contestó "sí"/"envíalo"
    // pero el micrófono todavía no se reabrió (seguía sonando la
    // pregunta). Una confirmación corta reduce esa ventana.
    const pregunta = multilinea ? "¿Confirma el mensaje?" : `¿Confirma «${valorDictado}»?`;
    // hay que esperar a que termine de decir la pregunta antes de abrir
    // el micrófono - si arranca apenas empieza a sonar, se pierde el
    // principio de la respuesta.
    await hablar(pregunta);
    if (miId !== idEscucha.current) return;
    let obtuvoResultado = false;
    let yaReintento = false;
    escuchar({
      alTexto: (respuesta) => {
        if (miId !== idEscucha.current) return;
        obtuvoResultado = true;
        setConfirmando(false);
        // El botón de este diálogo en particular puede decir "Enviar",
        // "Solicitar", "Crear"... no solo "Aceptar" - decir esa misma
        // palabra (en cualquier conjugación) también debe confirmar,
        // igual que tocar el botón.
        if (esAfirmacion(respuesta, [textoAceptar])) {
          aceptar(valorDictado);
        } else if (esNegacion(respuesta)) {
          setValor("");
          setErrorVoz("Cancelado. Dígalo de nuevo cuando quiera, o escríbalo.");
        } else {
          setErrorVoz("No le entendí un «sí» o un «no». Use el botón para confirmar.");
        }
      },
      alEstado: (e) => {
        setEscuchando(e === "escuchando");
        // El reconocedor del navegador se cierra solo tras unos segundos
        // de silencio, sin avisar con un error (voz.js lo ignora a
        // propósito) - sin esto, la pregunta se quedaba "colgada" en
        // pantalla diciendo que estaba esperando un sí/no, cuando en
        // realidad el micrófono ya se había apagado solo. Se vuelve a
        // preguntar y a escuchar sola, en vez de obligar a tocar el
        // micrófono de nuevo (lo que arrancaba una dictada nueva y
        // borraba el mensaje ya armado).
        if (e === "listo" && !obtuvoResultado && !yaReintento && miId === idEscucha.current) {
          yaReintento = true;
          preguntarConfirmacion(valorDictado, miId);
        }
      },
      alError: (e) => { setConfirmando(false); setErrorVoz(e); },
    });
  }

  function alTextoDictado(t, miId) {
    if (!t) return;
    if (tipo === "number") {
      // el reconocimiento a veces ya entrega el número tal cual ("50"),
      // y a veces la palabra ("cincuenta") - se intenta directo primero,
      // y si no es un número se reusa el mismo interprete de cantidades
      // que ya usa el conteo por voz, en vez de dejar el campo vacío.
      const directo = Number(String(t).replace(",", "."));
      if (!Number.isNaN(directo)) {
        setValor(directo);
        preguntarConfirmacion(directo, miId);
        return;
      }
      const r = interpretarLocal(t);
      if (r.cantidad != null) {
        setValor(r.cantidad);
        preguntarConfirmacion(r.cantidad, miId);
        return;
      }
      setErrorVoz(`No reconocí un número en «${t}». Dígalo de nuevo o escríbalo.`);
      return;
    }
    setValor(t);
    preguntarConfirmacion(t, miId);
  }

  function porVoz() {
    setErrorVoz("");
    const miId = ++idEscucha.current;
    escuchar({
      alTexto: (t) => {
        if (miId !== idEscucha.current) return;
        alTextoDictado(t, miId);
      },
      alEstado: (e) => setEscuchando(e === "escuchando"),
      alError: setErrorVoz,
    });
  }

  // Cuando el valor ya llega armado por voz desde afuera (por ejemplo,
  // "respóndele a Stephanie que ya quedó asignada la bodega" en la
  // bandeja de Mensajes), tocar el micrófono de este diálogo para decir
  // "envíalo" NO debe funcionar como una dictada nueva - eso pisaba el
  // texto ya armado con la palabra "envíalo" misma. En vez de obligar a
  // usar el botón, se pregunta la confirmación de una vez al abrir, así
  // "envíalo"/"sí" ya confirma lo que se armó, sin tocar nada.
  useEffect(() => {
    if (confirmarAlAbrir && String(valorInicial || "").trim()) {
      preguntarConfirmacion(valorInicial, ++idEscucha.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="overlay" onClick={onCancelar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}
           role="dialog" aria-modal="true" aria-labelledby="dialogo-titulo"
           ref={modalRef} tabIndex={-1}>
        <h2 id="dialogo-titulo">{titulo}</h2>
        {mensaje && <p style={{ whiteSpace: "pre-line" }}>{mensaje}</p>}
        {conCampo && (
          <div style={{ display: "flex", gap: 10, marginBottom: conVoz ? 6 : 16,
                        alignItems: multilinea ? "flex-start" : "center" }}>
            {multilinea ? (
              <textarea autoFocus value={valor} placeholder={placeholder} rows={3}
                        onChange={(e) => setValor(e.target.value)}
                        aria-label={etiquetaCampo || mensaje || titulo}
                        style={{ flex: 1, padding: "12px 14px",
                                 border: "1px solid var(--borde)", borderRadius: 12,
                                 fontFamily: "inherit", fontSize: "1rem", resize: "vertical" }} />
            ) : (
              <input type={tipo} autoFocus value={valor} placeholder={placeholder}
                     onChange={(e) => setValor(e.target.value)}
                     onKeyDown={(e) => e.key === "Enter" && aceptar()}
                     aria-label={etiquetaCampo || mensaje || titulo}
                     style={{ flex: 1, padding: "12px 14px",
                              border: "1px solid var(--borde)", borderRadius: 12,
                              textAlign: "center", fontSize: "1.05rem" }} />
            )}
            {conVoz && (
              <button type="button" className={`mic-btn ${escuchando ? "escuchando" : ""}`}
                      style={{ width: 46, height: 46, fontSize: "1.2rem", flex: "none" }}
                      onClick={porVoz} title="dígalo en voz alta"
                      aria-label="Dígalo en voz alta"><Icono nombre="microfono" tam={22} /></button>
            )}
          </div>
        )}
        {conVoz && (
          <p className="pista" style={{ marginTop: -2, marginBottom: 14 }}>
            {confirmando ? "Diga «sí» para confirmar, o «no» para intentar de nuevo…"
              : escuchando ? "Escuchando…"
              : "Dígalo y confírmelo de viva voz, o escríbalo y use el botón."}
          </p>
        )}
        {errorVoz && <p className="error" style={{ marginBottom: 10 }}>{errorVoz}</p>}
        <div className="botones">
          <button className="btn borde" onClick={onCancelar}>{textoCancelar}</button>
          <button className={`btn ${peligro ? "oro" : ""}`} onClick={() => aceptar()}>
            {textoAceptar}
          </button>
        </div>
      </div>
    </div>
  );
}
