import { useEffect, useRef, useState } from "react";
import { debeAbrirTutorial, deshabilitarTutorial, habilitarTutorial } from "./tutorial";

/* El video se sirve desde /public, no desde un servicio externo: la app se
   usa en bodegas con señal irregular y un video en YouTube que no carga es
   peor que no ofrecerlo. Al venir del mismo origen, el navegador lo trae
   con el resto de la aplicación. Están fuera del precacheo del service
   worker (ver vite.config.js) para no obligar a bajar varios megas la
   primera vez que alguien abre el login. */
/* El ?v= no lo lee el servidor: es solo para el cache del navegador. Los
   mp4 viven en una ruta fija (no llevan hash como los bundles de Vite), asi
   que sin esto quien ya vio el recorrido una vez se queda con la copia
   vieja aunque publiquemos una corregida. Al volver a grabar un recorrido
   hay que subirle la fecha a su version. */
const VIDEOS = {
  auxiliar: {
    src: "/recorrido-auxiliar.mp4",
    version: "2026-08-24f",
    titulo: "Recorrido para auxiliares de inventarios",
  },
  auditor: {
    src: "/recorrido-administrador.mp4",
    version: "2026-08-24f",
    titulo: "Recorrido para administradores de bodega",
  },
};

export default function VideoRecorrido({ perfil, usuarioId, onCerrar }) {
  const video = VIDEOS[perfil === "auditor" ? "auditor" : "auxiliar"];
  const fuente = `${video.src}?v=${video.version}`;
  const modalRef = useRef(null);
  const videoRef = useRef(null);
  // Refleja lo que ya hay guardado para este usuario, no un estado nuevo
  // en false: si ya lo habia desactivado antes y por lo que sea el video
  // se abrio igual (p. ej. "Ver el recorrido en video" desde Ayuda), el
  // interruptor no debe mostrarse como si estuviera activado.
  const [desactivado, setDesactivado] = useState(
    () => usuarioId != null && !debeAbrirTutorial(usuarioId)
  );

  useEffect(() => {
    function alTecla(e) { if (e.key === "Escape") onCerrar(); }
    window.addEventListener("keydown", alTecla);
    return () => window.removeEventListener("keydown", alTecla);
  }, [onCerrar]);

  useEffect(() => {
    modalRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Se intenta reproducir solo, sin que la persona tenga que darle play:
  // el video se abre COMO CONSECUENCIA de un clic (entrar, o "Ver el
  // recorrido en video" en Ayuda), y ese gesto reciente es justo lo que
  // los navegadores piden para permitir sonido automático. Si de todas
  // formas lo bloquean (típico cuando la sesión se retomó sola, sin clic
  // reciente), se queda pausado con los controles listos - nunca se
  // fuerza a silenciarlo, porque un video narrado mudo no sirve de nada.
  useEffect(() => {
    videoRef.current?.play().catch(() => {});
  }, []);

  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}
           role="dialog" aria-modal="true" aria-labelledby="video-titulo"
           ref={modalRef} tabIndex={-1}
           style={{ maxWidth: 780, width: "92vw" }}>
        <h2 id="video-titulo" style={{ marginBottom: 4 }}>{video.titulo}</h2>
        <p className="pista" style={{ marginBottom: 12 }}>
          Narrado, con un ejemplo de cada pantalla. Puede pausarlo o cerrarlo
          y seguir después.
        </p>

        <video ref={videoRef} src={fuente} controls preload="auto" playsInline
               style={{ width: "100%", display: "block", borderRadius: 10,
                        background: "#000", border: "1px solid var(--borde)" }}>
          Su navegador no puede reproducir este video.{" "}
          <a href={fuente} download>Descárguelo aquí.</a>
        </video>

        {usuarioId != null && (
          <label style={{ display: "flex", alignItems: "center", gap: 8,
                          marginTop: 14, fontSize: ".9rem", color: "var(--grafito)" }}>
            <input type="checkbox" checked={desactivado}
                   onChange={(e) => {
                     const marcado = e.target.checked;
                     setDesactivado(marcado);
                     if (marcado) deshabilitarTutorial(usuarioId);
                     else habilitarTutorial(usuarioId);
                   }} />
            No mostrar este video automáticamente la próxima vez que ingrese
          </label>
        )}

        <div className="botones" style={{ marginTop: 16 }}>
          <button className="btn" onClick={onCerrar}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
