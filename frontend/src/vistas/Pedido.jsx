import { useState, useEffect } from "react";
import { pedir, enviarTurno, descargarReporte } from "../api";
import { escuchar, hablar } from "../voz";
import Marco from "../Marco";
import Dialogo from "../Dialogo";
import Icono from "../Iconos";

const DIA = new Date().toLocaleDateString("es-CO", { weekday: "long" });
// Palabras sueltas que valen como "sí" a lo que se le esté preguntando
// (confirmar un guardado, o enviar el pedido calculado).
const AFIRMACIONES = ["confirmo", "confirmar", "si", "sí", "claro", "listo", "dale",
                      "correcto", "hazlo", "adelante", "procede"];
// Frases de varias palabras que tambien confirman, tal como las dice una
// persona real ("así es", "va, mándalo") y no calzarian con el chequeo por
// palabra exacta de arriba.
const FRASES_AFIRMATIVAS = ["así es", "asi es", "eso es", "va pues", "de una"];

function quitarTildes(t) {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function esConfirmacion(texto) {
  const t = quitarTildes(texto.toLowerCase()).replace(/[.,!¿?]/g, "");
  const palabras = t.split(/\s+/);
  if (palabras.includes("no")) return false;          // "no lo envíes" no es un sí
  if (palabras.some((p) => AFIRMACIONES.includes(quitarTildes(p)))) return true;
  if (FRASES_AFIRMATIVAS.some((f) => t.includes(quitarTildes(f)))) return true;
  // cualquier conjugación de "enviar"/"mandar" cuenta como un sí a la
  // pregunta de mandar el pedido ("envíalo", "envíelo", "envíenmelo",
  // "mándalo", "mándemelo"...) - enumerar cada forma verbal a mano es
  // interminable y siempre se queda corto; sin esto, decir la forma
  // "usted" en vez de la forma "tú" hacía que la pantalla repitiera el
  // mismo mensaje en vez de entender que la persona ya dijo que sí.
  return /envi|mand/.test(t);
}

/** Un "no" limpio a lo que se le está preguntando (¿prepara otro plato?,
    ¿lo enviamos?), sin que además mencione un plato nuevo - si mencionara
    uno, no es un cierre sino un cambio de tema, y eso lo debe interpretar
    Gemini como corresponde, no cerrarse en seco aquí. */
function esNegacionSimple(texto, platosConocidos) {
  const t = quitarTildes(texto.toLowerCase()).replace(/[.,!¿?]/g, "");
  const palabras = t.split(/\s+/);
  if (!palabras.includes("no")) return false;
  const mencionaOtroPlato = platosConocidos.some(
    (nombre) => t.includes(quitarTildes(nombre.toLowerCase()))
  );
  return !mencionaOtroPlato;
}

// Pedidos se sale y se vuelve a entrar todo el tiempo (a mirar otra pantalla
// a mitad de un pedido, por ejemplo): sin guardar esto, cada regreso mostraba
// la pantalla en blanco como si la conversación nunca hubiera pasado, aunque
// el chef ya llevara todo un plato armado. Se guarda en sessionStorage (no
// sobrevive a cerrar la pestaña) y por persona, para que dos sesiones en el
// mismo navegador no se mezclen.
function claveEstadoPedido(sesionId) {
  return `cv_pedido_estado_${sesionId}`;
}
function cargarEstadoPedido(sesionId) {
  try { return JSON.parse(sessionStorage.getItem(claveEstadoPedido(sesionId)) || "{}"); }
  catch { return {}; }
}

export default function Pedido({ token, usuario, ir }) {
  const esAuditor = usuario?.perfil === "auditor";
  // Pedidos tiene su propia conversación con el agente, aislada de la del
  // conteo físico: usa un numero de sesion negativo (unico por persona) para
  // que nunca choque con una sesion real de bodega (esas siempre son >= 1).
  const sesionId = -1000 - (usuario?.id || 0);
  const guardado = cargarEstadoPedido(sesionId);
  // Vacío hasta que de verdad se dicte algo: mostrar «ajiaco/50» desde el
  // arranque hacía parecer que ya se había entendido un pedido que nadie
  // dictó todavía, y esos datos no cambiaban con nada más que se dijera.
  const [plato, setPlato] = useState(guardado.plato || "");
  const [porciones, setPorciones] = useState(guardado.porciones ?? null);
  const [dicho, setDicho] = useState(guardado.dicho || "");
  const [lineas, setLineas] = useState(guardado.lineas ?? null);
  const [receta, setReceta] = useState(null);
  const [enviado, setEnviado] = useState(guardado.enviado || false);
  const [recibo, setRecibo] = useState(guardado.recibo ?? null);
  const [respuesta, setRespuesta] = useState(
    guardado.respuesta || "Diga el plato y las porciones: «hoy preparamos cincuenta ajiacos»."
  );
  const [estado, setEstado] = useState("listo");
  const [err, setErr] = useState("");
  const [archivo, setArchivo] = useState(guardado.archivo ?? null);
  const [pedirPorciones, setPedirPorciones] = useState(false);
  const [avisos, setAvisos] = useState(guardado.avisos ?? null);
  const [opciones, setOpciones] = useState(guardado.opciones ?? null);
  const [opcionesPara, setOpcionesPara] = useState(guardado.opcionesPara ?? null);
  const [productoConsultado, setProductoConsultado] = useState(guardado.productoConsultado ?? null);
  const [bodegas, setBodegas] = useState([]);
  const [bodegaId, setBodegaId] = useState(guardado.bodegaId ?? null);
  const [platos, setPlatos] = useState([]);
  const [offline, setOffline] = useState(!navigator.onLine);

  // a diferencia de Conteo (que solo guarda "conté X de Y" y sincroniza
  // después), calcular un pedido necesita el stock EN VIVO de la bodega
  // para saber cuánto falta pedir - no hay forma honesta de simularlo sin
  // conexión sin arriesgar un cálculo con datos viejos. Por eso aquí no
  // hay cola offline: solo se avisa con claridad que hay que esperar a
  // tener señal, y lo que el chef ya dictó no se pierde (sigue guardado
  // en sessionStorage, ver claveEstadoPedido arriba).
  useEffect(() => {
    const alVolver = () => setOffline(false);
    const alPerder = () => setOffline(true);
    window.addEventListener("online", alVolver);
    window.addEventListener("offline", alPerder);
    return () => {
      window.removeEventListener("online", alVolver);
      window.removeEventListener("offline", alPerder);
    };
  }, []);

  // Guarda una foto de la conversación en cada cambio relevante, para que
  // salir y volver a esta pantalla la deje tal cual como quedó.
  useEffect(() => {
    const foto = { plato, porciones, dicho, lineas, enviado, recibo, respuesta,
                   archivo, avisos, opciones, opcionesPara, productoConsultado, bodegaId };
    sessionStorage.setItem(claveEstadoPedido(sesionId), JSON.stringify(foto));
  }, [plato, porciones, dicho, lineas, enviado, recibo, respuesta,
      archivo, avisos, opciones, opcionesPara, productoConsultado, bodegaId, sesionId]);

  // para que el chef sepa que puede pedir sin tener que adivinar el nombre
  // exacto de una receta que quiza no existe todavia.
  useEffect(() => {
    pedir("/api/recetas", {}, token).then(setPlatos).catch(() => {});
  }, [token]);

  function elegirPlato(nombre) {
    setErr("");
    setDicho(`«${nombre}» (elegido de la lista de recetas)`);
    setPlato(nombre);
    setLineas(null);
    setReceta(null);
    setEnviado(false);
    setRecibo(null);
    setProductoConsultado(null);
    const msg = `Listo, ${nombre.toLowerCase()}. ¿Para cuántas porciones?`;
    setRespuesta(msg);
    hablar(msg);
    setPedirPorciones(true);
  }

  // el agente saluda primero en vez de esperar a que el chef adivine que
  // hay que hablar: sin esto el mensaje de bienvenida solo se veia en la
  // pantalla, nunca se oia, y no parecia un asistente por voz de verdad.
  // Ahora que la conversación se guarda (ver arriba), esto ya no necesita
  // adivinar por tiempo: si ya hay un plato en curso (porque se restauró de
  // una visita anterior), es un pedido que sigue abierto y no se interrumpe;
  // si no hay nada, es un pedido nuevo de verdad y sí saluda.
  useEffect(() => {
    if (!plato) {
      hablar("Dígame por favor qué va a preparar y para cuántas porciones.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Con qué bodega se descuenta el pedido: por defecto el almacén de
  // Alimentos y Bebidas (donde de verdad están los ingredientes de cocina),
  // no una bodega al azar - antes quedaba fijo en la primera de la lista
  // (una oficina administrativa sin ningún stock) y todo salía en cero.
  // Si ya habia una bodega elegida de una visita anterior, se respeta esa.
  useEffect(() => {
    pedir("/api/bodegas", {}, token).then((bs) => {
      setBodegas(bs);
      if (bodegaId) return;
      const conStock = bs.find((b) => /ALMACEN\s*AYB/i.test(b.bodega))
        || bs.find((b) => b.referencias > 0) || bs[0];
      if (conStock) setBodegaId(conStock.id);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function verReceta(platoForzado) {
    setErr("");
    const pl = platoForzado ?? plato;
    if (!pl) {
      const msg = "Primero dígame qué va a preparar.";
      setRespuesta(msg);
      hablar(msg);
      return;
    }
    try {
      const r = await pedir(`/api/pedidos/receta?plato=${encodeURIComponent(pl)}`, {}, token);
      if (!r.lineas) {
        setErr(`No encontré una receta para «${pl}». Pruebe con ajiaco o sancocho.`);
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
    if (esConfirmacion(texto)) {
      // Si lo último que dijo fue "no" a enviarlo, un "sí" suelto un rato
      // después no debe mandarlo de golpe - puede ser un "sí" para otra
      // cosa (confirmando que entendió, por ejemplo), no una segunda
      // vuelta pidiendo enviarlo. Un "envíalo"/"mándalo" explícito sí
      // pasa de una: no hay ambigüedad posible en eso.
      const esExplicitoEnviar = /envi|mand/.test(quitarTildes(texto.toLowerCase()));
      if (!esExplicitoEnviar && respuesta.includes("Para empezar uno nuevo")
          && lineas && !enviado) {
        const msg = "Para enviarlo dígalo de nuevo con «envíalo», o dígame otro plato para uno nuevo.";
        setRespuesta(msg);
        hablar(msg);
        return;
      }
      if (lineas && !enviado && porPedir === 0) {
        // igual que el botón, que se oculta en este caso: no hay nada que
        // enviar, así que "envíalo" no debe crear un pedido vacío.
        const msg = "No hay nada que enviar: ya tiene todo en la bodega. ¿Prepara otro plato?";
        setRespuesta(msg);
        hablar(msg);
        return;
      }
      if (lineas && !enviado) return enviar();
      if (!lineas) return calcular();
      const msg = "Este pedido ya se envió al almacén. ¿Desea armar otro pedido?";
      setRespuesta(msg);
      hablar(msg);
      return;
    }

    // un "no" limpio (sin mencionar otro plato) cierra la conversación en
    // vez de caer en Gemini, que sin una intención propia para "declinar"
    // terminaba repitiendo el mismo mensaje una y otra vez.
    if (esNegacionSimple(texto, platos.map((p) => p.nombre))) {
      // si ya le habíamos contestado con la misma frase de cierre (porque
      // ya dijo "no" antes, a "¿lo enviamos?" o a esta misma), un segundo
      // "no" no debe repetirla - hay que dar el cierre final de una vez,
      // no seguir insistiendo con la misma pregunta.
      const yaSeDespidio = respuesta.includes("Para empezar uno nuevo")
        || respuesta.includes("estaré pendiente");
      const msg = yaSeDespidio
        ? "Listo, gracias. Quedo pendiente si requiere consultar otro pedido. Que tenga un buen día."
        : (lineas && !enviado && porPedir > 0)
          // A propósito no termina en "¿sí o no?": un "sí" aquí se
          // confundiría con el "sí" que envía el pedido (esConfirmacion
          // más abajo lo manda directo con lineas && !enviado), justo lo
          // opuesto de lo que la persona acaba de decir. En cambio se
          // describe dónde queda el pedido y cómo empezar uno nuevo -
          // nombrar otro plato ya lo hace, sin ambigüedad.
          ? "Está bien, no lo envío por ahora; el pedido queda calculado aquí, "
            + "pendiente de enviar cuando usted quiera. Para empezar uno nuevo, "
            + "dígame otro plato."
          : "Listo, gracias. Que tenga un buen día — aquí estaré pendiente si desea consultar otro pedido.";
      setRespuesta(msg);
      hablar(msg);
      return;
    }

    try {
      const t = await enviarTurno(texto, sesionId, token,
        { opciones, opcionesPara, preparacion: plato, porciones });
      // un plato nuevo es un tema distinto: la última consulta de producto
      // ya no aplica y solo estorbaría junto al pedido que se está armando.
      if (t.preparacion && t.porciones) setProductoConsultado(null);
      if (t.preparacion && t.preparacion !== plato) {
        // cambio de plato: las porciones y lo ya calculado eran del plato
        // anterior, no de este - si no vienen porciones nuevas, se limpian
        // en vez de dejar el numero viejo puesto como si ya se hubiera dicho.
        setPlato(t.preparacion);
        setPorciones(t.porciones || null);
        setLineas(null);
        setReceta(null);
        setEnviado(false);
        setRecibo(null);
      } else if (t.porciones) {
        setPorciones(t.porciones);
      }
      setRespuesta(t.respuesta_hablada || "");
      setArchivo(t.archivo || null);
      setOpciones(t.opciones || null);
      setOpcionesPara(t.opciones_para || null);
      if (t.producto_consultado) setProductoConsultado(t.producto_consultado);
      if (t.receta) setReceta(t.receta);
      // el chef ya dijo plato Y porciones en la misma frase: el agente dice
      // "voy a consultar la receta y los insumos" en su respuesta, asi que
      // hay que calcular de una - si no, la pantalla se queda sin nada
      // mientras el mensaje hablado ya prometió que se iba a hacer. Ese
      // cálculo ya trae su propio mensaje hablado (calcular() más abajo);
      // hablar también esta respuesta intermedia disparaba dos audios casi
      // simultáneos que competían por la misma voz neuronal, y si uno de
      // los dos fallaba caía en la voz de respaldo del navegador, sonaba
      // como si hablaran dos personas distintas.
      if (t.preparacion && t.porciones) {
        calcular(t.porciones, t.preparacion);
      } else {
        hablar(t.respuesta_hablada);
      }
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
      const p = Number(v);
      // cero o negativo no es una cantidad real de porciones - sin este
      // chequeo, el campo lo dejaba pasar igual (aquí "0" es un string no
      // vacío, así que sí entra al if de arriba) y el cálculo salía con
      // "ya tiene todo, no hace falta pedir nada" para cualquier receta.
      if (p <= 0) {
        const msg = "Las porciones tienen que ser un número mayor a cero. ¿Cuántas son en realidad?";
        setRespuesta(msg);
        hablar(msg);
        return;
      }
      setPorciones(p);
      setLineas(null);
      // sin esto, tras elegir un plato de la lista y poner las porciones no
      // pasaba nada visible hasta darle aparte a "Calcular el pedido" - se
      // sentía como si el numero no hubiera servido de nada.
      calcular(p);
    }
  }

  /** El backend explota la receta y descuenta el stock.
      porcionesForzadas/platoForzado: para poder calcular con el valor recien
      confirmado sin esperar al proximo render (si no, calcular() veria el
      plato o las porciones viejas por el cierre de la funcion). */
  async function calcular(porcionesForzadas, platoForzado) {
    setErr("");
    const p = porcionesForzadas ?? porciones;
    const pl = platoForzado ?? plato;
    if (!pl || !p) {
      const msg = "Primero dígame qué va a preparar y para cuántas porciones.";
      setRespuesta(msg);
      hablar(msg);
      return;
    }
    setEnviado(false);
    setAvisos(null);
    setRecibo(null);
    try {
      const r = await pedir("/api/pedidos/calcular", {
        method: "POST",
        body: JSON.stringify({ plato: pl, porciones: Number(p), bodega_id: bodegaId }),
      }, token);
      if (!r.receta_encontrada) {
        // no se queda solo con el texto rojo en silencio: cierra la
        // conversación con una salida clara en vez de dejar la pantalla
        // varada con un plato que no tiene receta y ningún paso siguiente.
        const msg = `No encontré una receta para «${pl}». Elija uno de los platos de la lista o dígame otro nombre.`;
        setErr(msg);
        setRespuesta(msg);
        hablar(msg);
        setPlato("");
        setPorciones(null);
        return;
      }
      setLineas(r.lineas);
      if (r.faltantes_catalogo?.length || r.sin_registro_bodega?.length) {
        setAvisos({ faltantes: r.faltantes_catalogo, sinRegistro: r.sin_registro_bodega });
      }
      const faltan = r.lineas.filter((l) => l.falta > 0).length;
      const msg = faltan === 0
        ? `Ya tiene los ${r.lineas.length} insumos que necesita en la bodega; no hace falta pedir nada al almacén. ¿Prepara otro plato?`
        : `Necesita ${r.lineas.length} insumos. Hay que pedir ${faltan} al almacén; el resto ya está en la bodega. ¿Lo enviamos?`;
      setRespuesta(msg);
      hablar(msg);
      // ya se calculó el pedido con esta receta: de una se muestra tambien,
      // sin que la persona tenga que pedirla aparte con "Ver la receta".
      verReceta(pl);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function enviar() {
    try {
      const r = await pedir("/api/pedidos/enviar", {
        method: "POST",
        body: JSON.stringify({ lineas, servicio_id: 1, plato, porciones, bodega_id: bodegaId }),
      }, token);
      if (r.duplicado) {
        const msg = "Este pedido ya se había enviado antes; no lo mandé dos veces. ¿Desea armar otro pedido?";
        setRespuesta(msg);
        hablar(msg);
        setEnviado(true);
        return;
      }
      const msg = r.estado === "pendiente_aprobacion"
        ? `Pedido ${r.numero_pedido} registrado. Queda pendiente de que el administrador lo apruebe antes de salir del almacén. ¿Desea armar otro pedido?`
        : `Pedido ${r.numero_pedido} registrado y enviado a ${r.bodega || "el almacén"}. ¿Desea armar otro pedido?`;
      setRespuesta(msg);
      hablar(msg);
      setEnviado(true);
      setRecibo(r);
    } catch (e) {
      setErr(e.message);
    }
  }

  const porPedir = lineas ? lineas.filter((l) => l.falta > 0).length : 0;

  return (
    <Marco titulo="Pedidos  ·  Cocina Piscilago"
           chip={offline ? { texto: "SIN CONEXIÓN", tipo: "oro" }
                         : { texto: "SERVICIO ALMUERZO", tipo: "" }}>
      {offline && (
        <div className="banner">
          <span className="ico">!</span>
          <span>
            <b>Sin conexión</b>
            <span>Calcular un pedido necesita el stock en vivo de la bodega, así que
                  no se puede hacer sin señal. Lo que ya dictó no se pierde - siga
                  cuando vuelva la conexión y retome donde quedó.</span>
          </span>
        </div>
      )}
      <div className="chips">
        <span className="chip">{DIA[0].toUpperCase() + DIA.slice(1)} · almuerzo</span>
        <span className="chip">Cocina Piscilago</span>
        <span className={`chip ${!enviado ? "oro" : recibo?.estado === "pendiente_aprobacion" ? "oro" : "verde"}`}>
          {!enviado ? "Pedido sin enviar"
            : recibo?.estado === "pendiente_aprobacion" ? "Pendiente de aprobación"
            : "Pedido enviado"}
        </span>
        {bodegas.length > 0 && (
          <select value={bodegaId || ""}
                  onChange={(e) => { setBodegaId(Number(e.target.value)); setLineas(null); }}
                  aria-label="Bodega de la que se descuenta el pedido"
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
                  })}
                  aria-label="Hable para decir el plato y las porciones">
            <Icono nombre="microfono" tam={52} />
          </button>
          <b>{estado === "escuchando" ? "Escuchando…" : "Mantenga presionado y hable"}</b>
          <small>También sirve: «pedir insumos para 30 sancochos»</small>
          <small style={{ color: "var(--verde)", fontWeight: 700 }}>
            Receta + stock = pedido
          </small>
          <details style={{ marginTop: 4, textAlign: "left", width: "100%" }}>
            <summary className="pista" style={{ cursor: "pointer" }}>
              Ver frases exactas que entiende el agente aquí
            </summary>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {["hoy preparamos cincuenta ajiacos", "pedir insumos para 30 sancochos",
                "cambia a treinta porciones", "sí", "envíalo", "no",
                "corregir cantidad"].map((ej, i) => (
                <li key={i} className="pista" style={{ marginBottom: 4 }}>«{ej}»</li>
              ))}
            </ul>
          </details>
        </div>
      </div>

      {platos.length > 0 && (
        <div className="card">
          <h3>🍲 Platos con receta registrada</h3>
          <p className="pista" style={{ marginBottom: 10 }}>
            Estos son los únicos platos que CuentaVoz sabe calcular por ahora. Toque uno
            para armar el pedido sin dictarlo, o dígalo tal cual suena aquí.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {platos.map((r) => (
              <button key={r.id}
                      className={`chip ${plato.toUpperCase() === r.nombre.toUpperCase() ? "azul" : ""}`}
                      onClick={() => elegirPlato(r.nombre)}>
                {r.nombre.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <p className="rotulo">CuentaVoz responde</p>
        <div className="burbuja" aria-live="polite" aria-atomic="true">{respuesta}</div>
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
                    onClick={() => descargarReporte(archivo, token).catch((e) => setErr(e.message))}
                    style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Icono nombre="descargar" tam={16} />
              Descargar archivo generado
            </button>
          </div>
        )}
        {err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}
        <div className="grilla-botones">
          <button className="btn" onClick={() => calcular()} disabled={offline}
                  style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Icono nombre="pedidos" tam={16} />
            Calcular el pedido
          </button>
          <button className="btn borde" onClick={corregirCantidad}
                  style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Icono nombre="refrescar" tam={16} />
            Corregir cantidad
          </button>
          {!receta && (
            <button className="btn oro" onClick={() => verReceta()}
                    style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Icono nombre="reportes" tam={16} />
              Ver la receta
            </button>
          )}
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
            <span className={`chip ${esAuditor ? "azul" : "gris"}`}>
              {esAuditor ? "ADMINISTRA ESTA RECETA" : "SOLO CONSULTA"}
            </span>
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
          {receta.preparacion ? (
            <>
              <h3 style={{ marginTop: 18 }}>Preparación paso a paso</h3>
              <p style={{ whiteSpace: "pre-line", fontSize: ".92rem" }}>{receta.preparacion}</p>
            </>
          ) : (
            <p className="pista" style={{ marginTop: 18 }}>
              Esta receta todavía no tiene preparación paso a paso cargada.
              {esAuditor && " Agréguela desde Ajustes → Recetas."}
            </p>
          )}
          <p className="pista" style={{ marginTop: 10 }}>
            {esAuditor
              ? "Como administradora puede editar cantidades, agregar o quitar ingredientes, o crear un plato nuevo desde Ajustes → Recetas."
              : "Esta receta la mantiene el administrador; si algo está desactualizado, avísele desde Reportes."}
          </p>
          <div className="grilla-botones">
            <button className="btn" onClick={() => { setReceta(null); calcular(); }}
                    style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Icono nombre="pedidos" tam={16} />
              Usar para un pedido
            </button>
            {esAuditor && (
              <button className="btn borde"
                      onClick={() => ir && ir("ajustes", { tabInicial: "recetas", recetaId: receta.id })}
                      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Icono nombre="ajustes" tam={16} />
                Editar receta
              </button>
            )}
            <button className="btn gris" onClick={() => setReceta(null)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Icono nombre="salir" tam={16} />
              Cerrar
            </button>
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
            {porPedir === 0 ? (
              <p className="msg-ok" style={{ marginTop: 10 }}>
                ✅ Ya tiene todo en la bodega: no hace falta enviar nada al almacén.
              </p>
            ) : !enviado && (
              <div className="grilla-botones">
                <button className="btn verde" onClick={enviar} disabled={offline}
                        style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Icono nombre="bodegas" tam={16} />
                  Enviar pedido al almacén
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {recibo && (
        <div className="card" style={{ border: `1px solid var(--${recibo.estado === "pendiente_aprobacion" ? "amarillo" : "verde"})` }}>
          <div className="chips">
            {recibo.estado === "pendiente_aprobacion" ? (
              <span className="chip oro">⏳ PENDIENTE DE APROBACIÓN</span>
            ) : (
              <span className="chip verde">✅ PEDIDO REGISTRADO</span>
            )}
            <span className="chip">{recibo.numero_pedido}</span>
          </div>
          <h3 style={{ marginTop: 12 }}>Recibo de pedido</h3>
          <table>
            <tbody>
              <tr><td>Número de pedido</td><td><b style={{ color: "var(--verde)" }}>
                {recibo.numero_pedido}</b></td></tr>
              <tr><td>Plato</td><td><b>{plato.toUpperCase()}</b> · {porciones} porciones</td></tr>
              <tr><td>Bodega de descuento</td><td><b>{recibo.bodega || "—"}</b></td></tr>
              <tr><td>Registrado por</td><td style={{ textTransform: "capitalize" }}>{recibo.persona}</td></tr>
              <tr><td>Hora</td><td>{recibo.hora}</td></tr>
              <tr><td>Insumos solicitados</td><td>{recibo.total_lineas}</td></tr>
            </tbody>
          </table>
          {recibo.items?.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>Detalle enviado al almacén</h3>
              <table>
                <thead><tr><th>Insumo</th><th>Cantidad</th><th>Unidad</th></tr></thead>
                <tbody>
                  {recibo.items.map((it, i) => (
                    <tr key={i}><td>{it.nombre}</td><td>{it.cantidad}</td><td>{it.unidad}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <p className="pista" style={{ marginTop: 10 }}>
            {recibo.estado === "pendiente_aprobacion"
              ? "El administrador de bodega debe aprobar este pedido en Auditoría antes de que cuente como enviado de verdad al almacén."
              : "Este pedido queda guardado en el sistema y aparecerá tal cual en la legalización del servicio, comparando lo pedido contra lo consumido."}
          </p>
          <div className="grilla-botones">
            <button className="btn gris" onClick={() => window.print()}>Imprimir recibo</button>
          </div>
        </div>
      )}

      {pedirPorciones && (
        <Dialogo titulo={porciones ? "Corregir cantidad" : "Porciones"}
                 mensaje={porciones ? "¿Cuántas porciones son en realidad?"
                                    : `¿Para cuántas porciones prepara ${plato.toLowerCase()}?`}
                 conCampo conVoz tipo="number" valorInicial={porciones ?? ""}
                 onAceptar={confirmarPorciones}
                 onCancelar={() => setPedirPorciones(false)} />
      )}
    </Marco>
  );
}
