import { useEffect, useRef } from "react";

/* El video se sirve desde /public, no desde un servicio externo: la app se
   usa en bodegas con señal irregular y un video en YouTube que no carga es
   peor que no ofrecerlo. Al venir del mismo origen, el navegador lo trae
   con el resto de la aplicación. Están fuera del precacheo del service
   worker (ver vite.config.js) para no obligar a bajar varios megas la
   primera vez que alguien abre el login. */
const VIDEOS = {
  auxiliar: {
    src: "/recorrido-auxiliar.mp4",
    titulo: "Recorrido para auxiliares de inventarios",
  },
  auditor: {
    src: "/recorrido-administrador.mp4",
    titulo: "Recorrido para administradores de bodega",
  },
};

export default function VideoRecorrido({ perfil, onCerrar }) {
  const video = VIDEOS[perfil === "auditor" ? "auditor" : "auxiliar"];
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

        {/* controls y sin autoplay a proposito: que suene un video solo, a
            volumen alto, en una bodega o en una reunion, es peor que un
            clic mas. preload="metadata" para no bajar los megas completos
            hasta que la persona le de reproducir. */}
        <video src={video.src} controls preload="metadata" playsInline
               style={{ width: "100%", display: "block", borderRadius: 10,
                        background: "#000", border: "1px solid var(--borde)" }}>
          Su navegador no puede reproducir este video.{" "}
          <a href={video.src} download>Descárguelo aquí.</a>
        </video>

        <div className="botones" style={{ marginTop: 16 }}>
          <button className="btn" onClick={onCerrar}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
