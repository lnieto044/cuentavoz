import { useEffect, useState } from "react";
import { pedir } from "../api";

export default function CerrarSesion({ token, sesionId, onCancelar, onSalir }) {
  const [pend, setPend] = useState(null);
  const [noSePudoVerificar, setNoSePudoVerificar] = useState(false);

  useEffect(() => {
    setNoSePudoVerificar(false);
    pedir(`/api/sesiones/${sesionId}/avance`, {}, token)
      .then((a) => setPend({ bodega: a.bodega, hechas: a.hechas }))
      // si la comprobación falla (sin conexión, sesión vencida...) no hay
      // que asumir que no hay trabajo pendiente: eso es la respuesta más
      // tranquilizadora posible justo cuando menos se sabe. Se avisa que
      // no se pudo comprobar en vez de decir "puede salir sin problema"
      // sin tener manera de saberlo.
      .catch(() => { setNoSePudoVerificar(true); setPend({ bodega: null, hechas: 0 }); });
  }, [sesionId, token]);

  if (!pend) return null;
  const hayTrabajo = Boolean(pend.bodega);

  return (
    <div className="overlay">
      <div className="modal">
        <h2>¿Cerrar la sesión?</h2>
        {noSePudoVerificar ? (
          <p>
            No se pudo comprobar si tiene trabajo sin guardar. Si tiene una bodega abierta,
            lo contado hasta ahora ya quedó guardado y podrá continuar al volver.
          </p>
        ) : hayTrabajo ? (
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
