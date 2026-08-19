import { useEffect, useRef, useState } from "react";

const PASOS = [
  {
    titulo: "Cuente por voz",
    texto: "En Conteo, toque el micrófono y diga el artículo y la cantidad "
      + "(«arroz veinte kilos»). CuentaVoz confirma antes de guardar.",
  },
  {
    titulo: "Revise las alertas del Panel",
    texto: "El Panel muestra las diferencias contra el sistema y las "
      + "alertas por tipo, para saber qué bodega revisar primero.",
  },
  {
    titulo: "Apruebe productos y bodegas nuevas",
    texto: "Cuando un auxiliar cuenta algo que no existía todavía en el "
      + "catálogo, queda pendiente en Auditoría hasta que usted lo apruebe.",
    soloAuditor: true,
  },
];

/** Recorrido guiado la primera vez que alguien entra a CuentaVoz - mismo
    patrón de overlay/modal que Dialogo.jsx (trampa de foco, Escape cierra),
    pero con pasos en vez de un solo mensaje. */
export default function TutorialGuiado({ perfil, onCerrar }) {
  const pasos = PASOS.filter((p) => !p.soloAuditor || perfil === "auditor");
  const [pasoActual, setPasoActual] = useState(0);
  const modalRef = useRef(null);

  useEffect(() => {
    function alTecla(e) { if (e.key === "Escape") onCerrar(); }
    window.addEventListener("keydown", alTecla);
    return () => window.removeEventListener("keydown", alTecla);
  }, [onCerrar]);

  useEffect(() => {
    modalRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const paso = pasos[pasoActual];
  const esUltimo = pasoActual === pasos.length - 1;

  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}
           role="dialog" aria-modal="true" aria-labelledby="tutorial-titulo"
           ref={modalRef} tabIndex={-1}>
        <p className="pista" style={{ marginBottom: 4 }}>
          Paso {pasoActual + 1} de {pasos.length}
        </p>
        <h2 id="tutorial-titulo">{paso.titulo}</h2>
        <p style={{ margin: "10px 0 16px" }}>{paso.texto}</p>
        <div className="botones">
          <button className="btn borde" onClick={onCerrar}>Saltar</button>
          {pasoActual > 0 && (
            <button className="btn borde" onClick={() => setPasoActual((p) => p - 1)}>
              Atrás
            </button>
          )}
          <button className="btn"
                  onClick={() => (esUltimo ? onCerrar() : setPasoActual((p) => p + 1))}>
            {esUltimo ? "Entendido" : "Siguiente"}
          </button>
        </div>
      </div>
    </div>
  );
}
