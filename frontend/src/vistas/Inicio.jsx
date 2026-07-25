import { useEffect, useState } from "react";
import { pedir } from "../api";
import Marco from "../Marco";

export default function Inicio({ token, usuario, ir }) {
  const [salud, setSalud] = useState(null);
  useEffect(() => {
    pedir("/api/salud", {}, token).then(setSalud).catch(() => {});
  }, [token]);

  const accesos = [
    { t: "Pedir insumos", s: "«hoy preparamos 50 ajiacos»", d: "pedido" },
    { t: "Iniciar un conteo", s: "dicte y CuentaVoz registra", d: "conteo" },
    { t: "Legalizar el servicio", s: "lo pedido vs. lo usado", d: "legalizacion" },
    { t: "Ver el tablero", s: "estado de las bodegas", d: "bodegas" },
  ];

  return (
    <Marco titulo={`Inicio  ·  hola, ${usuario?.nombre || ""}`}
           chip={{ texto: "TOMA EN CURSO", tipo: "verde" }}>
      <div className="kpis">
        <div className="kpi">
          <small>Bodegas en el sistema</small>
          <b>{salud?.bodegas ?? "—"}</b><i>del extracto de Colsubsidio</i>
        </div>
        <div className="kpi">
          <small>Artículos del catálogo</small>
          <b>{salud?.articulos ?? "—"}</b><i>con nombre y unidad oficiales</i>
        </div>
        <div className="kpi">
          <small>Registros de stock</small>
          <b>{salud?.stock ?? "—"}</b><i>corte cargado</i>
        </div>
        <div className={`kpi ${salud?.gemini ? "verde" : "oro"}`}>
          <small>Agente de voz</small>
          <b>{salud?.gemini ? "Gemini" : "Local"}</b>
          <i>{salud?.gemini ? "conectado a AI Studio" : "sin llave: intérprete local"}</i>
        </div>
      </div>

      <div className="card">
        <h3>¿Qué desea hacer?</h3>
        <div className="grid-bodegas">
          {accesos.map((a) => (
            <button key={a.d} className="tarjeta-bodega en_conteo"
                    onClick={() => ir(a.d)}>
              <b>{a.t}</b>
              <small>{a.s}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Los tres momentos manuales del reto</h3>
        <table>
          <thead>
            <tr><th>Momento</th><th>Dónde está en la aplicación</th><th>Qué elimina</th></tr>
          </thead>
          <tbody>
            <tr><td>1. Pedido al almacén</td><td>Menú Pedidos</td>
                <td>El papel donde el chef anota los ingredientes</td></tr>
            <tr><td>2. Toma física</td><td>Menú Conteo y Bodegas</td>
                <td>La planilla que después alguien digita</td></tr>
            <tr><td>3. Legalización</td><td>Menú Legalización</td>
                <td>La nota de lo que sobró y lo que se perdió</td></tr>
          </tbody>
        </table>
      </div>
    </Marco>
  );
}
