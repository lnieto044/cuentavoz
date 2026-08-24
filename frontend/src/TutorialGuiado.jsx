import { useEffect, useRef, useState } from "react";

/* Un paso por cada entrada del menú lateral, EN EL MISMO ORDEN en que
   aparecen ahí: el recorrido sirve para ubicarse, y si el orden no coincide
   con lo que la persona tiene a la vista deja de ayudar. Una línea por
   pantalla, a propósito - un tutorial de doce ventanas con párrafos no lo
   termina nadie; el detalle con ejemplos va en el video, que es la
   herramienta hecha para eso. soloAuditor sigue la misma bandera que MENU
   en App.jsx, así cada quien recorre únicamente lo que puede abrir. */
const PASOS = [
  { titulo: "Inicio",
    texto: "Su resumen del día: bodegas asignadas, referencias contadas, "
         + "alertas por revisar y su exactitud del mes." },
  { titulo: "Pedidos",
    texto: "Diga el plato y las porciones («hoy preparamos cincuenta ajiacos») "
         + "y CuentaVoz calcula qué insumos hacen falta pedir." },
  { titulo: "Conteo",
    texto: "El corazón de la plataforma: abra la bodega, toque el micrófono y "
         + "dicte «arroz veinte kilos». Se confirma antes de guardar." },
  { titulo: "Legalización",
    texto: "Al cerrar el turno, registre el sobrante y la merma del servicio "
         + "para que cuadre con lo que se pidió." },
  { titulo: "Bodegas",
    texto: "Estado de cada bodega en vivo, y buscador para saber cuánto hay "
         + "de un artículo y en qué zonas." },
  { titulo: "Auditoría", soloAuditor: true,
    texto: "Recuente una bodega sin ver los números del auxiliar, ciérrela con "
         + "doble firma y apruebe los productos creados durante la toma." },
  { titulo: "Reportes", soloAuditor: true,
    texto: "El consolidado para My Inventory, el detalle por bodega y la "
         + "trazabilidad completa. Se previsualizan antes de descargar." },
  { titulo: "Panel", soloAuditor: true,
    texto: "La vista gerencial: diferencias absolutas, alertas por tipo y "
         + "exactitud, para decidir qué bodega revisar primero." },
  { titulo: "Ajustes", soloAuditor: true,
    texto: "Umbral de alertas, gestión de usuarios y asignación de bodegas, "
         + "recetas y el registro de trazabilidad." },
  { titulo: "Ayuda",
    texto: "Preguntas frecuentes, las frases que el agente entiende, y un "
         + "cuadro para preguntarle directamente." },
  { titulo: "Mensajes",
    texto: "Bandeja interna para escribirle al administrador de bodega — por "
         + "ejemplo, para pedir que le asignen una zona." },
  { titulo: "Mi perfil",
    texto: "Su clave y verificación en dos pasos, la voz con que le responde "
         + "CuentaVoz, y el alto contraste o la letra más grande." },
];

/** Recorrido guiado del menú, ajustado al rol - mismo patrón de overlay y
    modal que Dialogo.jsx (trampa de foco, Escape cierra), pero por pasos. */
export default function TutorialGuiado({ perfil, onCerrar, onVerVideo }) {
  const pasos = PASOS.filter((p) => !p.soloAuditor || perfil === "auditor");
  const [pasoActual, setPasoActual] = useState(0);
  const modalRef = useRef(null);

  useEffect(() => {
    function alTecla(e) { if (e.key === "Escape") onCerrar(); }
    window.addEventListener("keydown", alTecla);
    return () => window.removeEventListener("keydown", alTecla);
  }, [onCerrar]);

  useEffect(() => {
    modalRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const paso = pasos[pasoActual];
  const esUltimo = pasoActual === pasos.length - 1;

  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}
           role="dialog" aria-modal="true" aria-labelledby="tutorial-titulo"
           ref={modalRef} tabIndex={-1}>
        <p className="pista" style={{ marginBottom: 4 }}>
          Paso {pasoActual + 1} de {pasos.length}
        </p>
        <h2 id="tutorial-titulo">{paso.titulo}</h2>
        <p style={{ margin: "10px 0 14px" }}>{paso.texto}</p>

        {/* barra de avance: con doce pasos hace falta VER cuánto queda, no
            solo leerlo - sin esto el recorrido se siente sin final */}
        <div style={{ height: 4, background: "var(--borde)", borderRadius: 3,
                      overflow: "hidden", marginBottom: 16 }}
             role="progressbar" aria-valuenow={pasoActual + 1}
             aria-valuemin={1} aria-valuemax={pasos.length}>
          <div style={{ height: "100%", borderRadius: 3, background: "var(--azul)",
                        width: `${((pasoActual + 1) / pasos.length) * 100}%`,
                        transition: "width .25s ease" }} />
        </div>

        <div className="botones">
          <button className="btn borde" onClick={onCerrar}>Saltar</button>
          {pasoActual > 0 && (
            <button className="btn borde" onClick={() => setPasoActual((p) => p - 1)}>
              Atrás
            </button>
          )}
          <button className="btn"
                  onClick={() => (esUltimo ? onCerrar() : setPasoActual((p) => p + 1))}>
            {esUltimo ? "Entendido" : "Siguiente"}
          </button>
        </div>

        {onVerVideo && (
          <p className="pista" style={{ marginTop: 12, textAlign: "center" }}>
            ¿Prefiere verlo?{" "}
            <button type="button" className="enlace" onClick={onVerVideo}>
              Ver el recorrido en video
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
