import { useEffect, useState } from "react";
import { pedir } from "../api";
import Marco from "../Marco";

export default function Ajustes({ token, usuario }) {
  const [cfg, setCfg] = useState(null);
  const [usuarios, setUsuarios] = useState([]);
  const [traza, setTraza] = useState([]);
  const esAuditor = usuario?.perfil === "auditor";

  useEffect(() => {
    pedir("/api/ajustes", {}, token).then(setCfg).catch(() => {});
    if (esAuditor) {
      pedir("/api/usuarios", {}, token).then(setUsuarios).catch(() => {});
      pedir("/api/trazabilidad", {}, token).then(setTraza).catch(() => {});
    }
  }, [token, esAuditor]);

  return (
    <Marco titulo="Ajustes  ·  configuración del sistema"
           chip={{ texto: esAuditor ? "ADMINISTRADORA" : "SOLO LECTURA",
                   tipo: esAuditor ? "azul" : "gris" }}>
      {cfg && (
        <div className="card">
          <h3>Validación y conexión</h3>
          <table>
            <tbody>
              <tr><td>Umbral de anomalía</td><td><b>{cfg.umbral} %</b></td></tr>
              <tr><td>Bloquear cantidades negativas</td><td><b>Activado</b></td></tr>
              <tr><td>Exigir confirmación en alertas</td><td><b>Activado</b></td></tr>
              <tr><td>Modo sin conexión</td><td><b>Activado</b></td></tr>
              <tr><td>Refresco de Power BI</td><td><b>{cfg.refresco_pbi}</b></td></tr>
            </tbody>
          </table>
          <h3 style={{ marginTop: 18 }}>Acerca de CuentaVoz</h3>
          <table>
            <tbody>
              <tr><td>Versión</td><td><b>{cfg.version}</b></td></tr>
              <tr><td>Modelo del agente</td><td><b>{cfg.modelo}</b></td></tr>
              <tr><td>Idioma del reconocimiento</td><td><b>{cfg.idioma_voz}</b></td></tr>
            </tbody>
          </table>
          <p className="pista" style={{ marginTop: 10 }}>
            El umbral y las reglas se leen del archivo .env del backend.
          </p>
        </div>
      )}

      {esAuditor && (
        <>
          <div className="card">
            <h3>Gestión de usuarios ({usuarios.length})</h3>
            <table>
              <thead><tr><th>Persona</th><th>Perfil</th><th>Correo</th><th>Estado</th></tr></thead>
              <tbody>
                {usuarios.map((u) => (
                  <tr key={u.id}>
                    <td style={{ textTransform: "capitalize" }}>{u.nombre}</td>
                    <td>{u.perfil === "auditor" ? "Administrador" : "Auxiliar"}</td>
                    <td>{u.correo || "—"}</td>
                    <td style={{ color: u.activo ? "var(--verde)" : "var(--grafito)",
                                 fontWeight: 700 }}>
                      {u.activo ? "Activo" : "Inactivo"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="pista" style={{ marginTop: 10 }}>
              El auxiliar cuenta y crea; solo el administrador aprueba, audita y cierra.
            </p>
          </div>

          <div className="card">
            <h3>Registro de trazabilidad ({traza.length} acciones)</h3>
            <p className="pista">
              Todo queda con persona, hora y dato. El registro no se puede editar ni borrar.
            </p>
            {traza.length === 0 ? (
              <p className="vacio">Sin acciones registradas todavía.</p>
            ) : (
              <table>
                <thead><tr><th>Hora</th><th>Persona</th><th>Acción</th><th>Detalle</th></tr></thead>
                <tbody>
                  {traza.slice(0, 25).map((t) => (
                    <tr key={t.id}>
                      <td>{t.hora}</td>
                      <td style={{ textTransform: "capitalize" }}>{t.persona}</td>
                      <td><span className={`chip ${t.tipo === "alerta" ? "oro"
                            : t.tipo === "ok" ? "verde" : ""}`}>{t.accion}</span></td>
                      <td>{t.detalle}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </Marco>
  );
}
