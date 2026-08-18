import { useEffect, useRef, useState } from "react";
import { pedir } from "../api";

export default function CerrarSesion({ token, sesionId, onCancelar, onSalir }) {
  const [pend, setPend] = useState(null);
  const [noSePudoVerificar, setNoSePudoVerificar] = useState(false);
  const modalRef = useRef(null);

  // Igual que Dialogo.jsx: Escape cierra (aquí, "seguir trabajando" - la
  // opción que no pierde nada), y el modal recibe el foco al aparecer. Sin
  // esto, quien navega con teclado o con un lector de pantalla no tenía
  // forma de descartar este diálogo en particular, aunque todos los demás
  // de la app sí la ofrecen.
  useEffect(() => {
    function alTecla(e) { if (e.key === "Escape") onCancelar(); }
    window.addEventListener("keydown", alTecla);
    return () => window.removeEventListener("keydown", alTecla);
  }, [onCancelar]);

  useEffect(() => {
    // el modal no existe en el DOM hasta que "pend" resuelve (ver el
    // "if (!pend) return null" más abajo) - el foco solo puede entrar una
    // vez que de verdad aparece, no en el montaje del componente.
    if (pend) modalRef.current?.focus();
  }, [pend]);

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
    <div className="overlay" onClick={onCancelar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}
           role="dialog" aria-modal="true" aria-labelledby="cerrar-sesion-titulo"
           ref={modalRef} tabIndex={-1}>
        <h2 id="cerrar-sesion-titulo">¿Cerrar la sesión?</h2>
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
