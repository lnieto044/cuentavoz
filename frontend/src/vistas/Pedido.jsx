import { useState, useEffect } from "react";
import { pedir, enviarTurno, descargarReporte } from "../api";
import { escuchar, hablar } from "../voz";
import Marco from "../Marco";
import Dialogo from "../Dialogo";

const DIA = new Date().toLocaleDateString("es-CO", { weekday: "long" });
const AFIRMACIONES = ["confirmo", "confirmar", "si", "sí", "claro", "listo", "dale", "correcto"];

export default function Pedido({ token, usuario }) {
  // Pedidos tiene su propia conversación con el agente, aislada de la del
  // conteo físico: usa un numero de sesion negativo (unico por persona) para
  // que nunca choque con una sesion real de bodega (esas siempre son >= 1).
  const sesionId = -1000 - (usuario?.id || 0);
  // Vacío hasta que de verdad se dicte algo: mostrar «ajiaco/50» desde el
  // arranque hacía parecer que ya se había entendido un pedido que nadie
  // dictó todavía, y esos datos no cambiaban con nada más que se dijera.
  const [plato, setPlato] = useState("");
  const [porciones, setPorciones] = useState(null);
  const [dicho, setDicho] = useState("");
  const [lineas, setLineas] = useState(null);
  const [receta, setReceta] = useState(null);
  const [enviado, setEnviado] = useState(false);
  const [respuesta, setRespuesta] = useState(
    "Diga el plato y las porciones: «hoy preparamos cincuenta ajiacos»."
  );
  const [estado, setEstado] = useState("listo");
  const [err, setErr] = useState("");
  const [archivo, setArchivo] = useState(null);
  const [pedirPorciones, setPedirPorciones] = useState(false);
  const [avisos, setAvisos] = useState(null);
  const [opciones, setOpciones] = useState(null);
  const [opcionesPara, setOpcionesPara] = useState(null);
  const [productoConsultado, setProductoConsultado] = useState(null);
  const [bodegas, setBodegas] = useState([]);
  const [bodegaId, setBodegaId] = useState(null);

  // Con qué bodega se descuenta el pedido: por defecto el almacén de
  // Alimentos y Bebidas (donde de verdad están los ingredientes de cocina),
  // no una bodega al azar - antes quedaba fijo en la primera de la lista
  // (una oficina administrativa sin ningún stock) y todo salía en cero.
  useEffect(() => {
    pedir("/api/bodegas", {}, token).then((bs) => {
      setBodegas(bs);
      const conStock = bs.find((b) => /ALMACEN\s*AYB/i.test(b.bodega))
        || bs.find((b) => b.referencias > 0) || bs[0];
      if (conStock) setBodegaId(conStock.id);
    }).catch(() => {});
  }, [token]);

  async function verReceta() {
    setErr("");
    if (!plato) {
      const msg = "Primero dígame qué va a preparar.";
      setRespuesta(msg);
      hablar(msg);
      return;
    }
    try {
      const r = await pedir(`/api/pedidos/receta?plato=${encodeURIComponent(plato)}`, {}, token);
      if (!r.lineas) {
        setErr(`No encontré una receta para «${plato}». Pruebe con ajiaco o sancocho.`);
        return;
      }
      setReceta(r);
      if (r.faltantes_catalogo?.length) {
        setAvisos({ faltantes: r.faltantes_catalogo, sinRegistro: [] });
      }
    } catch (e) {
      setErr(e.message);
    }
  }

  /** La frase del chef la interpreta el agente. «mostrar» es lo que se ve
      como «lo que dijo el chef»; «texto» es lo que de verdad se manda al
      backend. Al tocar una tarjeta de opción se manda el código exacto,
      nunca el nombre: si un nombre está contenido en el otro (ARROZ
      dentro de ARROZ BASMATI), el agente no tiene con qué distinguirlos. */
  async function dictar(texto, mostrar = texto) {
    setErr("");
    setDicho(`«${mostrar}»`);
    setEstado("listo");

    // «confirmo» aqui no es del conteo fisico: es seguir con el pedido.
    const palabras = texto.toLowerCase().replace(/[.,!¿?]/g, "").split(/\s+/);
    if (palabras.some((p) => AFIRMACIONES.includes(p))) {
      if (lineas && !enviado) return enviar();
      if (!lineas) return calcular();
      const msg = "Este pedido ya se envió al almacén.";
      setRespuesta(msg);
      hablar(msg);
      return;
    }

    try {
      const t = await enviarTurno(texto, sesionId, token, { opciones, opcionesPara });
      // un plato nuevo es un tema distinto: la última consulta de producto
      // ya no aplica y solo estorbaría junto al pedido que se está armando.
      if (t.preparacion && t.porciones) setProductoConsultado(null);
      if (t.preparacion) setPlato(t.preparacion);
      if (t.porciones) setPorciones(t.porciones);
      setRespuesta(t.respuesta_hablada || "");
      setArchivo(t.archivo || null);
      setOpciones(t.opciones || null);
      setOpcionesPara(t.opciones_para || null);
      if (t.producto_consultado) setProductoConsultado(t.producto_consultado);
      hablar(t.respuesta_hablada);
    } catch (e) {
      setErr(e.message);
    }
  }

  function corregirCantidad() {
    setPedirPorciones(true);
  }

  function confirmarPorciones(v) {
    setPedirPorciones(false);
    if (v && !isNaN(Number(v))) {
      setPorciones(Number(v));
      setLineas(null);
    }
  }

  /** El backend explota la receta y descuenta el stock. */
  async function calcular() {
    setErr("");
    if (!plato || !porciones) {
      const msg = "Primero dígame qué va a preparar y para cuántas porciones.";
      setRespuesta(msg);
      hablar(msg);
      return;
    }
    setEnviado(false);
    setAvisos(null);
    try {
      const r = await pedir("/api/pedidos/calcular", {
        method: "POST",
        body: JSON.stringify({ plato, porciones: Number(porciones), bodega_id: bodegaId }),
      }, token);
      if (!r.receta_encontrada) {
        setErr(`No encontré una receta para «${plato}». Pruebe con ajiaco o sancocho.`);
        return;
      }
      setLineas(r.lineas);
      if (r.faltantes_catalogo?.length || r.sin_registro_bodega?.length) {
        setAvisos({ faltantes: r.faltantes_catalogo, sinRegistro: r.sin_registro_bodega });
      }
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
        body: JSON.stringify({ lineas, servicio_id: 1, plato, porciones }),
      }, token);
      const msg = "Pedido enviado al almacén.";
      setRespuesta(msg);
      hablar(msg);
      setEnviado(true);
    } catch (e) {
      setErr(e.message);
    }
  }

  const porPedir = lineas ? lineas.filter((l) => l.falta > 0).length : 0;

  return (
    <Marco titulo="Pedidos  ·  Cocina Piscilago"
           chip={{ texto: "SERVICIO ALMUERZO", tipo: "" }}>
      <div className="chips">
        <span className="chip">{DIA[0].toUpperCase() + DIA.slice(1)} · almuerzo</span>
        <span className="chip">Cocina Piscilago</span>
        <span className={`chip ${enviado ? "verde" : "oro"}`}>
          {enviado ? "Pedido enviado" : "Pedido sin enviar"}
        </span>
        {bodegas.length > 0 && (
          <select value={bodegaId || ""}
                  onChange={(e) => { setBodegaId(Number(e.target.value)); setLineas(null); }}
                  style={{ marginLeft: "auto", padding: "6px 12px", border: "1px solid var(--borde)",
                           borderRadius: 20, fontSize: ".8rem", fontWeight: 700, color: "var(--azul)" }}>
            {bodegas.map((b) => (
              <option key={b.id} value={b.id}>Se descuenta de: {b.bodega}</option>
            ))}
          </select>
        )}
      </div>

      <div className="conteo-cols">
        <div className="card">
          <h3>Lo que dijo el chef</h3>
          <p className="cita">
            {dicho || "Aún no ha dictado nada: pulse el micrófono y diga, por "
                      + "ejemplo, «hoy preparamos cincuenta ajiacos»."}
          </p>

          <h3 style={{ marginTop: 18 }}>Lo que entendió CuentaVoz</h3>
          {(productoConsultado || (plato && porciones)) ? (
            <table>
              <tbody>
                {productoConsultado && (
                  <>
                    <tr><td>Último producto consultado</td><td><b style={{ color: "var(--azul)" }}>
                      {productoConsultado.nombre}</b></td></tr>
                    <tr><td>Código · unidad</td><td><b style={{ color: "var(--azul)" }}>
                      {productoConsultado.codigo} · {productoConsultado.unidad}</b></td></tr>
                  </>
                )}
                {plato && porciones && (
                  <>
                    <tr><td>Preparación</td><td><b style={{ color: "var(--azul)" }}>
                      {plato.toUpperCase()}</b></td></tr>
                    <tr><td>Porciones</td><td><b style={{ color: "var(--azul)" }}>
                      {porciones}</b></td></tr>
                    <tr><td>Receta aplicada</td><td><b style={{ color: "var(--azul)" }}>
                      estándar de Colsubsidio</b></td></tr>
                    <tr><td>Momento</td><td><b style={{ color: "var(--azul)" }}>
                      pedido al almacén</b></td></tr>
                  </>
                )}
              </tbody>
            </table>
          ) : (
            <p className="vacio">Todavía no hay ningún plato dictado en esta conversación.</p>
          )}
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
          <b>{estado === "escuchando" ? "Escuchando…" : "Mantenga presionado y hable"}</b>
          <small>También sirve: «pedir insumos para 30 sancochos»</small>
          <small style={{ color: "var(--verde)", fontWeight: 700 }}>
            Receta + stock = pedido
          </small>
        </div>
      </div>

      <div className="card">
        <p className="rotulo">CuentaVoz responde</p>
        <div className="burbuja">{respuesta}</div>
        {opciones && (
          <div className="opciones" style={{ marginTop: 14 }}>
            {opciones.map((o, i) => (
              <button key={o.codigo} className="opcion" onClick={() => dictar(o.codigo, o.nombre)}>
                <span className="n">Opción {i + 1}</span>
                <h4>{o.nombre}</h4>
                <p>Código {o.codigo}</p>
                <p>{o.unidad}</p>
              </button>
            ))}
          </div>
        )}
        {archivo && (
          <div className="grilla-botones" style={{ marginTop: 10 }}>
            <button className="btn verde"
                    onClick={() => descargarReporte(archivo, token).catch((e) => setErr(e.message))}>
              Descargar archivo generado
            </button>
          </div>
        )}
        {err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}
        <div className="grilla-botones">
          <button className="btn" onClick={calcular}>Calcular el pedido</button>
          <button className="btn borde" onClick={corregirCantidad}>Corregir cantidad</button>
          <button className="btn oro" onClick={verReceta}>Ver la receta</button>
        </div>
      </div>

      {avisos && (avisos.faltantes.length > 0 || avisos.sinRegistro.length > 0) && (
        <div className="banner">
          <span className="ico">!</span>
          <span>
            <b>Revise antes de enviar</b>
            {avisos.faltantes.length > 0 && (
              <span>
                No encontré en el catálogo: <b>{avisos.faltantes.join(", ")}</b> — esos
                ingredientes de la receta no se pudieron calcular. Avise al administrador.
                <br />
              </span>
            )}
            {avisos.sinRegistro.length > 0 && (
              <span>
                Esta bodega nunca ha tenido registro de: <b>{avisos.sinRegistro.join(", ")}</b> —
                se asumió 0 disponible; confirme con el almacén antes de descontar existencias.
              </span>
            )}
          </span>
        </div>
      )}

      {receta && (
        <div className="card">
          <div className="chips">
            <span className="chip">{receta.nombre}</span>
            <span className="chip">Rendimiento: {receta.rendimiento} porción</span>
            <span className="chip">{receta.lineas.length} ingredientes</span>
            <span className="chip gris">SOLO CONSULTA</span>
          </div>
          <h3>Catálogo de Colsubsidio</h3>
          <table>
            <thead>
              <tr><th>Ingrediente</th><th>Unidad</th><th>Por porción</th>
                  <th>Para {porciones} porciones</th></tr>
            </thead>
            <tbody>
              {receta.lineas.map((l) => (
                <tr key={l.codigo}>
                  <td>{l.nombre}</td><td>{l.unidad}</td><td>{l.por_porcion}</td>
                  <td className="dif">{Math.round(l.por_porcion * porciones * 1000) / 1000}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pista" style={{ marginTop: 10 }}>
            El prototipo consulta las recetas, no las gestiona: crear o modificar
            recetas y menús está fuera del alcance del reto — eso lo resuelve el
            sistema de Colsubsidio. CuentaVoz las lee para calcular pedidos y, en
            la legalización, para comparar lo previsto contra lo consumido.
          </p>
          <div className="grilla-botones">
            <button className="btn" onClick={() => { setReceta(null); calcular(); }}>
              Usar para un pedido
            </button>
            <button className="btn gris" onClick={() => setReceta(null)}>Cerrar</button>
          </div>
        </div>
      )}

      {lineas && (
        <>
          <div className="kpis">
            <div className="kpi">
              <div className="kpi-cabeza">
                <span className="icono-kpi">🧾</span>
                <small>Insumos de la receta</small>
              </div>
              <b>{lineas.length}</b>
              <i>ingredientes estándar</i>
            </div>
            <div className="kpi verde">
              <div className="kpi-cabeza">
                <span className="icono-kpi">✅</span>
                <small>Ya disponibles en bodega</small>
              </div>
              <b>{lineas.length - porPedir}</b><i>no se piden</i>
            </div>
            <div className="kpi oro">
              <div className="kpi-cabeza">
                <span className="icono-kpi">🛒</span>
                <small>Hay que pedir al almacén</small>
              </div>
              <b>{porPedir}</b>
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
            {!enviado && (
              <div className="grilla-botones">
                <button className="btn verde" onClick={enviar}>
                  Enviar pedido al almacén
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {pedirPorciones && (
        <Dialogo titulo="Corregir cantidad"
                 mensaje="¿Cuántas porciones son en realidad?"
                 conCampo tipo="number" valorInicial={porciones}
                 onAceptar={confirmarPorciones}
                 onCancelar={() => setPedirPorciones(false)} />
      )}
    </Marco>
  );
}
