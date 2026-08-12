import { useState } from "react";
import { escuchar, hablar } from "./voz";
import { interpretarLocal } from "./interpreteLocal";

const AFIRMA = /^(si|sí|claro|dale|correcto|confirmo|eso es|así es|asi es)\b/;
const NIEGA = /^no\b/;

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
  textoCancelar = "Cancelar", peligro = false, onAceptar, onCancelar,
}) {
  const [valor, setValor] = useState(valorInicial);
  const [escuchando, setEscuchando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [errorVoz, setErrorVoz] = useState("");

  function aceptar(valorAUsar = valor) {
    if (conCampo && !String(valorAUsar).trim()) return;
    onAceptar(valorAUsar);
  }

  function preguntarConfirmacion(valorDictado) {
    setConfirmando(true);
    hablar(`¿Confirma «${valorDictado}»?`);
    escuchar({
      alTexto: (respuesta) => {
        setConfirmando(false);
        const r = respuesta.toLowerCase().trim();
        if (AFIRMA.test(r)) {
          aceptar(valorDictado);
        } else if (NIEGA.test(r)) {
          setValor("");
          setErrorVoz("Cancelado. Dígalo de nuevo cuando quiera, o escríbalo.");
        } else {
          setErrorVoz("No le entendí un «sí» o un «no». Use el botón para confirmar.");
        }
      },
      alEstado: (e) => setEscuchando(e === "escuchando"),
      alError: (e) => { setConfirmando(false); setErrorVoz(e); },
    });
  }

  function alTextoDictado(t) {
    if (!t) return;
    if (tipo === "number") {
      // el reconocimiento a veces ya entrega el número tal cual ("50"),
      // y a veces la palabra ("cincuenta") - se intenta directo primero,
      // y si no es un número se reusa el mismo interprete de cantidades
      // que ya usa el conteo por voz, en vez de dejar el campo vacío.
      const directo = Number(String(t).replace(",", "."));
      if (!Number.isNaN(directo)) {
        setValor(directo);
        preguntarConfirmacion(directo);
        return;
      }
      const r = interpretarLocal(t);
      if (r.cantidad != null) {
        setValor(r.cantidad);
        preguntarConfirmacion(r.cantidad);
        return;
      }
      setErrorVoz(`No reconocí un número en «${t}». Dígalo de nuevo o escríbalo.`);
      return;
    }
    setValor(t);
    preguntarConfirmacion(t);
  }

  function porVoz() {
    setErrorVoz("");
    escuchar({
      alTexto: alTextoDictado,
      alEstado: (e) => setEscuchando(e === "escuchando"),
      alError: setErrorVoz,
    });
  }

  return (
    <div className="overlay" onClick={onCancelar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{titulo}</h2>
        {mensaje && <p style={{ whiteSpace: "pre-line" }}>{mensaje}</p>}
        {conCampo && (
          <div style={{ display: "flex", gap: 10, marginBottom: conVoz ? 6 : 16,
                        alignItems: multilinea ? "flex-start" : "center" }}>
            {multilinea ? (
              <textarea autoFocus value={valor} placeholder={placeholder} rows={3}
                        onChange={(e) => setValor(e.target.value)}
                        style={{ flex: 1, padding: "12px 14px",
                                 border: "1px solid var(--borde)", borderRadius: 12,
                                 fontFamily: "inherit", fontSize: "1rem", resize: "vertical" }} />
            ) : (
              <input type={tipo} autoFocus value={valor} placeholder={placeholder}
                     onChange={(e) => setValor(e.target.value)}
                     onKeyDown={(e) => e.key === "Enter" && aceptar()}
                     style={{ flex: 1, padding: "12px 14px",
                              border: "1px solid var(--borde)", borderRadius: 12,
                              textAlign: "center", fontSize: "1.05rem" }} />
            )}
            {conVoz && (
              <button type="button" className={`mic-btn ${escuchando ? "escuchando" : ""}`}
                      style={{ width: 46, height: 46, fontSize: "1.2rem", flex: "none" }}
                      onClick={porVoz} title="dígalo en voz alta">🎤</button>
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
