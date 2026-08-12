import { useState, useEffect, useRef } from "react";
import { enviarTurno, abrirBodega, buscarBodega, pedir, descargarReporte, esFalloRed } from "../api";
import { escuchar, hablar, vozDisponible } from "../voz";
import { interpretarLocal } from "../interpreteLocal";
import Marco from "../Marco";
import Dialogo from "../Dialogo";

const UNIDADES = ["Unidad", "Kilogram", "Liter", "Portion"];
const CLAVE_COLA = (sesionId) => `cv_offline_${sesionId}`;
const CLAVE_CATALOGO = "cv_catalogo_ligero";

function leerCola(sesionId) {
  try { return JSON.parse(localStorage.getItem(CLAVE_COLA(sesionId)) || "[]"); }
  catch (_) { return []; }
}
function guardarCola(sesionId, cola) {
  localStorage.setItem(CLAVE_COLA(sesionId), JSON.stringify(cola));
}

function leerCatalogo() {
  try { return JSON.parse(localStorage.getItem(CLAVE_CATALOGO) || "[]"); }
  catch (_) { return []; }
}
function guardarCatalogo(lista) {
  try { localStorage.setItem(CLAVE_CATALOGO, JSON.stringify(lista)); } catch (_) {}
}
function normalizarLocal(t) {
  return (t || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}
/** Sugerencia sin internet: coincidencia de palabras contra el catálogo
    que ya se guardó en el equipo mientras había señal. */
function sugerirDeCatalogo(texto, catalogo) {
  const q = normalizarLocal(texto);
  const palabras = q.split(/\s+/).filter((p) => p.length >= 3);
  if (!palabras.length || !catalogo.length) return null;
  let mejor = null, mejorPuntaje = 0;
  for (const a of catalogo) {
    const nombre = normalizarLocal(a.nombre);
    const aciertos = palabras.filter((p) => nombre.includes(p)).length;
    const puntaje = aciertos / palabras.length;
    if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = a; }
  }
  return mejorPuntaje >= 0.5 ? mejor : null;
}

const ETIQUETA_BODEGA = {
  pendiente: ["PENDIENTE", "gris"], en_conteo: ["EN CONTEO", "azul"],
  en_auditoria: ["EN AUDITORÍA", "oro"], cerrada: ["CERRADA", "verde"],
};

export default function Conteo({ token, sesionId = 1, ir, usuario, bodegaSugerida }) {
  const [bodega, setBodega] = useState(null);
  const [asignadas, setAsignadas] = useState(null);
  const [todas, setTodas] = useState(null);
  // Llega desde Bodegas cuando alguien buscó por voz/texto el nombre de
  // una bodega en el buscador de INGREDIENTES (no encontró artículo, pero
  // el nombre sí es una bodega real) - deja el nombre ya listo para
  // confirmar con "Abrir por nombre exacto" en vez de tener que dictarlo
  // otra vez desde cero.
  const [textoBodega, setTextoBodega] = useState(bodegaSugerida || "");
  const [buscarOtra, setBuscarOtra] = useState(false);
  const [bodegaNoEncontrada, setBodegaNoEncontrada] = useState(null);
  const [opcionesBodega, setOpcionesBodega] = useState(null);
  const [msgBodega, setMsgBodega] = useState("");
  const [dicho, setDicho] = useState("");
  const [respuesta, setRespuesta] = useState(
    "Abra una bodega para empezar a contar."
  );
  const [opciones, setOpciones] = useState(null);
  const [opcionesPara, setOpcionesPara] = useState(null);
  const [alerta, setAlerta] = useState(null);
  const [alertaEsperado, setAlertaEsperado] = useState(null);
  const [contextoAlerta, setContextoAlerta] = useState(null);
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
  // Cada vez que se abre un micrófono para el flujo de bodega (nombre
  // dictado, "¿cuál de todas?", "¿confirma?") sube en 1: el reconocedor
  // anterior a veces tarda en apagarse del todo y llega a entregar un
  // resultado extra y tardío (p. ej. recoger también el "confirmo" de la
  // pregunta siguiente). Cada escucha guarda SU número; si para cuando
  // responde ya no es el número vigente, se descarta sin hacer nada -
  // así lo tardío nunca se confunde con una bodega nueva ni con una
  // respuesta a la pregunta equivocada.
  const idEscuchaBodega = useRef(0);

  // guarda el catalogo liviano en el equipo mientras hay señal, para que
  // el modo sin conexión pueda seguir sugiriendo nombres oficiales.
  useEffect(() => {
    if (navigator.onLine && token) {
      pedir("/api/articulos/catalogo-ligero", {}, token).then(guardarCatalogo).catch(() => {});
    }
  }, [token]);

  async function refrescar() {
    try {
      const bid = bodega?.bodega_id ? `?bodega_id_respaldo=${bodega.bodega_id}` : "";
      setAvance(await pedir(`/api/sesiones/${sesionId}/avance${bid}`, {}, token));
    } catch (_) {}
  }
  useEffect(() => {
    refrescar();
    // si quedaron registros sin sincronizar de una sesión anterior (se
    // cerró la pestaña, o se recargó ya con señal) y ahora sí hay
    // conexión, se reintenta al entrar en vez de esperar a que el
    // navegador dispare otro evento "online" que quizás no vuelva a pasar.
    if (navigator.onLine) sincronizar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodega]);

  useEffect(() => {
    pedir("/api/usuarios/yo/bodegas", {}, token).then((r) => {
      setAsignadas(r);
      // sin bodegas propias (el caso tipico del administrador, que audita
      // en vez de contar rutinariamente) se necesita el listado completo
      // de una vez - si no, la unica opcion es escribir el nombre a mano.
      if (r.length === 0) cargarTodas();
    }).catch(() => setAsignadas([]));
  }, [token]);

  function cargarTodas() {
    pedir("/api/bodegas", {}, token).then(setTodas).catch(() => setTodas([]));
  }

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
    const restantes = leerCola(sesionId);
    if (!restantes.length || !bodega) return;
    // solo se quita de la cola lo que de verdad se confirmó: si un item
    // falla (o vuelve a caerse la red a mitad de la sincronización), el
    // resto queda guardado para el próximo intento en vez de perderse -
    // antes, cualquier falla borraba TODA la cola sin distinguir qué
    // alcanzó a guardarse.
    while (restantes.length) {
      const item = restantes[0];
      try {
        await enviarTurno(`${item.articulo} ${item.cantidad} ${item.unidad}`, sesionId, token);
        await enviarTurno("confirmo", sesionId, token);
      } catch (_) {
        break;
      }
      restantes.shift();
      guardarCola(sesionId, restantes);
      setCola([...restantes]);
    }
    refrescar();
  }

  async function abrir(nombre = textoBodega) {
    setErr("");
    setBodegaNoEncontrada(null);
    setOpcionesBodega(null);
    try {
      const r = await abrirBodega(nombre, token);
      setBodega(r);
      const saludo = `Listo, ${r.bodega.toLowerCase()} abierta con ${r.referencias} referencias. Dícteme el primer producto.`;
      setRespuesta(saludo);
      hablar(saludo);
      refrescar();
    } catch (e) {
      setErr(e.message);
      // igual que un articulo que no esta en el catalogo (ver
      // FormularioCrearProducto): en vez de dejar a la persona sin salida,
      // se ofrece pedir la bodega nueva - queda pendiente de aprobacion.
      if (e.message === "No encuentro esa bodega." && nombre.trim()) {
        setBodegaNoEncontrada(nombre.trim());
      }
    }
  }

  /** El botón "Abrir por nombre exacto" (y Enter en el campo) escribía
      directo a abrir(), que con un nombre ambiguo ("restaurante" a
      secas, cuando hay cinco "RESTAURANTE ...") solo sabía decir "no la
      encuentro" y ofrecer crear una bodega duplicada - nunca mostraba
      las que sí existían. Esto resuelve primero, igual que la voz. */
  async function abrirPorBoton() {
    if (!textoBodega.trim()) return;
    setErr("");
    setBodegaNoEncontrada(null);
    setOpcionesBodega(null);
    let resuelto;
    try {
      resuelto = await buscarBodega(textoBodega, token);
    } catch (e) {
      setErr(e.message);
      return;
    }
    if (resuelto.encontrada) {
      abrir(resuelto.bodega);
      return;
    }
    if (resuelto.opciones?.length) {
      setOpcionesBodega(resuelto.opciones);
      return;
    }
    setBodegaNoEncontrada(textoBodega.trim());
  }

  async function solicitarBodegaNueva() {
    if (!bodegaNoEncontrada) return;
    setErr("");
    try {
      const r = await pedir("/api/bodegas/crear-pendiente", {
        method: "POST", body: JSON.stringify({ nombre: bodegaNoEncontrada }),
      }, token);
      setBodegaNoEncontrada(null);
      setMsgBodega(r.respuesta_hablada || "Solicitud enviada.");
      hablar(r.respuesta_hablada);
    } catch (e) { setErr(e.message); }
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
      const t = await enviarTurno(texto, sesionId, token, {
        opciones, opcionesPara,
        bodegaId: bodega?.bodega_id, bodegaNombre: bodega?.bodega,
      });
      setRespuesta(t.respuesta_hablada || "");
      setOpciones(t.opciones || null);
      setOpcionesPara(t.opciones_para || null);
      setAlerta(t.alerta || null);
      setAlertaEsperado(t.alerta === "desviacion" ? (t.pendiente?.cantidad ?? null) : null);
      setContextoAlerta(t.contexto_alerta || null);
      setPendiente(t.pendiente || null);
      setArchivo(t.archivo || null);
      hablar(t.respuesta_hablada);
      if (t.guardado || t.corregido || t.bodega) refrescar();
      if (t.bodega) {
        setBodega({ bodega: t.bodega.nombre, referencias: t.bodega.referencias, bodega_id: t.bodega.id });
      }
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
    setContextoAlerta(null);
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

  /** Para elegir bodega (a diferencia del conteo, que confirma hablado
      antes de guardar): esto llena el buscador con lo que se reconoció Y
      pregunta en voz alta "¿confirma X?" - un "sí" abre directo, un "no"
      descarta sin tocar nada. Nombres poco comunes ("Piscilago") son
      justo donde más se equivoca el reconocimiento de voz del navegador;
      "Abrir por nombre exacto" sigue ahí como respaldo si prefiere
      escribir o corregir a mano en vez de confirmar hablado. */
  function alMicrofonoBodega() {
    if (estado === "escuchando") {
      rec.current?.stop();
      return;
    }
    setErr("");
    setMsgBodega("");
    setOpcionesBodega(null);
    const miId = ++idEscuchaBodega.current;
    rec.current = escuchar({
      alTexto: (t) => {
        if (miId !== idEscuchaBodega.current) return;
        setTextoBodega(t);
        preguntarConfirmacionBodega(t, miId);
      },
      alEstado: (e, parcial) => {
        setEstado(e);
        if (parcial) setTextoBodega(parcial);
      },
      alError: setErr,
    });
  }

  /** Antes esto preguntaba "¿confirma X?" con lo que se acababa de
      transcribir tal cual - decir "kiosco" confirmaba "kiosco" como si
      fuera una bodega real, cuando lo que existe es "KIOSCO TAQUILLA
      AYB". Ahora primero RESUELVE el nombre contra el catálogo
      (/api/bodegas/buscar, sin abrir nada todavía) y confirma con el
      nombre real que de verdad se va a abrir. Si lo dicho es ambiguo
      ("restaurante" a secas encaja en dos bodegas reales por igual), se
      ofrecen las opciones en vez de fallar en seco; si de verdad no
      encuentra nada, ofrece crearla.

      "miId" identifica ESTA escucha en particular (viene de
      idEscuchaBodega, ver el comentario junto a esa ref): antes de tocar
      cualquier estado se revisa que siga siendo la vigente, porque el
      micrófono anterior a veces entrega su resultado tarde - sin este
      control, ese resultado tardío se procesaba como una bodega nueva
      dictada (por ejemplo, el "confirmo" de la pregunta de abajo llegaba
      aquí como si alguien hubiera dicho "confirmo" como nombre de
      bodega). */
  async function preguntarConfirmacionBodega(nombreDictado, miId) {
    if (!nombreDictado || !nombreDictado.trim()) return;
    if (miId === undefined) miId = ++idEscuchaBodega.current;
    setOpcionesBodega(null);
    let resuelto;
    try {
      resuelto = await buscarBodega(nombreDictado, token);
    } catch (e) {
      if (miId !== idEscuchaBodega.current) return;
      setErr(e.message);
      return;
    }
    if (miId !== idEscuchaBodega.current) return;
    if (!resuelto.encontrada) {
      if (resuelto.opciones?.length) {
        const nombres = resuelto.opciones.map((o) => o.bodega.toLowerCase());
        setOpcionesBodega(resuelto.opciones);
        // reservar el id ANTES de hablar corta de una vez cualquier
        // escucha anterior que responda tarde mientras se dice esto.
        const miIdOpciones = ++idEscuchaBodega.current;
        // hay que esperar a que la pregunta se termine de decir - si el
        // micrófono arranca apenas empieza a sonar, se pierde el
        // principio de la respuesta (o, si la voz tarda, el micrófono
        // hasta se cansa de esperar antes de que la persona alcance a
        // contestar).
        await hablar(`Hay varias: ${nombres.join(", ")}. ¿Cuál de todas?`);
        if (miIdOpciones !== idEscuchaBodega.current) return;
        // se puede elegir tocando una tarjeta, o siguiendo la conversación
        // y diciendo el nombre completo - que vuelve a pasar por aquí,
        // ahora sí resolviendo a una sola.
        rec.current = escuchar({
          alTexto: (t) => {
            if (miIdOpciones !== idEscuchaBodega.current) return;
            setTextoBodega(t);
            preguntarConfirmacionBodega(t, miIdOpciones);
          },
          alEstado: (e) => setEstado(e),
          alError: setErr,
        });
        return;
      }
      hablar(`No encuentro ${nombreDictado.toLowerCase()}. Puede solicitarla como bodega nueva.`);
      setBodegaNoEncontrada(nombreDictado.trim());
      return;
    }
    const nombreReal = resuelto.bodega;
    setTextoBodega(nombreReal);
    const miIdConfirmar = ++idEscuchaBodega.current;
    await hablar(`¿Confirma que abro ${nombreReal.toLowerCase()}?`);
    if (miIdConfirmar !== idEscuchaBodega.current) return;
    rec.current = escuchar({
      alTexto: (respuesta) => {
        if (miIdConfirmar !== idEscuchaBodega.current) return;
        const r = respuesta.toLowerCase().trim();
        if (/^(si|sí|claro|dale|correcto|confirmo|eso es|así es|asi es)\b/.test(r)) {
          abrir(nombreReal);
        } else if (/^no\b/.test(r)) {
          setTextoBodega("");
          const msg = "Gracias, queda pendiente. Cuando quiera abrir una bodega, dígame el nombre.";
          setMsgBodega(msg);
          hablar(msg);
        } else {
          setErr("No le entendí un «sí» o un «no». Use «Abrir por nombre exacto».");
        }
      },
      alEstado: (e) => setEstado(e),
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
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6 }}>
            <button
              className={`mic-btn ${estado === "escuchando" ? "escuchando" : ""}`}
              style={{ width: 46, height: 46, fontSize: "1.2rem" }}
              onClick={alMicrofonoBodega} title="diga el nombre de la bodega">
              🎤
            </button>
            <small style={{ color: "var(--grafito)" }}>
              {estado === "escuchando" ? "Escuchando…"
                : "o diga el nombre de la bodega en voz alta"}
            </small>
          </div>
          <p className="pista" style={{ marginBottom: 8 }}>
            Lo que reconozca aparece abajo, se lo pregunta de vuelta y usted
            confirma diciendo «sí» (nombres como «Piscilago» a veces se
            transcriben mal) — o corríjalo a mano y use «Abrir por nombre
            exacto».
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            <input
              style={{ flex: 1, minWidth: 240, padding: "12px 14px",
                       border: "1px solid var(--borde)", borderRadius: 12 }}
              value={textoBodega}
              onChange={(e) => setTextoBodega(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && abrirPorBoton()}
              placeholder="nombre de la bodega…"
            />
            <button className="btn" onClick={abrirPorBoton}>Abrir por nombre exacto</button>
          </div>
          {err && <p className="error" style={{ marginBottom: 10 }}>{err}</p>}
          {msgBodega && <p className="msg-ok" style={{ marginBottom: 10 }}>{msgBodega}</p>}
          {bodegaNoEncontrada && (
            <div className="banner" style={{ marginBottom: 10 }}>
              <span className="ico">!</span>
              <span>
                <b>¿Crear «{bodegaNoEncontrada}»?</b>
                <span>No existe en el catálogo. Queda pendiente de aprobación del
                      administrador; el conteo no se detiene por esto.</span>
              </span>
              <button className="btn" style={{ flex: "none" }}
                      onClick={solicitarBodegaNueva}>
                Solicitar bodega nueva
              </button>
            </div>
          )}
          {opcionesBodega && (
            <div style={{ marginBottom: 14 }}>
              <p className="pista" style={{ marginBottom: 8 }}>
                Hay varias que encajan con lo dicho — toque una, o diga el
                nombre completo:
              </p>
              <div className="opciones">
                {opcionesBodega.map((o, i) => (
                  <button key={o.bodega_id} className="opcion"
                          onClick={() => { setOpcionesBodega(null); abrir(o.bodega); }}>
                    <span className="n">Opción {i + 1}</span>
                    <h4>{o.bodega}</h4>
                  </button>
                ))}
              </div>
            </div>
          )}
          {asignadas === null ? (
            <p className="cargando">Cargando sus bodegas asignadas…</p>
          ) : asignadas.length > 0 && !buscarOtra ? (
            <>
              <div className="grid-bodegas">
                {asignadas.map((b) => {
                  const [txt, cls] = ETIQUETA_BODEGA[b.estado] || ["?", "gris"];
                  const esOtraPersona = b.estado === "en_conteo" && b.persona
                    && b.persona.toLowerCase() !== (usuario?.nombre || "").toLowerCase();
                  let detalleLinea;
                  if (b.estado === "en_conteo" && b.persona) {
                    detalleLinea = esOtraPersona
                      ? `${b.persona} ya la está contando · ${b.avance_pct ?? 0}%`
                      : `usted la dejó a medias · ${b.avance_pct ?? 0}%`;
                  } else if (b.estado === "en_auditoria" && b.persona) {
                    detalleLinea = `${b.persona} auditando · ${b.diferencias ?? 0} dif.`;
                  } else if (b.estado === "cerrada" && b.hora_cierre) {
                    detalleLinea = `cerrada ${b.hora_cierre}`;
                  } else if (b.estado === "pendiente") {
                    detalleLinea = "sin iniciar · disponible";
                  } else {
                    detalleLinea = `${b.referencias} referencias`;
                  }
                  return (
                    <button key={b.id} className={`tarjeta-bodega ${b.estado}`}
                            onClick={() => abrir(b.bodega)}
                            title={esOtraPersona
                              ? "Ya la está contando otra persona; puede intentar de todas formas."
                              : ""}>
                      <b>{b.bodega}</b>
                      <span className={`chip ${cls} est`}>{txt}</span>
                      <small>{detalleLinea}</small>
                    </button>
                  );
                })}
              </div>
              <div className="grilla-botones" style={{ marginTop: 14 }}>
                <button className="btn borde"
                        onClick={() => { setBuscarOtra(true); if (!todas) cargarTodas(); }}>
                  Buscar otra bodega
                </button>
              </div>
            </>
          ) : (
            <>
              {asignadas.length > 0 && (
                <p className="pista" style={{ marginBottom: 10 }}>
                  Buscando fuera de sus bodegas asignadas.
                </p>
              )}
              {todas === null ? (
                <p className="cargando" style={{ marginTop: 10 }}>Cargando bodegas…</p>
              ) : (
                <div className="grid-bodegas" style={{ marginTop: 14 }}>
                  {(textoBodega.trim()
                    ? todas.filter((b) => b.bodega.toLowerCase()
                                          .includes(textoBodega.trim().toLowerCase()))
                    : todas
                  ).slice(0, 24).map((b) => {
                    const [txt, cls] = ETIQUETA_BODEGA[b.estado] || ["?", "gris"];
                    return (
                      <button key={b.id} className={`tarjeta-bodega ${b.estado}`}
                              onClick={() => abrir(b.bodega)}>
                        <b>{b.bodega}</b>
                        <span className={`chip ${cls} est`}>{txt}</span>
                        <small>{b.referencias} referencias</small>
                      </button>
                    );
                  })}
                </div>
              )}
              {todas && !textoBodega.trim() && todas.length > 24 && (
                <p className="pista" style={{ marginTop: 8 }}>
                  Mostrando 24 de {todas.length} — escriba para filtrar.
                </p>
              )}

              <div className="grilla-botones" style={{ marginTop: 10 }}>
                {asignadas.length > 0 && (
                  <button className="btn gris" onClick={() => setBuscarOtra(false)}>
                    Volver a sus bodegas asignadas
                  </button>
                )}
              </div>
            </>
          )}
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

          {alerta && alerta !== "desviacion" && !crear && (
            <div className="banner">
              <span className="ico">!</span>
              <span style={{ flex: 1 }}>
                <b>
                  {alerta === "negativo" ? "Cantidad imposible"
                    : alerta === "unidad" ? "Unidad de medida distinta"
                    : "Artículo fuera del catálogo"}
                </b>
                <span>{respuesta}</span>
              </span>
            </div>
          )}

          {alerta === "desviacion" && !crear && (
            <AlertaDesviacion
              contexto={contextoAlerta} respuesta={respuesta}
              onRecontar={recontar}
              onConfirmar={() => procesar("confirmo")}
            />
          )}

          {crear && (
            <FormularioCrearProducto
              crear={crear} setCrear={setCrear}
              onCrear={crearPendiente} onCancelar={() => setCrear(null)}
              bodega={bodega.bodega} err={err}
            />
          )}

          {!crear && alerta !== "desviacion" && (
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

          {!crear && alerta !== "desviacion" && (
            <>
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
              <p className="pista" style={{ marginTop: 10 }}>
                La voz es el camino rápido; el teclado siempre queda como respaldo.
              </p>
            </>
          )}
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

const fmt = (n) => Number(n).toLocaleString("es-CO", { maximumFractionDigits: 2 });

function AlertaDesviacion({ contexto, respuesta, onRecontar, onConfirmar }) {
  return (
    <>
      <div className="banner">
        <span className="ico">!</span>
        <span>
          <b>Cantidad fuera de lo esperado</b>
          <span>
            {contexto
              ? `El sistema espera alrededor de ${fmt(contexto.esperado)} · usted dijo `
                + `${fmt(contexto.dicho)}  (${contexto.articulo})`
              : respuesta}
          </span>
        </span>
      </div>

      <div className="card">
        <p className="rotulo">CuentaVoz responde</p>
        <div className="burbuja">{respuesta}</div>
      </div>

      <div className="conteo-cols">
        {contexto ? (
          <div className="card">
            <h3>Contexto de la validación</h3>
            <table>
              <tbody>
                <tr><td>Stock del sistema</td><td><b style={{ color: "var(--azul)" }}>
                  {fmt(contexto.esperado)} {contexto.unidad}</b></td></tr>
                <tr><td>Su conteo</td><td><b style={{ color: "var(--azul)" }}>
                  {fmt(contexto.dicho)} {contexto.unidad}</b></td></tr>
                <tr><td>Desviación</td><td className="dif">
                  {contexto.desviacion_pct != null
                    ? `${contexto.desviacion_pct > 0 ? "+" : ""}${contexto.desviacion_pct}%`
                    : "—"}</td></tr>
              </tbody>
            </table>
          </div>
        ) : <div />}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <button className="btn" onClick={onRecontar}>RECONTAR</button>
          <button className="btn oro" onClick={onConfirmar}>
            CONFIRMAR {contexto ? fmt(contexto.dicho) : ""}
          </button>
        </div>
      </div>

      <p className="pista">
        Si confirma, el registro se guarda marcado para revisión del administrador de bodega.
      </p>
      <p className="pista" style={{ color: "var(--azul)" }}>
        Ninguna cantidad con alerta se guarda sin una confirmación explícita de la persona.
      </p>
    </>
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

      <div className="conteo-cols" style={{ marginTop: 16 }}>
        <div>
          <label className="pista">Nombre tal como lo dictó</label>
          <input value={crear.nombre}
                 onChange={(e) => setCrear({ ...crear, nombre: e.target.value })}
                 style={{ width: "100%", padding: "11px 13px", marginTop: 6,
                          border: "1px solid var(--borde)", borderRadius: 12,
                          textTransform: "uppercase" }} />
        </div>
        <div>
          <label className="pista">Estado del registro</label>
          <div style={{ marginTop: 6 }}>
            <span className="chip oro">PENDIENTE DE APROBACIÓN</span>
          </div>
        </div>
      </div>

      <div className="dos-columnas" style={{ marginTop: 16 }}>
        <div>
          <label className="pista">Unidad de medida</label>
          <div className="grilla-botones" style={{ marginTop: 6 }}>
            {UNIDADES.map((u) => (
              <button key={u}
                      className={`btn ${crear.unidad_medida === u ? "" : "borde"}`}
                      onClick={() => setCrear({ ...crear, unidad_medida: u })}>
                {u}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="pista">Cantidad inicial contada en {bodega}</label>
          <input type="number" min="0" value={crear.cantidad_inicial}
                 onChange={(e) => setCrear({ ...crear, cantidad_inicial: Number(e.target.value) })}
                 style={{ width: "100%", padding: "11px 13px", marginTop: 6,
                          border: "1px solid var(--borde)", borderRadius: 12 }} />
        </div>
      </div>

      <p className="pista" style={{ marginTop: 12 }}>
        No entra al catálogo oficial hasta la firma del administrador de bodega.
      </p>
      {err && <p className="error" style={{ marginTop: 6 }}>{err}</p>}
      <div className="grilla-botones">
        <button className="btn" onClick={onCrear}>Crear pendiente</button>
        <button className="btn gris" onClick={onCancelar}>Cancelar</button>
      </div>
      <p className="pista" style={{ marginTop: 10 }}>
        El conteo continúa sin interrupción: la aprobación ocurre en paralelo.
      </p>
    </div>
  );
}

/** Mismo ciclo de confirmación del agente real (dice el artículo y la
    cantidad, CuentaVoz repite y pregunta, la persona confirma) pero
    corriendo enteramente en el navegador con interpreteLocal.js - sin
    tocar el backend ni el internet para nada. El reconocimiento de voz
    del navegador sí necesita señal (no es algo que esta app controle),
    así que aquí se escribe en vez de dictar; el resto de la conversación
    - entender la frase, sugerir el nombre oficial, pedir confirmación -
    sigue funcionando igual. */
function FormularioOffline({ cola, onGuardar, onReintentar }) {
  const [catalogo] = useState(() => leerCatalogo());
  const [texto, setTexto] = useState("");
  const [dicho, setDicho] = useState("");
  const [respuesta, setRespuesta] = useState(
    "Sin conexión, pero sigo entendiendo lo que escriba. Dígame el artículo y la cantidad."
  );
  const [pendiente, setPendiente] = useState(null); // {articulo, cantidad, unidad, codigo}
  const [mostrarManual, setMostrarManual] = useState(false);

  // el formulario campo por campo de siempre, como respaldo del respaldo
  // si una frase no se deja interpretar bien.
  const [articulo, setArticulo] = useState("");
  const [cantidad, setCantidad] = useState(1);
  const [unidad, setUnidad] = useState("Unidad");
  const sugerenciaManual = sugerirDeCatalogo(articulo, catalogo);

  function procesarTexto(t) {
    if (!t.trim()) return;
    setDicho(t);
    setTexto("");
    const r = interpretarLocal(t);
    const simple = t.trim().toLowerCase();
    const esSi = /^(si|sí|confirmo|correcto|dale|listo)\b/.test(simple);
    const esNo = /^no\b/.test(simple);

    if (pendiente && (esSi || r.intencion === "confirmar")) {
      onGuardar({ articulo: pendiente.articulo, cantidad: pendiente.cantidad,
                  unidad: pendiente.unidad });
      setPendiente(null);
      setRespuesta("Guardado en este equipo. Se sincroniza solo cuando vuelva la señal.");
      return;
    }
    if (pendiente && esNo) {
      setPendiente(null);
      setRespuesta("Listo, no lo guardo. Dígame el artículo y la cantidad correctos.");
      return;
    }
    if (pendiente && r.intencion === "corregir" && r.cantidad != null) {
      setPendiente({ ...pendiente, cantidad: r.cantidad });
      setRespuesta(`${pendiente.articulo}: ${r.cantidad} ${pendiente.unidad}. ¿Confirma?`);
      return;
    }
    if (r.intencion === "contar" && r.cantidad != null) {
      const sug = sugerirDeCatalogo(r.articulo_texto, catalogo);
      const nombreFinal = sug?.nombre || r.articulo_texto || "ese artículo";
      const unidadFinal = sug?.unidad || r.unidad || "Unidad";
      setPendiente({ articulo: nombreFinal, cantidad: r.cantidad,
                     unidad: unidadFinal, codigo: sug?.codigo });
      setRespuesta(`${nombreFinal}: ${r.cantidad} ${unidadFinal}. ¿Confirma? (escriba «sí»)`);
      return;
    }
    setRespuesta(r.respuesta_hablada
      || "No le entendí bien. Dígame el artículo y la cantidad, por ejemplo «hay noventa cazuelas».");
  }

  function usarSugerenciaManual() {
    setArticulo(sugerenciaManual.nombre);
    setUnidad(sugerenciaManual.unidad);
  }
  function ciclarUnidad() {
    setUnidad(UNIDADES[(UNIDADES.indexOf(unidad) + 1) % UNIDADES.length]);
  }
  function guardarManual() {
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
            <b>Sin conexión</b>
            <span>El reconocimiento de voz necesita señal, pero CuentaVoz sigue
                  entendiendo lo que escriba. Lo que registre se guarda en este
                  equipo y se sincroniza solo al volver la red.</span>
          </span>
        </div>

        <p className="rotulo">{dicho ? `Usted escribió: «${dicho}»` : "CuentaVoz responde"}</p>
        <div className="burbuja">{respuesta}</div>

        <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <input value={texto} onChange={(e) => setTexto(e.target.value)}
                 onKeyDown={(e) => e.key === "Enter" && procesarTexto(texto)}
                 placeholder="hay noventa cazuelas blancas…"
                 style={{ flex: 1, minWidth: 200, padding: "13px 14px", fontSize: "1rem",
                          border: "1px solid var(--borde)", borderRadius: 12 }} />
          <button className="btn" onClick={() => procesarTexto(texto)}>Enviar</button>
        </div>

        <div className="grilla-botones" style={{ marginTop: 10 }}>
          <button className="btn borde" onClick={onReintentar}>Reintentar la voz</button>
          <button className="btn gris" onClick={() => setMostrarManual((m) => !m)}>
            {mostrarManual ? "Ocultar formulario manual" : "Registrar campo por campo"}
          </button>
        </div>

        {mostrarManual && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--borde)" }}>
            <label className="pista">Artículo</label>
            <input value={articulo} onChange={(e) => setArticulo(e.target.value)}
                   placeholder="tabla acril…"
                   style={{ width: "100%", padding: "11px 13px", marginBottom: 8,
                            border: "1px solid var(--borde)", borderRadius: 12 }} />
            {sugerenciaManual && (
              <button className="chip azul" onClick={usarSugerenciaManual}
                      style={{ display: "block", width: "100%", textAlign: "left",
                               marginBottom: 6 }}>
                {sugerenciaManual.nombre} {sugerenciaManual.codigo}
              </button>
            )}
            <label className="pista">Cantidad</label>
            <div style={{ display: "flex", gap: 10, marginTop: 6, marginBottom: 10,
                          alignItems: "center" }}>
              <button className="btn borde" style={{ minHeight: 0, padding: "8px 16px" }}
                      onClick={() => setCantidad((c) => Math.max(0, Number(c) - 1))}>−</button>
              <input type="number" value={cantidad}
                     onChange={(e) => setCantidad(e.target.value)}
                     style={{ width: 90, padding: "11px 13px", textAlign: "center",
                              border: "1px solid var(--borde)", borderRadius: 12 }} />
              <button className="btn borde" style={{ minHeight: 0, padding: "8px 16px" }}
                      onClick={() => setCantidad((c) => Number(c) + 1)}>+</button>
              <button className="chip azul" onClick={ciclarUnidad}>{unidad}</button>
            </div>
            <button className="btn" onClick={guardarManual}>Guardar</button>
          </div>
        )}

        <p className="pista" style={{ marginTop: 12 }}>
          El catálogo local sigue sugiriendo nombres oficiales sin internet.
        </p>
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
