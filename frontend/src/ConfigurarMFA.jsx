import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { iniciarActivacionMFA, confirmarActivacionMFA, uriOtpAuth } from "./cognito";

/** Los 3 pasos para activar la verificación en dos pasos (instalar,
    escanear/copiar la llave, confirmar con el código) - un solo
    componente para no repetir esto en Mi perfil Y en el registro (ver
    Ingreso.jsx: se ofrece justo después de confirmar el correo). Pide
    la llave a Cognito apenas se monta - necesita una sesión ya
    autenticada (self-service, no admin), así que solo se usa después
    de un login o un registro ya confirmado. */
export default function ConfigurarMFA({ nombreUsuario, onActivado, onCancelar, textoCancelar = "Cancelar" }) {
  const [llave, setLlave] = useState("");
  const [qr, setQr] = useState("");
  const [mostrarLlave, setMostrarLlave] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [err, setErr] = useState("");
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    iniciarActivacionMFA().then(setLlave).catch((e) => setErr(e.message));
  }, []);

  // el QR se genera del lado del cliente (nadie más necesita verlo) a
  // partir de la llave secreta que da Cognito.
  useEffect(() => {
    if (!llave || !nombreUsuario) { setQr(""); return; }
    QRCode.toDataURL(uriOtpAuth(llave, nombreUsuario)).then(setQr).catch(() => setQr(""));
  }, [llave, nombreUsuario]);

  async function confirmar() {
    setErr(""); setCargando(true);
    try {
      await confirmarActivacionMFA(codigo.trim());
      onActivado();
    } catch (e) {
      setErr(e.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="mfa-pasos">
      <div className="mfa-paso">
        <span className="num">1</span>
        <div className="contenido">
          <b>Instale una app autenticadora</b>
          <p>Google Authenticator, Microsoft Authenticator o similar, en su celular.</p>
        </div>
      </div>
      <div className="mfa-paso">
        <span className="num">2</span>
        <div className="contenido">
          <b>Escanee el código QR</b>
          <p>O ingrese la llave a mano en la app.</p>
          {qr && <img className="mfa-qr" src={qr} alt="Código QR para configurar la app autenticadora" />}
          <button type="button" className="enlace" style={{ marginTop: 6 }}
                  onClick={() => setMostrarLlave((v) => !v)}>
            {mostrarLlave ? "Ocultar llave" : "Mostrar llave secreta"}
          </button>
          {mostrarLlave && <p className="mfa-llave-secreta">{llave}</p>}
        </div>
      </div>
      <div className="mfa-paso">
        <span className="num">3</span>
        <div className="contenido">
          <b>Ingrese el código</b>
          <p>El código de 6 dígitos que muestra la app en este momento.</p>
          <input value={codigo} inputMode="numeric" placeholder="Código"
                 onChange={(e) => setCodigo(e.target.value)}
                 aria-label="Código de la app autenticadora"
                 style={{ width: "100%", padding: "11px 13px", marginTop: 8,
                          border: "1px solid var(--borde)", borderRadius: 12 }} />
        </div>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="grilla-botones">
        <button className="btn" onClick={confirmar} disabled={!codigo || cargando}>
          {cargando ? "Activando…" : "Activar"}
        </button>
        {onCancelar && <button className="btn gris" onClick={onCancelar}>{textoCancelar}</button>}
      </div>
    </div>
  );
}
