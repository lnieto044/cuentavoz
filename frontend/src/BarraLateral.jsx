import { useEffect, useState } from "react";
import { MENU } from "./App";
import Icono from "./Iconos";
import { BASE, leerToken } from "./api";
import { leerCola, EVENTO_COLA } from "./colaOffline";

export default function BarraLateral({ activo, usuario, token, sesionId, onNavegar }) {
  const esAuditor = usuario?.perfil === "auditor";
  const items = MENU.filter((m) => !m.soloAuditor || esAuditor);
  const [fotoUrl, setFotoUrl] = useState(null);
  const [colaLen, setColaLen] = useState(0);

  // La cola de conteos guardados sin conexión (ver Conteo.jsx/colaOffline.js)
  // antes solo se veía dentro de la pantalla de Conteo - si alguien
  // cambiaba de pantalla con ítems todavía pendientes, no había ningún
  // rastro de eso en el resto de la app. El evento propio cubre cambios en
  // esta misma pestaña; "storage" cubre otra pestaña sincronizando la cola.
  useEffect(() => {
    function actualizar() { setColaLen(leerCola(sesionId).length); }
    actualizar();
    window.addEventListener(EVENTO_COLA, actualizar);
    window.addEventListener("storage", actualizar);
    return () => {
      window.removeEventListener(EVENTO_COLA, actualizar);
      window.removeEventListener("storage", actualizar);
    };
  }, [sesionId]);

  // Igual que en Mi perfil: <img src> no puede mandar el header
  // Authorization que /foto exige, asi que se trae como blob autenticado.
  // Se vuelve a pedir cuando Mi perfil avisa que hubo una foto nueva.
  useEffect(() => {
    function cargar() {
      fetch(`${BASE}/api/usuarios/yo/foto`, {
        headers: { Authorization: `Bearer ${token || leerToken()}` },
      }).then((r) => (r.ok ? r.blob() : null))
        .then((b) => setFotoUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return b ? URL.createObjectURL(b) : null;
        }))
        // mismo camino que el then() de arriba (revoca la URL anterior
        // antes de reemplazarla) - un fallo de red aqui no debe quedarse
        // con el blob viejo vivo para siempre solo porque este intento
        // en particular no llego a nada.
        .catch(() => setFotoUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; }));
    }
    cargar();
    window.addEventListener("cuentavoz:foto-actualizada", cargar);
    return () => window.removeEventListener("cuentavoz:foto-actualizada", cargar);
  }, [token]);

  return (
    <nav className="sidebar">
      <div className="marca">
        <img src="/logo.png" alt="CuentaVoz" />
        <span>
          <b>CuentaVoz</b>
          <i>Tu voz cuenta</i>
        </span>
      </div>
      <hr />

      <ul>
        {items.map((m) => (
          <li
            key={m.id}
            className={m.id === activo ? "sel" : ""}
            onClick={() => onNavegar(m.id)}
            role="button"
            tabIndex={0}
            aria-current={m.id === activo ? "page" : undefined}
            // El menú principal solo tenía onClick - inalcanzable con
            // teclado (Tab no lo enfocaba, nada respondía a Enter/Espacio).
            // Para quien navega sin mouse (movilidad reducida, o un lector
            // de pantalla), esto es el único menú de toda la app: sin
            // esto, no había forma de cambiar de pantalla sin mouse.
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onNavegar(m.id);
              }
            }}
          >
            <span className="icono-menu">
              <Icono nombre={m.id} tam={19} />
            </span>
            <span>{m.titulo}</span>
          </li>
        ))}
      </ul>

      <footer>
        {fotoUrl ? (
          <img src={fotoUrl} alt="" className="avatar"
               style={{ objectFit: "cover" }} />
        ) : (
          <span className="avatar">
            {(usuario?.nombre || "?")[0].toUpperCase()}
          </span>
        )}
        <b style={{ fontSize: ".86rem", textTransform: "capitalize" }}>
          {usuario?.nombre}
        </b>
        <small>
          {usuario?.perfil === "auditor"
            ? "Administrador de bodega"
            : "Auxiliar de inventarios"}
        </small>
        {colaLen > 0 && (
          <span className="chip oro" style={{ marginTop: 6 }}>{colaLen} por sincronizar</span>
        )}
        <img src="/colsubsidio-blanco.png" alt="Colsubsidio" />
      </footer>
    </nav>
  );
}
