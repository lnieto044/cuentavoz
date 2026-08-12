import { useEffect, useState } from "react";
import { pedir } from "../api";
import Marco from "../Marco";
import Dialogo from "../Dialogo";
import AsistenteVoz from "../AsistenteVoz";

const FAQ = [
  ["¿Cómo corrijo un conteo ya confirmado?",
   "Diga «corregir» y luego el valor correcto. El valor anterior se conserva."],
  ["El agente no me entiende un producto",
   "Dígalo como aparece en la etiqueta. Si no existe, se puede crear: queda pendiente."],
  ["¿Qué hago si sale una alerta?",
   "Recuente. Si el número es correcto, confirme: queda marcado para el administrador."],
  ["Se cayó el internet en plena bodega",
   "Siga contando: el intérprete local mantiene el flujo y sincroniza al volver la señal."],
  ["¿Puedo contar dos bodegas a la vez?",
   "No en el mismo dispositivo. El candado de sesión evita conteos duplicados."],
];

const COMANDOS = [
  ["«Iniciar conteo en almacén de suministros»", "abrir una bodega"],
  ["«Tres tablas para picar blancas»", "registrar un conteo"],
  ["«Corregir» · «Son nueve»", "corregir sin borrar el original"],
  ["«¿Cuánto arroz hay y en qué bodegas?»", "consultar el inventario"],
  ["«Hoy preparamos cincuenta ajiacos»", "pedir insumos por receta"],
];

export default function Ayuda({ token, ir }) {
  const [salud, setSalud] = useState(null);
  const [busca, setBusca] = useState("");
  const [reportando, setReportando] = useState(false);
  const [msg, setMsg] = useState("");
  const [pedirDetalle, setPedirDetalle] = useState(false);
  const [admin, setAdmin] = useState(null);

  useEffect(() => {
    pedir("/api/salud", {}, token).then(setSalud).catch(() => setSalud({ api: "caido" }));
    pedir("/api/soporte/administrador", {}, token).then(setAdmin).catch(() => {});
  }, [token]);

  async function reportarProblema(detalle) {
    setPedirDetalle(false);
    if (!detalle || !detalle.trim()) return;
    setReportando(true);
    try {
      await pedir("/api/soporte/reportar", {
        method: "POST", body: JSON.stringify({ detalle }),
      }, token);
      setMsg("Reportado a la mesa de ayuda. Quedó en el registro de trazabilidad.");
    } catch (e) { setMsg(e.message); }
    setReportando(false);
  }

  const q = busca.trim().toLowerCase();
  const faqFiltrado = q ? FAQ.filter(([p, r]) =>
    p.toLowerCase().includes(q) || r.toLowerCase().includes(q)) : FAQ;
  const comandosFiltrados = q ? COMANDOS.filter(([c, d]) =>
    c.toLowerCase().includes(q) || d.toLowerCase().includes(q)) : COMANDOS;

  const servicios = [
    ["API y base de datos", salud?.api === "ok"],
    ["Datos del inventario cargados", (salud?.stock || 0) > 0],
    ["Agente Gemini (AI Studio)", Boolean(salud?.gemini)],
  ];

  return (
    <Marco titulo="Ayuda  ·  cómo usar CuentaVoz" chip={{ texto: "SOPORTE", tipo: "azul" }}>
      <AsistenteVoz token={token} vista="ayuda" ir={ir}
                    placeholder="pregúntele al agente, por ejemplo: ¿qué hago si sale una alerta?" />
      <div className="card">
        <input value={busca} onChange={(e) => setBusca(e.target.value)}
               placeholder="O escriba aquí para filtrar las preguntas frecuentes de abajo…"
               style={{ width: "100%", padding: "12px 14px",
                        border: "1px solid var(--borde)", borderRadius: 12 }} />
      </div>
      <div className="conteo-cols">
        <div className="card">
          <h3>Preguntas frecuentes</h3>
          {faqFiltrado.length === 0 && <p className="vacio">Sin resultados para «{busca}».</p>}
          {faqFiltrado.map(([p, r], i) => (
            <div key={i} style={{ marginBottom: 12, paddingBottom: 12,
                 borderBottom: i < faqFiltrado.length - 1 ? "1px solid var(--borde)" : "none" }}>
              <b style={{ color: "var(--azul)", fontSize: ".92rem" }}>{p}</b>
              <p style={{ fontSize: ".86rem", color: "var(--grafito)", marginTop: 3 }}>{r}</p>
            </div>
          ))}

          <h3 style={{ marginTop: 18 }}>Guía rápida de comandos de voz</h3>
          {comandosFiltrados.length === 0 && <p className="vacio">Sin resultados para «{busca}».</p>}
          {comandosFiltrados.map(([c, d], i) => (
            <div className="registro" key={i}>
              <span style={{ color: "var(--azul)", fontWeight: 700 }}>{c}</span>
              <span className="cant">{d}</span>
            </div>
          ))}
        </div>

        <div>
          <div className="card">
            <h3>Soporte en vivo</h3>
            {admin?.nombre ? (
              <>
                <p style={{ fontSize: ".88rem" }}>
                  Administrador de bodega · <span style={{ textTransform: "capitalize" }}>{admin.nombre}</span>
                  <span style={{ color: "var(--verde)", fontWeight: 700 }}> · disponible</span>
                </p>
                <div className="grilla-botones">
                  <button className="btn"
                          onClick={() => { window.location.href = `mailto:${admin.correo}`; }}>
                    Escribirle al administrador
                  </button>
                </div>
              </>
            ) : admin?.es_usted ? (
              <p style={{ fontSize: ".88rem" }}>
                Usted es la administradora de turno: los auxiliares le escriben a
                usted. Para algo que se salga de su alcance, use la mesa de ayuda
                de Colsubsidio.
              </p>
            ) : (
              <p style={{ fontSize: ".88rem" }}>
                No hay otro administrador registrado por ahora. Use la mesa de
                ayuda de Colsubsidio.
              </p>
            )}
            {msg && <p className="msg-ok">{msg}</p>}
            <p className="pista" style={{ margin: "10px 0" }}>
              Mesa de ayuda Colsubsidio · ext. 4040 · 7 por 24
            </p>
            <div className="grilla-botones">
              <button className="btn oro" disabled={reportando} onClick={() => setPedirDetalle(true)}>
                {reportando ? "Enviando…" : "Reportar un problema"}
              </button>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h3>Estado del sistema</h3>
            {servicios.map(([t, ok], i) => (
              <div className="registro" key={i}>
                <span className="ok" style={{ background: ok ? "var(--verde)" : "#B3261E" }}>
                  {ok ? "✓" : "!"}
                </span>
                <span>{t}</span>
                <span className="cant" style={{ color: ok ? "var(--verde)" : "#B3261E",
                      fontWeight: 700 }}>
                  {ok ? "operativo" : "revisar"}
                </span>
              </div>
            ))}
            {!salud?.gemini && (
              <p className="pista" style={{ marginTop: 10 }}>
                Sin la llave de Gemini el agente usa el intérprete local: el flujo
                funciona igual, pero entiende menos variantes de frase. Ponga
                GOOGLE_API_KEY en el archivo .env para activarlo.
              </p>
            )}
          </div>
        </div>
      </div>

      {pedirDetalle && (
        <Dialogo titulo="Reportar un problema"
                 mensaje="Describa el problema que encontró:"
                 conCampo multilinea placeholder="Se cayó el micrófono al confirmar un conteo…"
                 textoAceptar="Enviar"
                 onAceptar={reportarProblema}
                 onCancelar={() => setPedirDetalle(false)} />
      )}
    </Marco>
  );
}
