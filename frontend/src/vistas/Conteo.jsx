import { useState, useEffect, useRef } from "react";
import { enviarTurno, abrirBodega, pedir, descargarReporte } from "../api";
import { escuchar, hablar, vozDisponible } from "../voz";
import Marco from "../Marco";
import Dialogo from "../Dialogo";

const UNIDADES = ["Unidad", "Kilogram", "Liter", "Portion"];
const CLAVE_COLA = (sesionId) => `cv_offline_${sesionId}`;

function leerCola(sesionId) {
  try { return JSON.parse(localStorage.getItem(CLAVE_COLA(sesionId)) || "[]"); }
  catch (_) { return []; }
}
function guardarCola(sesionId, cola) {
  localStorage.setItem(CLAVE_COLA(sesionId), JSON.stringify(cola));
}

export default function Conteo({ token, sesionId = 1, ir }) {
  const [bodega, setBodega] = useState(null);
  const [textoBodega, setTextoBodega] = useState("almacen suministros");
  const [dicho, setDicho] = useState("");
  const [respuesta, setRespuesta] = useState(
    "Abra una bodega para empezar a contar."
  );
  const [opciones, setOpciones] = useState(null);
  const [alerta, setAlerta] = useState(null);
  const [alertaEsperado, setAlertaEsperado] = useState(null);
  const [pendiente, setPendiente] = useState(null);
  const [avance, setAvance] = useState({ hechas: 0, total: 0, alertas: 0, ultimos: [] });
  const [estado, setEstado] = useState("listo");
  const [err, setErr] = useState("");
  const [crear, setCrear] = useState(null);       // {nombre, unidad_medida, cantidad_inicial}
  const [archivo, setArchivo] = useState(null);
  const [mostrarTeclado, setMostrarTeclado] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [cola, setCola] = useState(() => leerCola(sesionId));
  const rec = useRef(null);

  async function refrescar() {
    try {
      setAvance(await pedir(`/api/sesiones/${sesionId}/avance`, {}, token));
    } catch (_) {}
  }
  useEffect(() => { refrescar(); }, []);

  useEffect(() => {
    const alVolver = () => { setOffline(false); sincronizar(); };
    const alPerder = () => setOffline(true);
    window.addEventListener("online", alVolver);
    window.addEventListener("offline", alPerder);
    return () => {
      window.removeEventListener("online", alVolver);
      window.removeEventListener("offline", alPerder);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sesionId, bodega]);

  async function sincronizar() {
    const pendientes = leerCola(sesionId);
    if (!pendientes.length || !bodega) return;
    for (const item of pendientes) {
      try {
        await enviarTurno(`${item.articulo} ${item.cantidad} ${item.unidad}`, sesionId, token);
        await enviarTurno("confirmo", sesionId, token);
      } catch (_) { break; }
    }
    guardarCola(sesionId, []);
    setCola([]);
    refrescar();
  }

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

  function esFalloRed(e) {
    return e instanceof TypeError || /failed to fetch|networkerror/i.test(e.message || "");
  }

  /** Un turno de conversación: el ciclo completo del agente.
      «mostrar» es lo que se ve como «Usted dijo»; «texto» es lo que de
      verdad se le manda al backend. Al tocar una tarjeta de opción se
      manda el código exacto (nunca falla), no el nombre: si un nombre
      está contenido dentro del otro (ARROZ dentro de ARROZ BASMATI), el
      agente no tiene con qué distinguirlos por palabra. */
  async function procesar(texto, mostrar = texto) {
    if (!texto) return;
    setDicho(mostrar);
    setErr("");
    try {
      const t = await enviarTurno(texto, sesionId, token);
      setRespuesta(t.respuesta_hablada || "");
      setOpciones(t.opciones || null);
      setAlerta(t.alerta || null);
      setAlertaEsperado(t.alerta === "desviacion" ? (t.pendiente?.cantidad ?? null) : null);
      setPendiente(t.pendiente || null);
      setArchivo(t.archivo || null);
      hablar(t.respuesta_hablada);
      if (t.guardado || t.corregido || t.bodega) refrescar();
      if (t.bodega) setBodega({ bodega: t.bodega.nombre, referencias: t.bodega.referencias });
      if (t.intencion === "crear") {
        setCrear({ nombre: t.articulo_texto || texto, unidad_medida: "Unidad",
                   cantidad_inicial: t.cantidad || 0 });
      } else {
        setCrear(null);
      }
    } catch (e) {
      if (esFalloRed(e)) {
        setOffline(true);
        setErr("");
      } else {
        setErr(e.message);
      }
    } finally {
      setEstado("listo");
    }
  }

  function recontar() {
    setAlerta(null);
    setAlertaEsperado(null);
    setPendiente(null);
    setDicho("");
    const msg = "¿La contamos otra vez? Dígame el nuevo valor.";
    setRespuesta(msg);
    hablar(msg);
  }

  async function crearPendiente() {
    setErr("");
    try {
      const r = await pedir("/api/conteo/crear-producto", {
        method: "POST",
        body: JSON.stringify({ ...crear, sesion_id: sesionId }),
      }, token);
      setRespuesta(r.respuesta_hablada);
      hablar(r.respuesta_hablada);
      setCrear(null);
      setAlerta(null);
      refrescar();
    } catch (e) {
      setErr(e.message);
    }
  }

  function guardarEnCola(item) {
    const nueva = [...leerCola(sesionId), item];
    guardarCola(sesionId, nueva);
    setCola(nueva);
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
      chip={offline ? { texto: "SIN CONEXIÓN", tipo: "oro" }
           : bodega ? { texto: "EN CONTEO", tipo: "azul" }
           : { texto: "SIN BODEGA", tipo: "gris" }}
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
      ) : offline ? (
        <FormularioOffline
          cola={cola}
          onGuardar={guardarEnCola}
          onReintentar={() => { setOffline(!navigator.onLine); if (navigator.onLine) sincronizar(); }}
        />
      ) : (
        <>
          <div className="chips">
            <span className="chip">Avance: {avance.hechas} de {avance.total}</span>
            <span className={`chip ${avance.alertas ? "oro" : "verde"}`}>
              Alertas: {avance.alertas}
            </span>
            <span className="chip gris">Sesión bloqueada</span>
            {cola.length > 0 && (
              <span className="chip oro">{cola.length} por sincronizar</span>
            )}
          </div>

          {alerta && !crear && (
            <div className="banner">
              <span className="ico">!</span>
              <span style={{ flex: 1 }}>
                <b>
                  {alerta === "desviacion" ? "Cantidad fuera de lo esperado"
                    : alerta === "negativo" ? "Cantidad imposible"
                    : alerta === "unidad" ? "Unidad de medida distinta"
                    : "Artículo fuera del catálogo"}
                </b>
                <span>{respuesta}</span>
                {alerta === "desviacion" && (
                  <div className="grilla-botones" style={{ marginTop: 10 }}>
                    <button className="btn" onClick={recontar}>Recontar</button>
                    <button className="btn oro" onClick={() => procesar("confirmo")}>
                      Confirmar {alertaEsperado != null ? alertaEsperado : ""}
                    </button>
                  </div>
                )}
              </span>
            </div>
          )}

          {crear && (
            <FormularioCrearProducto
              crear={crear} setCrear={setCrear}
              onCrear={crearPendiente} onCancelar={() => setCrear(null)}
              bodega={bodega.bodega} err={err}
            />
          )}

          {!crear && (
            <div className="conteo-cols">
              <div className="card">
                <p className="rotulo">
                  {dicho ? `Usted dijo: «${dicho}»` : "CuentaVoz responde"}
                </p>
                <div className="burbuja">{respuesta}</div>
                {archivo && (
                  <div className="grilla-botones" style={{ marginTop: 10 }}>
                    <button className="btn verde"
                            onClick={() => descargarReporte(archivo, token).catch((e) => setErr(e.message))}>
                      Descargar archivo generado
                    </button>
                  </div>
                )}

                {opciones && (
                  <div className="opciones" style={{ marginTop: 14 }}>
                    {opciones.map((o, i) => (
                      <button key={o.codigo} className="opcion"
                              onClick={() => procesar(o.codigo, o.nombre)}>
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
          )}

          {!crear && (
            <div className="grilla-botones">
              <button className="btn verde" onClick={() => procesar("confirmo")}>
                Confirmar
              </button>
              <button className="btn borde" onClick={() => procesar("corregir")}>
                Corregir
              </button>
              <button className="btn gris" onClick={() => setMostrarTeclado(true)}>
                Teclado
              </button>
              <button className="btn oro" onClick={() => ir("ayuda")}>
                Pedir ayuda
              </button>
            </div>
          )}
          <p className="pista" style={{ marginTop: 10 }}>
            La voz es el camino rápido; el teclado siempre queda como respaldo.
          </p>
        </>
      )}

      {mostrarTeclado && (
        <Dialogo titulo="Escribir en vez de hablar"
                 mensaje="Escriba lo que diría en voz alta:"
                 conCampo placeholder="tres tablas para picar blancas"
                 onAceptar={(t) => { setMostrarTeclado(false); if (t) procesar(t); }}
                 onCancelar={() => setMostrarTeclado(false)} />
      )}
    </Marco>
  );
}

function FormularioCrearProducto({ crear, setCrear, onCrear, onCancelar, bodega, err }) {
  return (
    <div className="card">
      <p className="rotulo">CuentaVoz responde</p>
      <div className="burbuja">
        No encontré «{crear.nombre}» en el catálogo. Lo creamos y queda pendiente
        del administrador.
      </div>
      <div style={{ marginTop: 16 }}>
        <label className="pista">Nombre tal como lo dictó</label>
        <input value={crear.nombre}
               onChange={(e) => setCrear({ ...crear, nombre: e.target.value })}
               style={{ width: "100%", padding: "11px 13px", marginBottom: 12,
                        border: "1px solid var(--borde)", borderRadius: 12,
                        textTransform: "uppercase" }} />

        <label className="pista">Unidad de medida</label>
        <div className="grilla-botones" style={{ marginTop: 6, marginBottom: 12 }}>
          {UNIDADES.map((u) => (
            <button key={u}
                    className={`btn ${crear.unidad_medida === u ? "" : "borde"}`}
                    onClick={() => setCrear({ ...crear, unidad_medida: u })}>
              {u}
            </button>
          ))}
        </div>

        <label className="pista">Cantidad inicial contada en {bodega}</label>
        <input type="number" min="0" value={crear.cantidad_inicial}
               onChange={(e) => setCrear({ ...crear, cantidad_inicial: Number(e.target.value) })}
               style={{ width: 160, padding: "11px 13px",
                        border: "1px solid var(--borde)", borderRadius: 12 }} />
      </div>
      {err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}
      <div className="grilla-botones">
        <button className="btn" onClick={onCrear}>Crear pendiente</button>
        <button className="btn gris" onClick={onCancelar}>Cancelar</button>
      </div>
      <p className="pista" style={{ marginTop: 10 }}>
        No entra al catálogo oficial hasta la firma del administrador de bodega.
        El conteo continúa sin interrupción: la aprobación ocurre en paralelo.
      </p>
    </div>
  );
}

function FormularioOffline({ cola, onGuardar, onReintentar }) {
  const [articulo, setArticulo] = useState("");
  const [cantidad, setCantidad] = useState(1);
  const [unidad, setUnidad] = useState("Unidad");

  function guardar() {
    if (!articulo.trim()) return;
    onGuardar({ articulo: articulo.trim(), cantidad: Number(cantidad), unidad });
    setArticulo("");
    setCantidad(1);
  }

  return (
    <div className="conteo-cols">
      <div className="card">
        <div className="banner">
          <span className="ico">!</span>
          <span>
            <b>El asistente no responde en este momento</b>
            <span>Modo formulario activo: lo que registre se guarda en el equipo
                  y se sincroniza al volver la señal.</span>
          </span>
        </div>
        <label className="pista">Artículo</label>
        <input value={articulo} onChange={(e) => setArticulo(e.target.value)}
               placeholder="tabla acril…"
               style={{ width: "100%", padding: "11px 13px", marginBottom: 12,
                        border: "1px solid var(--borde)", borderRadius: 12 }} />
        <label className="pista">Cantidad</label>
        <div style={{ display: "flex", gap: 10, marginBottom: 4 }}>
          <input type="number" value={cantidad}
                 onChange={(e) => setCantidad(e.target.value)}
                 style={{ width: 100, padding: "11px 13px",
                          border: "1px solid var(--borde)", borderRadius: 12 }} />
          {UNIDADES.map((u) => (
            <button key={u} className={`chip ${unidad === u ? "azul" : ""}`}
                    onClick={() => setUnidad(u)}>{u}</button>
          ))}
        </div>
        <div className="grilla-botones">
          <button className="btn" onClick={guardar}>Guardar</button>
          <button className="btn borde" onClick={onReintentar}>Reintentar la voz</button>
        </div>
      </div>

      <div className="card">
        <h3>Guardados en este equipo</h3>
        {cola.length === 0 ? (
          <p className="vacio">Nada por sincronizar todavía.</p>
        ) : (
          cola.map((c, i) => (
            <div className="registro" key={i}>
              <span>{c.articulo}</span>
              <span className="cant">{c.cantidad} {c.unidad}</span>
            </div>
          ))
        )}
        {cola.length > 0 && (
          <span className="chip oro">{cola.length} registros por sincronizar</span>
        )}
        <p className="pista" style={{ marginTop: 10 }}>
          Al volver la señal, la cola se envía sola a la API y las validaciones
          se aplican igual que en línea.
        </p>
      </div>
    </div>
  );
}
