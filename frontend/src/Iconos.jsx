/** Iconos del menú lateral. Uno por cada entrada, en trazo simple.
 *  Heredan el color del texto (currentColor), así el CSS decide si van
 *  en dorado (activo) o en gris azulado (inactivo). Sin fondo. */
const TRAZO = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

const FORMAS = {
  // Inicio: casa
  inicio: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5.5 9.5V20h13V9.5" /><path d="M10 20v-5h4v5" /></>,
  // Pedidos: nota de pedido con esquina doblada
  pedidos: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /><path d="M9 12h6M9 16h4" /></>,
  // Conteo: micrófono
  conteo: <><rect x="10" y="3" width="4" height="9" rx="2" /><path d="M6.5 11a5.5 5.5 0 0 0 11 0" /><path d="M12 16.5V20" /><path d="M9 20h6" /></>,
  // Legalización: balanza (lo pedido contra lo usado)
  legalizacion: <><path d="M12 4v15" /><path d="M5 7h14" /><path d="M8.5 19h7" /><path d="M2.5 12 5 7l2.5 5a2.5 2.5 0 0 1-5 0z" /><path d="M16.5 12 19 7l2.5 5a2.5 2.5 0 0 1-5 0z" /></>,
  // Bodegas: bodega con techo a dos aguas
  bodegas: <><path d="M3 9.5 12 3l9 6.5" /><path d="M5 9v11h14V9" /><path d="M5 14.5h14" /><path d="M12 9v11" /></>,
  // Auditoría: lupa con visto bueno
  auditoria: <><circle cx="11" cy="10.5" r="6" /><path d="M15.5 15 20 19.5" /><path d="M8.5 10.5l2 2 3.5-4" /></>,
  // Reportes: documento con líneas
  reportes: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8.5 8h7M8.5 12h7M8.5 16h4" /></>,
  // Panel: barras
  panel: <><path d="M4 20h16" /><rect x="6" y="12" width="3" height="6" /><rect x="11" y="7" width="3" height="11" /><rect x="16" y="14" width="3" height="4" /></>,
  // Ajustes: engranaje
  ajustes: <><circle cx="12" cy="12" r="3.2" /><path d="M12 3v2.6M12 18.4V21M3 12h2.6M18.4 12H21M5.6 5.6l1.9 1.9M16.5 16.5l1.9 1.9M18.4 5.6l-1.9 1.9M7.5 16.5l-1.9 1.9" /></>,
  // Ayuda: interrogación en círculo
  ayuda: <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.3" /><circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none" /></>,
  // Mensajes: sobre de correo
  mensajes: <><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="M3.5 7 12 13l8.5-6" /></>,
  // Mi perfil: persona
  perfil: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
  // Cerrar sesión: puerta con flecha de salida
  salir: <><path d="M14 4H6v16h8" /><path d="M11 12h9" /><path d="M17 8.5 20.5 12 17 15.5" /></>,
  // Candado: campo de PIN en el ingreso
  candado: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7.5a4 4 0 0 1 8 0V11" /></>,
};

export default function Icono({ nombre, tam = 20 }) {
  const forma = FORMAS[nombre];
  if (!forma) return null;
  return (
    <svg
      width={tam}
      height={tam}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ flex: "none" }}
      {...TRAZO}
    >
      {forma}
    </svg>
  );
}
