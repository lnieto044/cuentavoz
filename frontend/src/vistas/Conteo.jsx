import { useState, useEffect, useRef } from "react";
import { enviarTurno, abrirBodega, pedir } from "../api";
import { escuchar, hablar, vozDisponible } from "../voz";
import Marco from "../Marco";

export default function Conteo({ token, sesionId = 1, ir }) {
  const [bodega, setBodega] = useState(null);
  const [textoBodega, setTextoBodega] = useState("almacen suministros");
  const [dicho, setDicho] = useState("");
  const [respuesta, setRespuesta] = useState(
    "Abra una bodega para empezar a contar."
  );
  const [opciones, setOpciones] = useState(null);
  const [alerta, setAlerta] = useState(null);
  const [pendiente, setPendiente] = useState(null);
  const [avance, setAvance] = useState({ hechas: 0, total: 0, alertas: 0, ultimos: [] });
  const [estado, setEstado] = useState("listo");
  const [err, setErr] = useState("");
  const rec = useRef(null);

  async function refrescar() {
    try {
      setAvance(await pedir(`/api/sesiones/${sesionId}/avance`, {}, token));
    } catch (_) {}
  }
  useEffect(() => { refrescar(); }, []);

  async function abrir() {
    setErr("");
    try {
      const r = await abrirBodega(textoBodega, token);
      setBodega(r);
      const saludo = `Listo, ${r.bodega.toLowerCase()} abierta con ${r.referencias} referencias. Dícteme el primer producto.`;
      setRespuesta(saludo);
      hablar(saludo);
      refrescar();
    } catch (e) {
      setErr(e.message);
    }
  }

  /** Un turno de conversación: el ciclo completo del agente. */
  async function procesar(texto) {
    if (!texto) return;
    setDicho(texto);
    setErr("");
    try {
      const t = await enviarTurno(texto, sesionId, token);
      setRespuesta(t.respuesta_hablada || "");
      setOpciones(t.opciones || null);
      setAlerta(t.alerta || null);
      setPendiente(t.pendiente || null);
      hablar(t.respuesta_hablada);
      if (t.guardado || t.corregido || t.bodega) refrescar();
      if (t.bodega) setBodega({ bodega: t.bodega.nombre, referencias: t.bodega.referencias });
      if (t.intencion === "crear") setTimeout(() => setAlerta("inexistente"), 50);
    } catch (e) {
      setErr(e.message);
    } finally {
      setEstado("listo");
    }
  }

  function alMicrofono() {
    if (estado === "escuchando") {
      rec.current?.stop();
      return;
    }
    rec.current = escuchar({
      alTexto: procesar,
      alEstado: (e, parcial) => {
        setEstado(e);
        if (parcial) setDicho(parcial);
      },
      alError: setErr,
    });
  }

  return (
    <Marco
      titulo={`Conteo por voz${bodega ? "  ·  " + bodega.bodega : ""}`}
      chip={bodega ? { texto: "EN CONTEO", tipo: "azul" } : { texto: "SIN BODEGA", tipo: "gris" }}
    >
      {!bodega ? (
        <div className="card">
          <h3>¿Qué bodega va a contar?</h3>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              style={{ flex: 1, minWidth: 240, padding: "12px 14px",
                       border: "1px solid var(--borde)", borderRadius: 12 }}
              value={textoBodega}
              onChange={(e) => setTextoBodega(e.target.value)}
              placeholder="almacen suministros"
            />
            <button className="btn" onClick={abrir}>Abrir bodega</button>
          </div>
          {err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}
          <p className="pista" style={{ marginTop: 10 }}>
            Sugerencias: almacen suministros · almacen ayb · restaurante fuentes ayb
          </p>
        </div>
      ) : (
        <>
          <div className="chips">
            <span className="chip">Avance: {avance.hechas} de {avance.total}</span>
            <span className={`chip ${avance.alertas ? "oro" : "verde"}`}>
              Alertas: {avance.alertas}
            </span>
            <span className="chip gris">Sesión bloqueada</span>
          </div>

          {alerta && (
            <div className="banner">
              <span className="ico">!</span>
              <span>
                <b>
                  {alerta === "desviacion" ? "Cantidad fuera de lo esperado"
                    : alerta === "negativo" ? "Cantidad imposible"
                    : alerta === "unidad" ? "Unidad de medida distinta"
                    : "Artículo fuera del catálogo"}
                </b>
                <span>{respuesta}</span>
              </span>
            </div>
          )}

          <div className="conteo-cols">
            <div className="card">
              <p className="rotulo">
                {dicho ? `Usted dijo: «${dicho}»` : "CuentaVoz responde"}
              </p>
              <div className="burbuja">{respuesta}</div>

              {opciones && (
                <div className="opciones" style={{ marginTop: 14 }}>
                  {opciones.map((o, i) => (
                    <button key={o.codigo} className="opcion"
                            onClick={() => procesar(o.nombre)}>
                      <span className="n">Opción {i + 1}</span>
                      <h4>{o.nombre}</h4>
                      <p>Código {o.codigo}</p>
                      <p>{o.unidad}</p>
                    </button>
                  ))}
                </div>
              )}

              {pendiente && !opciones && (
                <p className="pista" style={{ marginTop: 12 }}>
                  Por confirmar: <b>{pendiente.nombre}</b> — {pendiente.cantidad}{" "}
                  {pendiente.unidad}
                </p>
              )}

              <h3 style={{ marginTop: 18 }}>Últimos registros confirmados</h3>
              {avance.ultimos?.length ? (
                avance.ultimos.map((u, i) => (
                  <div className="registro" key={i}>
                    <span className="ok">✓</span>
                    <span>{u.nombre}</span>
                    <span className="cant">{u.cantidad} {u.unidad}</span>
                  </div>
                ))
              ) : (
                <p className="vacio">Todavía no hay registros en esta sesión.</p>
              )}
            </div>

            <div className="card mic-caja">
              <button
                className={`mic-btn ${estado === "escuchando" ? "escuchando" : ""}`}
                onClick={alMicrofono}
              >
                🎤
              </button>
              <b>
                {estado === "escuchando" ? "Escuchando…"
                  : estado === "procesando" ? "Procesando…"
                  : "Toque y hable"}
              </b>
              <small>
                {vozDisponible()
                  ? "Reconocimiento en español (Colombia)"
                  : "Este navegador no reconoce voz: use el teclado"}
              </small>
              {err && <p className="error">{err}</p>}
            </div>
          </div>

          <div className="grilla-botones">
            <button className="btn verde" onClick={() => procesar("confirmo")}>
              Confirmar
            </button>
            <button className="btn borde" onClick={() => procesar("corregir")}>
              Corregir
            </button>
            <button className="btn gris" onClick={() => {
              const t = window.prompt("Escriba lo que diría en voz alta:");
              if (t) procesar(t);
            }}>
              Teclado
            </button>
            <button className="btn oro" onClick={() => ir("ayuda")}>
              Pedir ayuda
            </button>
          </div>
          <p className="pista" style={{ marginTop: 10 }}>
            La voz es el camino rápido; el teclado siempre queda como respaldo.
          </p>
        </>
      )}
    </Marco>
  );
}
