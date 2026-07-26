import { useEffect, useState } from "react";
import { pedir } from "../api";
import { hablar } from "../voz";
import Marco from "../Marco";
import Dialogo from "../Dialogo";

const fmt = (n) => Number(n).toLocaleString("es-CO", { maximumFractionDigits: 2 });

/** Arma en palabras lo que ya se ve en la tabla, igual a como lo diría
    CuentaVoz - sobre datos reales, no un guion fijo. */
function narrar(sobrante, merma) {
  const partes = [];
  if (sobrante.length) {
    const detalle = sobrante
      .map((l) => `${fmt(Math.abs(l.diferencia))} de ${l.nombre.toLowerCase()}`)
      .join(" y ");
    partes.push(`Sobró ${detalle}: lo devuelvo a la bodega.`);
  }
  if (merma.length) {
    const detalle = merma
      .map((l) => `${fmt(l.diferencia)} en ${l.nombre.toLowerCase()}`)
      .join(", ");
    partes.push(`Hubo merma de ${detalle}.`);
  }
  if (!partes.length) partes.push("Todo cuadró exacto entre lo pedido y lo usado.");
  partes.push("¿Confirmo la legalización?");
  return partes.join(" ");
}

export default function Legalizacion({ token, servicioId = 1, ir }) {
  const [comp, setComp] = useState(null);
  const [listo, setListo] = useState(false);
  const [err, setErr] = useState("");
  const [respuesta, setRespuesta] = useState("");
  const [pedirAjuste, setPedirAjuste] = useState(false);
  const [verMerma, setVerMerma] = useState(false);

  function cargar() {
    pedir(`/api/legalizacion/${servicioId}`, {}, token)
      .then((c) => {
        setComp(c);
        const s = c.lineas.filter((l) => l.diferencia < 0);
        const m = c.lineas.filter((l) => l.diferencia > 0);
        setRespuesta(narrar(s, m));
      })
      .catch((e) => setErr(e.message));
  }
  useEffect(cargar, [servicioId, token]);

  async function confirmar() {
    try {
      await pedir("/api/legalizacion/confirmar", {
        method: "POST",
        body: JSON.stringify({ servicio_id: servicioId }),
      }, token);
      setListo(true);
      hablar("Legalización confirmada. El sobrante volvió a la bodega y la merma quedó registrada.");
    } catch (e) {
      setErr(e.message);
    }
  }

  async function ajustarPorVoz(texto) {
    setPedirAjuste(false);
    if (!texto) return;
    setErr("");
    try {
      const c = await pedir("/api/legalizacion/ajustar", {
        method: "POST",
        body: JSON.stringify({ servicio_id: servicioId, texto }),
      }, token);
      setComp(c);
      const s = c.lineas.filter((l) => l.diferencia < 0);
      const m = c.lineas.filter((l) => l.diferencia > 0);
      const msg = "Listo, ajustado. " + narrar(s, m);
      setRespuesta(msg);
      hablar(msg);
    } catch (e) {
      setErr(e.message);
    }
  }

  if (err) return <Marco titulo="Legalización"><p className="error">{err}</p></Marco>;
  if (!comp) return <Marco titulo="Legalización"><p className="cargando">Cargando…</p></Marco>;

  const sobrante = comp.lineas.filter((l) => l.diferencia < 0);
  const merma = comp.lineas.filter((l) => l.diferencia > 0);

  if (listo) {
    const fecha = new Date().toLocaleDateString("es-CO", { day: "numeric", month: "long" });
    return (
      <Marco titulo="Legalización  ·  Ajuste confirmado" chip={{ texto: "LEGALIZADO", tipo: "verde" }}>
        <div className="banner ok">
          <span className="ico">✓</span>
          <span>
            <b>Legalización confirmada — servicio de almuerzo del {fecha}</b>
            <span>El consumo real quedó registrado y el inventario de la cocina ya refleja los ajustes.</span>
          </span>
        </div>
        <div className="kpis">
          <div className="card" style={{ borderTop: "4px solid var(--verde)", marginBottom: 0 }}>
            <h3 style={{ color: "var(--verde)" }}>Devuelto a bodega</h3>
            {sobrante.length ? sobrante.map((l, i) => (
              <p key={i} style={{ fontSize: ".9rem" }}>
                {fmt(Math.abs(l.diferencia))} {l.unidad} de {l.nombre.toLowerCase()}
              </p>
            )) : <p className="vacio">Nada por devolver.</p>}
          </div>
          <div className="card" style={{ borderTop: "4px solid var(--amarillo)", marginBottom: 0 }}>
            <h3 style={{ color: "var(--amarillo-tx)" }}>Merma registrada</h3>
            {merma.length ? merma.map((l, i) => (
              <p key={i} style={{ fontSize: ".9rem" }}>
                {fmt(l.diferencia)} {l.unidad} de {l.nombre.toLowerCase()} — con nota del chef
              </p>
            )) : <p className="vacio">Sin merma en este servicio.</p>}
          </div>
          <div className="card" style={{ borderTop: "4px solid var(--azul)", marginBottom: 0 }}>
            <h3 style={{ color: "var(--azul)" }}>Histórico actualizado</h3>
            <p style={{ fontSize: ".9rem" }}>
              Consumo real por porción, para afinar la próxima receta.
            </p>
          </div>
        </div>
        <div className="card">
          <h3>Qué pasa ahora con esta información</h3>
          <div className="registro"><span className="ok">✓</span>
            <span>El archivo de ajuste queda listo para cargarse a My Inventory con los nombres y códigos oficiales.</span></div>
          <div className="registro"><span className="ok">✓</span>
            <span>El consumo real alimenta el histórico: si el plato gasta siempre más de un insumo que lo que dice la receta, el sistema lo detecta.</span></div>
          <div className="registro"><span className="ok">✓</span>
            <span>La merma queda trazada con responsable y hora: la revisión ya no depende de la memoria de nadie.</span></div>
          <div className="grilla-botones">
            <button className="btn" onClick={() => ir && ir("reportes")}>Ver el reporte del servicio</button>
          </div>
        </div>
      </Marco>
    );
  }

  return (
    <Marco titulo={`Legalización  ·  ${comp.plato ? comp.plato.toLowerCase() : "servicio de almuerzo"}`}
           chip={{ texto: "SERVICIO CERRADO", tipo: "" }}>
      <div className="chips">
        <span className="chip">
          {comp.porciones ? `${comp.porciones} porciones servidas` : `${comp.lineas.length} insumos`}
        </span>
        <span className="chip verde">{sobrante.length} sobrantes</span>
        <span className="chip oro">{merma.length} merma{merma.length === 1 ? "" : "s"} por revisar</span>
      </div>

      <p className="pista" style={{ marginBottom: 12 }}>
        Al cerrar el servicio se compara lo pedido con lo realmente usado: cada
        diferencia queda explicada como sobrante o como merma.
      </p>

      <div className="card">
        {comp.lineas.length === 0 ? (
          <p className="vacio">
            No hay líneas de servicio todavía. Genere un pedido en el menú Pedidos.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Insumo</th><th>Pedido</th><th>Usado</th>
                <th>Diferencia</th><th>Qué significa</th>
              </tr>
            </thead>
            <tbody>
              {comp.lineas.map((l) => (
                <tr key={l.codigo}>
                  <td>{l.nombre}</td>
                  <td>{l.pedido}</td>
                  <td>{l.usado}</td>
                  <td className="dif">
                    {l.diferencia > 0 ? `+${l.diferencia}` : l.diferencia}
                  </td>
                  <td>{l.lectura}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {comp.lineas.length > 0 && (
        <div className="card">
          <p className="rotulo">CuentaVoz responde</p>
          <div className="burbuja">{respuesta}</div>
          {err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}
          <div className="grilla-botones">
            <button className="btn verde" onClick={confirmar}>Confirmar legalización</button>
            <button className="btn oro" onClick={() => setVerMerma(true)} disabled={!merma.length}>
              Explicar la merma
            </button>
            <button className="btn borde" onClick={() => setPedirAjuste(true)}>
              Ajustar por voz
            </button>
          </div>
        </div>
      )}

      {pedirAjuste && (
        <Dialogo titulo="Ajustar por voz"
                 mensaje="Diga el insumo y cuánto se usó realmente:"
                 conCampo placeholder="el pollo fueron doce kilos"
                 onAceptar={ajustarPorVoz}
                 onCancelar={() => setPedirAjuste(false)} />
      )}

      {verMerma && (
        <Dialogo titulo="Merma de este servicio"
                 mensaje={merma.length
                   ? merma.map((l) => `${l.nombre}: +${fmt(l.diferencia)} de más que lo pedido — revisar con el chef.`).join("\n")
                   : "No hay merma en este servicio."}
                 textoAceptar="Entendido" textoCancelar="Cerrar"
                 onAceptar={() => setVerMerma(false)}
                 onCancelar={() => setVerMerma(false)} />
      )}
    </Marco>
  );
}
