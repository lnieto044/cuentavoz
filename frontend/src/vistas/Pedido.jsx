import { useState } from "react";
import { pedir, enviarTurno } from "../api";
import { escuchar, hablar } from "../voz";
import Marco from "../Marco";

export default function Pedido({ token, sesionId = 1 }) {
  const [plato, setPlato] = useState("ajiaco");
  const [porciones, setPorciones] = useState(50);
  const [lineas, setLineas] = useState(null);
  const [respuesta, setRespuesta] = useState(
    "Diga el plato y las porciones: «hoy preparamos cincuenta ajiacos»."
  );
  const [estado, setEstado] = useState("listo");
  const [err, setErr] = useState("");

  /** La frase del chef la interpreta el agente. */
  async function dictar(texto) {
    setErr("");
    try {
      const t = await enviarTurno(texto, sesionId, token);
      if (t.preparacion) setPlato(t.preparacion);
      if (t.porciones) setPorciones(t.porciones);
      setRespuesta(t.respuesta_hablada || "");
      hablar(t.respuesta_hablada);
    } catch (e) {
      setErr(e.message);
    } finally {
      setEstado("listo");
    }
  }

  /** El backend explota la receta y descuenta el stock. */
  async function calcular() {
    setErr("");
    try {
      const r = await pedir("/api/pedidos/calcular", {
        method: "POST",
        body: JSON.stringify({ plato, porciones: Number(porciones), bodega_id: 1 }),
      }, token);
      if (!r.lineas.length) {
        setErr(`No encontré una receta para «${plato}». Pruebe con ajiaco o sancocho.`);
        return;
      }
      setLineas(r.lineas);
      const faltan = r.lineas.filter((l) => l.falta > 0).length;
      const msg = `Necesita ${r.lineas.length} insumos. Hay que pedir ${faltan} al almacén; el resto ya está en la bodega.`;
      setRespuesta(msg);
      hablar(msg);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function enviar() {
    try {
      await pedir("/api/pedidos/enviar", {
        method: "POST",
        body: JSON.stringify({ lineas, servicio_id: 1 }),
      }, token);
      const msg = "Pedido enviado al almacén.";
      setRespuesta(msg);
      hablar(msg);
    } catch (e) {
      setErr(e.message);
    }
  }

  const porPedir = lineas ? lineas.filter((l) => l.falta > 0).length : 0;

  return (
    <Marco titulo="Pedidos  ·  del plato a los insumos"
           chip={{ texto: "MOMENTO 1 DEL RETO", tipo: "azul" }}>
      <div className="conteo-cols">
        <div className="card">
          <p className="rotulo">CuentaVoz responde</p>
          <div className="burbuja">{respuesta}</div>

          <h3 style={{ marginTop: 18 }}>Lo que se va a preparar</h3>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input value={plato} onChange={(e) => setPlato(e.target.value)}
                   placeholder="ajiaco"
                   style={{ flex: 2, minWidth: 180, padding: "11px 13px",
                            border: "1px solid var(--borde)", borderRadius: 12 }} />
            <input type="number" value={porciones} min="1"
                   onChange={(e) => setPorciones(e.target.value)}
                   style={{ width: 110, padding: "11px 13px",
                            border: "1px solid var(--borde)", borderRadius: 12 }} />
            <button className="btn" onClick={calcular}>Calcular el pedido</button>
          </div>
          {err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}
        </div>

        <div className="card mic-caja">
          <button className={`mic-btn ${estado === "escuchando" ? "escuchando" : ""}`}
                  onClick={() => escuchar({
                    alTexto: dictar,
                    alEstado: setEstado,
                    alError: setErr,
                  })}>
            🎤
          </button>
          <b>{estado === "escuchando" ? "Escuchando…" : "Toque y hable"}</b>
          <small>«hoy preparamos cincuenta ajiacos»</small>
          <small style={{ color: "var(--verde)", fontWeight: 700 }}>
            Receta + stock = pedido
          </small>
        </div>
      </div>

      {lineas && (
        <>
          <div className="kpis">
            <div className="kpi">
              <small>Insumos de la receta</small><b>{lineas.length}</b>
              <i>ingredientes estándar</i>
            </div>
            <div className="kpi verde">
              <small>Ya disponibles en bodega</small>
              <b>{lineas.length - porPedir}</b><i>no se piden</i>
            </div>
            <div className="kpi oro">
              <small>Hay que pedir al almacén</small><b>{porPedir}</b>
              <i>faltante calculado</i>
            </div>
          </div>

          <div className="card">
            <h3>Insumos calculados para {porciones} {plato}</h3>
            <table>
              <thead>
                <tr>
                  <th>Insumo (nombre oficial)</th><th>Unidad</th>
                  <th>Necesario</th><th>Hay en bodega</th><th>Falta: pedir</th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l) => (
                  <tr key={l.codigo}>
                    <td>{l.nombre}</td>
                    <td>{l.unidad}</td>
                    <td>{l.necesario}</td>
                    <td>{l.stock}</td>
                    <td className={l.falta > 0 ? "falta" : ""}>
                      {l.falta > 0 ? l.falta : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="pista" style={{ marginTop: 10 }}>
              La cantidad necesaria sale de la receta por porción; el faltante es
              lo necesario menos lo que ya hay en la bodega.
            </p>
            <div className="grilla-botones">
              <button className="btn verde" onClick={enviar}>
                Enviar pedido al almacén
              </button>
            </div>
          </div>
        </>
      )}
    </Marco>
  );
}
