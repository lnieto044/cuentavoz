/** El armazón que comparten todas las vistas: barra superior con la
    sección, la faja dorada de marca y el logo de Colsubsidio. */

import React from "react";
export default function Marco({ titulo, chip, children }) {
  return (
    <>
      <div className="barra-sup">
        <h1>{titulo}</h1>
        {chip && <span className={`chip ${chip.tipo || ""}`}>{chip.texto}</span>}
        <img className="cs-logo" src="/colsubsidio-color.png" alt="Colsubsidio" />
      </div>
      <div className="faja" />
      <div className="area">{children}</div>
    </>
  );
}
