import { useEffect, useState } from "react";
import { pedir } from "../api";
import Marco from "../Marco";
import AsistenteVoz from "../AsistenteVoz";

// timeZone fijo en Bogotá (no el del navegador/equipo): CuentaVoz es para
// la operación de Colsubsidio en Colombia, así que la fecha y el saludo
// deben leerse en hora de Bogotá aunque el dispositivo esté mal
// configurado o alguien entre desde otro huso horario.
const HUSO = "America/Bogota";
// Función, no constante: si se calculara una sola vez al cargar el módulo
// (como antes), un turno que deja la pestaña abierta de un día para otro
// -habitual en una tablet de bodega siempre encendida- seguía mostrando la
// fecha de ayer en el encabezado hasta recargar la página a la fuerza.
function fechaHoy() {
  return new Date().toLocaleDateString("es-CO", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
    timeZone: HUSO,
  });
}

/** "Buenos días" antes de mediodía, "Buenas tardes" hasta las 7pm, y
    "Buenas noches" después - siempre en hora de Bogotá. Sin esto el
    saludo decía "Buenos días" a cualquier hora, incluso de noche. */
function saludoSegunHora() {
  const hora = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: HUSO, hour: "numeric", hourCycle: "h23" })
      .format(new Date())
  );
  if (hora < 12) return "Buenos días";
  if (hora < 19) return "Buenas tardes";
  return "Buenas noches";
}

// Debe cubrir las mismas acciones que registra backend/seguridad.py:registrar()
// (la misma lista que el filtro de Ajustes › Trazabilidad) - si aquí falta
// alguna, esa fila cae al gris por defecto aunque tenga su propio color en
// todas las demás pantallas, y hasta ahora faltaba más de la mitad,
// incluida CONTEO: la acción más frecuente del día a día.
const COLOR_ACCION = {
  FIRMA: "verde", CIERRE: "verde", APROBACION: "verde", CREACION: "verde",
  CONTEO: "verde",
  REPORTE: "azul", INGRESO: "azul", APERTURA: "azul", PEDIDO: "azul",
  RECETA: "azul", LEGALIZACION: "azul", ASIGNACION: "azul", USUARIO: "azul",
  AJUSTE: "azul", PERFIL: "azul", SOPORTE: "azul",
  ALERTA: "oro", CORRECCION: "oro", REAPERTURA: "oro", AUDITORIA: "oro",
  SEGURIDAD: "oro",
};
const DOT = { verde: "var(--verde)", azul: "var(--azul)",
              oro: "var(--amarillo)", gris: "var(--grafito)" };

export default function Inicio({ token, usuario, ir }) {
  const [resumen, setResumen] = useState(null);
  const [actividad, setActividad] = useState([]);
  const esAuditor = usuario?.perfil === "auditor";

  // Ejemplos de lo que ya entiende el agente aquí: preguntar por los KPI de
  // esta pantalla, o pedir directo cualquiera de los accesos rápidos de
  // abajo - decir su nombre ya navega, sin tener que tocarlo.
  const ejemplos = [
    "¿cuántas bodegas tengo?", "¿cuántas alertas hay por revisar?",
    "¿cuál es mi exactitud del mes?", "iniciar un conteo", "ver el tablero",
    ...(esAuditor ? ["continuar auditoría", "generar reporte"]
                  : ["hacer un pedido", "legalizar servicio"]),
  ];

  useEffect(() => {
    pedir("/api/usuarios/yo/resumen", {}, token).then(setResumen).catch(() => {});
    pedir("/api/trazabilidad/reciente", {}, token).then(setActividad).catch(() => {});
  }, [token]);

  // "Auditoría"/"Reportes"/"Panel" ni siquiera aparecen en el menú lateral
  // de un auxiliar (soloAuditor en App.jsx:MENU) - ofrecerlos aqui como
  // acceso directo llevaba a una pantalla que el propio perfil no puede
  // usar, aunque el menu de al lado dijera lo contrario.
  const accesos = esAuditor ? [
    { t: "Iniciar un conteo", s: "dicte y CuentaVoz registra", d: "conteo", ic: "🎙️" },
    { t: "Ver el tablero", s: "estado de las bodegas", d: "bodegas", ic: "🏬" },
    { t: "Continuar auditoría", s: "recuento ciego y aprobaciones", d: "auditoria", ic: "🔍" },
    { t: "Generar reporte", s: "consolidado del día", d: "reportes", ic: "📄" },
  ] : [
    { t: "Iniciar un conteo", s: "dicte y CuentaVoz registra", d: "conteo", ic: "🎙️" },
    { t: "Ver el tablero", s: "estado de las bodegas", d: "bodegas", ic: "🏬" },
    { t: "Hacer un pedido", s: "receta y porciones por voz", d: "pedido", ic: "📋" },
    { t: "Legalizar servicio", s: "sobrante y merma del turno", d: "legalizacion", ic: "⚖️" },
  ];

  return (
    <Marco titulo={`Inicio  ·  ${fechaHoy()}`}
           chip={{ texto: "TOMA EN CURSO", tipo: "verde" }}>
      <h2 style={{ fontSize: "1.15rem", color: "var(--azul)", marginBottom: 14 }}>
        {saludoSegunHora()}, <span style={{ textTransform: "capitalize" }}>{usuario?.nombre}</span>.
        Esto es lo que hay para hoy.
      </h2>

      <AsistenteVoz token={token} vista="inicio" ir={ir} ejemplos={ejemplos}
                    placeholder="¿cuántas bodegas tengo?, lléveme a bodegas…" />

      <div className="kpis">
        <div className="kpi">
          <div className="kpi-cabeza">
            <span className="icono-kpi">🏬</span>
            <small>Bodegas asignadas a usted</small>
          </div>
          <b>{resumen?.bodegas_asignadas ?? "—"}</b>
          <i>según su perfil</i>
        </div>
        <div className="kpi">
          <div className="kpi-cabeza">
            <span className="icono-kpi">📦</span>
            <small>Referencias contadas hoy</small>
          </div>
          <b>{resumen?.referencias_hoy ?? "—"}</b>
          <i>en sus sesiones de conteo</i>
        </div>
        <div className={`kpi ${resumen?.alertas_por_revisar ? "oro" : "verde"}`}>
          <div className="kpi-cabeza">
            <span className="icono-kpi">{resumen?.alertas_por_revisar ? "⚠️" : "✅"}</span>
            <small>Alertas por revisar</small>
          </div>
          <b>{resumen?.alertas_por_revisar ?? "—"}</b>
          <i>en toda la operación</i>
        </div>
        <div className="kpi verde">
          <div className="kpi-cabeza">
            <span className="icono-kpi">📈</span>
            <small>Su exactitud del mes</small>
          </div>
          <b>{resumen ? `${resumen.exactitud_mes} %` : "—"}</b>
          <i>promedio de bodegas cerradas</i>
        </div>
      </div>

      <div className="card">
        <h3>¿Qué desea hacer?</h3>
        <div className="accesos-grid">
          {accesos.map((a) => (
            <button key={a.d} className="acceso-rapido"
                    onClick={() => ir(a.d)}>
              <span className="icono-accion">{a.ic}</span>
              <b>{a.t}</b>
              <small>{a.s}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Actividad reciente</h3>
        {actividad.length === 0 ? (
          <p className="vacio">Todavía no hay actividad registrada hoy.</p>
        ) : (
          actividad.map((a, i) => {
            const color = COLOR_ACCION[a.accion] || "gris";
            return (
              <div className="registro" key={i}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", flex: "none",
                              background: DOT[color] }} />
                <b style={{ color: "var(--grafito)", minWidth: 46 }}>{a.hora}</b>
                <span>{a.detalle}</span>
                <span className={`etiqueta-actividad ${color}`}>
                  {a.accion.toLowerCase()}
                </span>
              </div>
            );
          })
        )}
      </div>
    </Marco>
  );
}
