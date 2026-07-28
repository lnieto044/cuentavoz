import { useState } from "react";
import { borrarToken, pedir } from "./api";
import { configurarVoz } from "./voz";
import BarraLateral from "./BarraLateral";
import Ingreso from "./vistas/Ingreso";
import Inicio from "./vistas/Inicio";
import Conteo from "./vistas/Conteo";
import Pedido from "./vistas/Pedido";
import Legalizacion from "./vistas/Legalizacion";
import Bodegas from "./vistas/Bodegas";
import Auditoria from "./vistas/Auditoria";
import Reportes from "./vistas/Reportes";
import Panel from "./vistas/Panel";
import Ajustes from "./vistas/Ajustes";
import Ayuda from "./vistas/Ayuda";
import MiPerfil from "./vistas/MiPerfil";
import CerrarSesion from "./vistas/CerrarSesion";

/* El menú lateral. Cada entrada declara las vistas que contiene:
   este objeto es el mapa de navegación hecho código. */
export const MENU = [
  { id: "inicio",       titulo: "Inicio",        vistas: ["inicio"] },
  { id: "pedidos",      titulo: "Pedidos",       vistas: ["pedido"] },
  { id: "conteo",       titulo: "Conteo",        vistas: ["conteo"] },
  { id: "legalizacion", titulo: "Legalización",  vistas: ["legalizacion"] },
  { id: "bodegas",      titulo: "Bodegas",       vistas: ["bodegas"] },
  { id: "auditoria",    titulo: "Auditoría",     vistas: ["auditoria"], soloAuditor: true },
  { id: "reportes",     titulo: "Reportes",      vistas: ["reportes"], soloAuditor: true },
  { id: "panel",        titulo: "Panel",         vistas: ["panel"], soloAuditor: true },
  { id: "ajustes",      titulo: "Ajustes",       vistas: ["ajustes"] },
  { id: "ayuda",        titulo: "Ayuda",         vistas: ["ayuda"] },
  { id: "perfil",       titulo: "Mi perfil",     vistas: ["perfil"] },
  { id: "salir",        titulo: "Cerrar sesión", vistas: ["salir"] },
];

const VISTAS = {
  inicio: Inicio, pedido: Pedido, conteo: Conteo,
  legalizacion: Legalizacion, bodegas: Bodegas, auditoria: Auditoria,
  reportes: Reportes, panel: Panel, ajustes: Ajustes, ayuda: Ayuda,
  perfil: MiPerfil,
};

/** Qué entrada del menú resaltar para una vista. Garantiza que el menú
    señale siempre dónde vive la pantalla que se está viendo. */
export function menuDe(vista) {
  const g = MENU.find((m) => m.vistas.includes(vista));
  return g ? g.id : null;
}

export default function App() {
  const [sesion, setSesion] = useState(null);
  const [vista, setVista] = useState("inicio");
  const [ctx, setCtx] = useState({ sesionId: 1 });
  const [salir, setSalir] = useState(false);

  /** Navega y pasa contexto: ir("bodegas", { bodegaId: 3 }) */
  function ir(destino, contexto = {}) {
    setCtx((c) => ({ ...c, ...contexto }));
    setVista(destino);
  }

  if (!sesion)
    return (
      <Ingreso
        alEntrar={(s) => {
          setSesion(s);
          setVista("inicio");
          pedir("/api/usuarios/yo", {}, s.token).then((p) =>
            configurarVoz({ idioma: p.idioma_voz, velocidad: p.velocidad_voz,
                           confirmacionHablada: p.confirmacion_hablada })
          ).catch(() => {});
        }}
      />
    );

  const Vista = VISTAS[vista] || Inicio;

  return (
    <div className="app-root">
      <BarraLateral
        activo={salir ? "salir" : menuDe(vista)}
        usuario={sesion.usuario}
        token={sesion.token}
        onNavegar={(id) => {
          if (id === "salir") {
            setSalir(true);
            return;
          }
          const g = MENU.find((m) => m.id === id);
          if (g) ir(g.vistas[0]);
        }}
      />

      <div className="contenido">
        <Vista
          token={sesion.token}
          usuario={sesion.usuario}
          {...ctx}
          ir={ir}
        />
      </div>

      {salir && (
        <CerrarSesion
          token={sesion.token}
          sesionId={ctx.sesionId}
          onCancelar={() => setSalir(false)}
          onSalir={() => {
            borrarToken();
            setSesion(null);
            setSalir(false);
            setVista("inicio");
          }}
        />
      )}
    </div>
  );
}
