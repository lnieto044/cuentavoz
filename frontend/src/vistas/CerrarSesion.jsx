import { useEffect, useState } from "react";
import { pedir } from "../api";

export default function CerrarSesion({ token, sesionId, onCancelar, onSalir }) {
  const [pend, setPend] = useState(null);

  useEffect(() => {
    pedir(`/api/sesiones/${sesionId}/avance`, {}, token)
      .then((a) => setPend({ bodega: a.bodega, hechas: a.hechas }))
      .catch(() => setPend({ bodega: null, hechas: 0 }));
  }, [sesionId, token]);

  if (!pend) return null;
  const hayTrabajo = Boolean(pend.bodega);

  return (
    <div className="overlay">
      <div className="modal">
        <h2>¿Cerrar la sesión?</h2>
        {hayTrabajo ? (
          <>
            <p>
              Tiene <b>{pend.bodega}</b> abierta con {pend.hechas} referencias contadas.
            </p>
            <div className="aviso">
              Lo registrado queda guardado y podrá continuar al volver.
            </div>
          </>
        ) : (
          <p>No tiene trabajo pendiente: puede salir sin problema.</p>
        )}
        <div className="botones">
          <button className="btn borde" onClick={onCancelar}>Seguir trabajando</button>
          <button className="btn" onClick={onSalir}>Cerrar sesión</button>
        </div>
      </div>
    </div>
  );
}
