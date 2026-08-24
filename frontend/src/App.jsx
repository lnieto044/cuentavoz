import { useEffect, useRef, useState } from "react";
import { alSesionInvalida, borrarSesion, guardarSesion, leerSesion, pedir } from "./api";
import { obtenerTokenValido, cerrarSesionLocal } from "./cognito";
import { configurarVoz, detenerVoz } from "./voz";
import { leerPreferencias, aplicarPreferencias } from "./accesibilidad";
import VideoRecorrido from "./VideoRecorrido";
import { debeAbrirTutorial, marcarTutorialVisto, EVENTO_ABRIR_VIDEO } from "./tutorial";
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
import Mensajes from "./vistas/Mensajes";
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
  // El auxiliar no puede cambiar nada aquí (el umbral y el modo sin
  // conexión ya estaban bloqueados por el backend con requiere_perfil):
  // mostrarle la pantalla igual, solo en modo lectura, dejaba ver ajustes
  // administrativos que no le sirven de nada y no puede tocar - mejor
  // ocultarla del todo, igual que ya se hace con Auditoría/Reportes/Panel.
  { id: "ajustes",      titulo: "Ajustes",       vistas: ["ajustes"], soloAuditor: true },
  { id: "ayuda",        titulo: "Ayuda",         vistas: ["ayuda"] },
  { id: "mensajes",     titulo: "Mensajes",      vistas: ["mensajes"] },
  { id: "perfil",       titulo: "Mi perfil",     vistas: ["perfil"] },
  { id: "salir",        titulo: "Cerrar sesión", vistas: ["salir"] },
];

const VISTAS = {
  inicio: Inicio, pedido: Pedido, conteo: Conteo,
  legalizacion: Legalizacion, bodegas: Bodegas, auditoria: Auditoria,
  reportes: Reportes, panel: Panel, ajustes: Ajustes, ayuda: Ayuda,
  mensajes: Mensajes, perfil: MiPerfil,
};

/** Qué entrada del menú resaltar para una vista. Garantiza que el menú
    señale siempre dónde vive la pantalla que se está viendo. */
export function menuDe(vista) {
  const g = MENU.find((m) => m.vistas.includes(vista));
  return g ? g.id : null;
}

export default function App() {
  // arranca directo con la sesión ya guardada (si hay) en vez de forzar
  // login otra vez: sin esto, abrir la app sin señal (o reiniciarla en
  // medio de una caída de Wi-Fi) dejaba a cualquiera sin poder entrar,
  // aunque ya se hubiera identificado antes en este mismo equipo.
  const [sesion, setSesion] = useState(() => leerSesion());
  const [vista, setVista] = useState("inicio");
  // Antes de abrir una bodega no hay todavia un id real de sesion de
  // conteo (ver Conteo.jsx) - un marcador de posicion fijo (antes: 1 para
  // todo el mundo) hacia que dos personas sin ninguna bodega abierta
  // todavia pudieran mezclar su conversacion pendiente. Uno por usuario,
  // igual que ya hace Pedido.jsx con el suyo.
  const [ctx, setCtx] = useState(() => ({ sesionId: -2000 - (sesion?.usuario?.id || 0) }));
  const [salir, setSalir] = useState(false);
  const [avisoSesion, setAvisoSesion] = useState("");
  const [mostrarVideo, setMostrarVideo] = useState(false);

  // "Ver el recorrido en video" en Ayuda.jsx reabre el recorrido bajo
  // demanda con un evento (mismo patrón que cuentavoz:foto-actualizada) en
  // vez de pasar la función por props a través de todas las vistas.
  useEffect(() => {
    function abrirVideo() { setMostrarVideo(true); }
    window.addEventListener(EVENTO_ABRIR_VIDEO, abrirVideo);
    return () => window.removeEventListener(EVENTO_ABRIR_VIDEO, abrirVideo);
  }, []);

  // Alto contraste / tamaño de letra (Mi perfil > Accesibilidad) son
  // preferencias de ESTE equipo (localStorage), no de la cuenta - se
  // aplican una sola vez al montar, antes incluso de que haya sesión, para
  // que también se vean en la pantalla de login.
  useEffect(() => {
    aplicarPreferencias(leerPreferencias());
  }, []);

  // Se suscribe una sola vez: cuando pedir() encuentra un 401 (sesión
  // cerrada desde otro dispositivo, PIN cambiado, cuenta desactivada...)
  // vuelve aquí mismo a la pantalla de login en vez de dejar el menú y las
  // vistas mostrando datos de una sesión que el servidor ya no reconoce.
  useEffect(() => {
    alSesionInvalida(() => {
      cerrarSesionLocal();
      setSesion(null);
      setVista("inicio");
      setAvisoSesion("Su sesión terminó (se cerró desde otro dispositivo o venció). Ingrese de nuevo.");
    });
  }, []);

  // El access token de Cognito dura poco a propósito (1 hora, ver
  // ARQUITECTURA.md), pero cada vista recibe el token como prop suelto
  // (no llama a Cognito directo por sí misma) - sin esto, la sesión se
  // caía cada hora en plena demo. Se revisa cada pocos minutos (getSession
  // del SDK refresca solo con el refresh token, sin red de por medio si
  // el access token todavía es válido) y se actualiza sesion.token para
  // que el próximo render lo pase ya fresco a todas las pantallas.
  useEffect(() => {
    if (!sesion) return;
    let vivo = true;
    async function refrescar() {
      const token = await obtenerTokenValido();
      if (!vivo) return;
      if (!token) {
        cerrarSesionLocal();
        setSesion(null);
        setVista("inicio");
        setAvisoSesion("Su sesión venció. Ingrese de nuevo.");
        return;
      }
      if (token !== sesion.token) {
        const nueva = { ...sesion, token };
        guardarSesion(nueva);
        setSesion(nueva);
      }
    }
    refrescar();
    const intervalo = setInterval(refrescar, 4 * 60 * 1000);
    return () => { vivo = false; clearInterval(intervalo); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sesion?.usuario?.id]);

  // Contador que sube en cada ir(): las pantallas con pestañas usan
  // [tabInicial, navSeq] como dependencia de su useEffect en vez de solo
  // [tabInicial] - sin navSeq, pedir por voz la MISMA pestaña dos veces
  // seguidas (con un clic manual a otra pestaña en el medio) no cambiaba
  // nada, porque tabInicial ya traía ese mismo valor de la vez anterior y
  // React no vuelve a correr un efecto cuya dependencia no cambió de
  // valor, aunque la persona sí haya navegado a otro lado desde entonces.
  const navSeq = useRef(0);

  /** Navega y pasa contexto: ir("bodegas", { bodegaId: 3 }) */
  function ir(destino, contexto = {}) {
    // sin esto, una respuesta hablada que la pantalla anterior todavía
    // estaba esperando (la síntesis real tarda unos segundos) podía
    // reproducirse sola varios segundos después, ya con otra pantalla en
    // uso - sonaba como si el agente hablara de la nada, fuera de tema.
    detenerVoz();
    navSeq.current += 1;
    setCtx((c) => ({ ...c, ...contexto, navSeq: navSeq.current }));
    setVista(destino);
  }

  /** Conteo.jsx la llama apenas abre (o retoma) una bodega, con el id real
      que le devuelve el backend - así CerrarSesion (que vive fuera de
      Conteo, en la barra lateral) pregunta por el avance de la sesión que
      de verdad está abierta, no por el marcador de posición de antes de
      abrir nada. */
  function alAbrirBodega(sesionId) {
    setCtx((c) => ({ ...c, sesionId }));
  }

  if (!sesion)
    return (
      <Ingreso
        avisoInicial={avisoSesion}
        alEntrar={(s) => {
          guardarSesion(s);
          setSesion(s);
          setAvisoSesion("");
          setVista("inicio");
          if (debeAbrirTutorial()) { marcarTutorialVisto(); setMostrarVideo(true); }
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
        sesionId={ctx.sesionId}
        onNavegar={(id) => {
          detenerVoz();
          if (id === "salir") {
            setSalir(true);
            return;
          }
          const g = MENU.find((m) => m.id === id);
          if (g) {
            // el menu lateral es una navegacion "limpia": sin esto, un
            // contexto de una vista anterior (tabInicial="recetas" de
            // Pedido, bodegaId de un detalle, etc.) se quedaba pegado para
            // siempre - la proxima vez que se entraba a Ajustes por el
            // menu, por ejemplo, seguia abriendo la pestana equivocada.
            setCtx({ sesionId: ctx.sesionId });
            setVista(g.vistas[0]);
          }
        }}
      />

      <div className="contenido">
        <Vista
          token={sesion.token}
          usuario={sesion.usuario}
          {...ctx}
          ir={ir}
          alAbrirBodega={alAbrirBodega}
        />
      </div>

      {salir && (
        <CerrarSesion
          token={sesion.token}
          sesionId={ctx.sesionId}
          onCancelar={() => setSalir(false)}
          onSalir={() => {
            // Revoca en Cognito (mismo mecanismo que "cerrar todas las
            // sesiones" en Mi perfil) antes de limpiar localmente - sin
            // esto, "Cerrar sesión" solo borraba el token de ESTE
            // navegador; el access token seguía siendo válido en Cognito
            // hasta vencer solo (hasta 1 hora). En una tablet compartida entre
            // varios auxiliares, quien lo hubiera copiado antes de que la
            // persona cerrara sesión podía seguir usándolo. No bloquea la
            // salida si la petición falla (sin red) - la persona debe poder
            // salir localmente de todas formas.
            pedir("/api/usuarios/yo/cerrar-todas", { method: "POST" }, sesion.token).catch(() => {});
            cerrarSesionLocal();
            borrarSesion();
            setSesion(null);
            setSalir(false);
            setVista("inicio");
          }}
        />
      )}

      {mostrarVideo && (
        <VideoRecorrido perfil={sesion.usuario?.perfil}
                        onCerrar={() => setMostrarVideo(false)} />
      )}
    </div>
  );
}
