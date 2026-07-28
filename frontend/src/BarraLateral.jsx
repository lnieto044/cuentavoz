import { MENU } from "./App";
import Icono from "./Iconos";

export default function BarraLateral({ activo, usuario, onNavegar }) {
  const esAuditor = usuario?.perfil === "auditor";
  const items = MENU.filter((m) => !m.soloAuditor || esAuditor);
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
        <span className="avatar">
          {(usuario?.nombre || "?")[0].toUpperCase()}
        </span>
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
