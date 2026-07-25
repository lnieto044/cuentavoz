import { useEffect, useState } from "react";
import { pedir } from "../api";
import Marco from "../Marco";

export default function Panel({ token }) {
  const [salud, setSalud] = useState(null);
  const [bodegas, setBodegas] = useState([]);
  const [alertas, setAlertas] = useState([]);
  const urlPBI = import.meta.env.VITE_POWERBI_URL;

  useEffect(() => {
    pedir("/api/salud", {}, token).then(setSalud).catch(() => {});
    pedir("/api/bodegas", {}, token).then(setBodegas).catch(() => {});
    pedir("/api/alertas?resueltas=0", {}, token).then(setAlertas).catch(() => {});
  }, [token]);

  const cerradas = bodegas.filter((b) => b.estado === "cerrada").length;

  return (
    <Marco titulo="Panel gerencial  ·  cierre de inventario"
           chip={{ texto: "ACTUALIZADO AHORA", tipo: "verde" }}>
      <div className="kpis">
        <div className="kpi verde"><small>Bodegas cerradas</small>
          <b>{cerradas} / {bodegas.length}</b><i>con doble firma digital</i></div>
        <div className="kpi"><small>Referencias en el corte</small>
          <b>{salud?.stock ?? "—"}</b><i>del extracto oficial</i></div>
        <div className="kpi oro"><small>Alertas abiertas</small>
          <b>{alertas.length}</b><i>por gestionar</i></div>
        <div className="kpi"><small>Artículos del catálogo</small>
          <b>{salud?.articulos ?? "—"}</b><i>nombres oficiales</i></div>
      </div>

      <div className="card">
        <h3>Informe de Power BI</h3>
        {urlPBI ? (
          <iframe title="Panel gerencial CuentaVoz" src={urlPBI}
                  style={{ width: "100%", height: 520, border: 0, borderRadius: 12 }}
                  allowFullScreen />
        ) : (
          <>
            <p className="pista">
              Para insertar el informe: publíquelo en Power BI Service, copie el
              enlace de <b>Archivo → Insertar informe</b> y póngalo en el archivo
              <b> .env</b> del frontend como <b>VITE_POWERBI_URL</b>.
            </p>
            <p className="pista">
              Conexión: servidor <b>localhost:5432</b>, base <b>cuentavoz</b>,
              usuario <b>cuentavoz</b>. Modo Importación, refresco cada 15 minutos.
            </p>
            <div className="banner ok" style={{ marginTop: 14 }}>
              <span className="ico">✓</span>
              <span>
                <b>Una sola fuente, dos salidas</b>
                <span>El informe que abre la gerencia y el panel que se ve aquí
                      son el mismo, alimentado por PostgreSQL.</span>
              </span>
            </div>
          </>
        )}
      </div>
    </Marco>
  );
}
