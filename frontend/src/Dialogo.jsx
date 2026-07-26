import { useState } from "react";

/** Reemplaza a window.prompt()/window.confirm(): un modal con el estilo
    propio de la app, en vez del cuadro genérico y feo del navegador.
    Uso: <Dialogo titulo="..." mensaje="..." conCampo onAceptar={...} onCancelar={...} /> */
export default function Dialogo({
  titulo, mensaje, conCampo = false, multilinea = false, tipo = "text",
  valorInicial = "", placeholder = "", textoAceptar = "Aceptar",
  textoCancelar = "Cancelar", peligro = false, onAceptar, onCancelar,
}) {
  const [valor, setValor] = useState(valorInicial);

  function aceptar() {
    if (conCampo && !String(valor).trim()) return;
    onAceptar(valor);
  }

  return (
    <div className="overlay" onClick={onCancelar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{titulo}</h2>
        {mensaje && <p style={{ whiteSpace: "pre-line" }}>{mensaje}</p>}
        {conCampo && (
          multilinea ? (
            <textarea autoFocus value={valor} placeholder={placeholder} rows={3}
                      onChange={(e) => setValor(e.target.value)}
                      style={{ width: "100%", padding: "12px 14px", marginBottom: 16,
                               border: "1px solid var(--borde)", borderRadius: 12,
                               fontFamily: "inherit", fontSize: "1rem", resize: "vertical" }} />
          ) : (
            <input type={tipo} autoFocus value={valor} placeholder={placeholder}
                   onChange={(e) => setValor(e.target.value)}
                   onKeyDown={(e) => e.key === "Enter" && aceptar()}
                   style={{ width: "100%", padding: "12px 14px", marginBottom: 16,
                            border: "1px solid var(--borde)", borderRadius: 12,
                            textAlign: "center", fontSize: "1.05rem" }} />
          )
        )}
        <div className="botones">
          <button className="btn borde" onClick={onCancelar}>{textoCancelar}</button>
          <button className={`btn ${peligro ? "oro" : ""}`} onClick={aceptar}>
            {textoAceptar}
          </button>
        </div>
      </div>
    </div>
  );
}
