import { useEffect, useState } from "react";
import { pedir } from "../api";
import Marco from "../Marco";

const FECHA = new Date().toLocaleDateString("es-CO", {
  weekday: "long", day: "numeric", month: "long", year: "numeric",
});

const COLOR_ACCION = {
  FIRMA: "verde", CIERRE: "verde", APROBACION: "verde", REPORTE: "azul",
  ALERTA: "oro", CORRECCION: "oro", REAPERTURA: "oro",
  CREACION: "azul", AUDITORIA: "oro",
};
const DOT = { verde: "var(--verde)", azul: "var(--azul)",
              oro: "var(--amarillo)", gris: "var(--grafito)" };

export default function Inicio({ token, usuario, ir }) {
  const [resumen, setResumen] = useState(null);
  const [actividad, setActividad] = useState([]);

  useEffect(() => {
    pedir("/api/usuarios/yo/resumen", {}, token).then(setResumen).catch(() => {});
    pedir("/api/trazabilidad/reciente", {}, token).then(setActividad).catch(() => {});
  }, [token]);

  const accesos = [
    { t: "Iniciar un conteo", s: "dicte y CuentaVoz registra", d: "conteo", ic: "🎙️" },
    { t: "Ver el tablero", s: "estado de las bodegas", d: "bodegas", ic: "🏬" },
    { t: "Continuar auditoría", s: "recuento ciego y aprobaciones", d: "auditoria", ic: "🔍" },
    { t: "Generar reporte", s: "consolidado del día", d: "reportes", ic: "📄" },
  ];

  return (
    <Marco titulo={`Inicio  ·  ${FECHA}`}
           chip={{ texto: "TOMA EN CURSO", tipo: "verde" }}>
      <h2 style={{ fontSize: "1.15rem", color: "var(--azul)", marginBottom: 14 }}>
        Buenos días, <span style={{ textTransform: "capitalize" }}>{usuario?.nombre}</span>.
        Esto es lo que hay para hoy.
      </h2>

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
