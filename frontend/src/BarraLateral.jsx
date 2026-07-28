import { useEffect, useState } from "react";
import { MENU } from "./App";
import Icono from "./Iconos";
import { BASE, leerToken } from "./api";

export default function BarraLateral({ activo, usuario, token, onNavegar }) {
  const esAuditor = usuario?.perfil === "auditor";
  const items = MENU.filter((m) => !m.soloAuditor || esAuditor);
  const [fotoUrl, setFotoUrl] = useState(null);

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
        .catch(() => setFotoUrl(null));
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
        <img src="/colsubsidio-blanco.png" alt="Colsubsidio" />
      </footer>
    </nav>
  );
}
