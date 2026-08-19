import Icono from "./Iconos";

// Los 4 requisitos reales de la política de clave del User Pool de
// Cognito (mín. 8, mayúscula, minúscula, número - SIN símbolo
// obligatorio, a diferencia del ejemplo de 5 requisitos de AWS: mostrar
// un quinto check por un requisito que Cognito en realidad no exige
// sería mentirle a quien está llenando el formulario).
const _REQUISITOS = [
  { id: "longitud", texto: "Al menos 8 caracteres", prueba: (c) => c.length >= 8 },
  { id: "mayuscula", texto: "Una letra mayúscula", prueba: (c) => /[A-Z]/.test(c) },
  { id: "minuscula", texto: "Una letra minúscula", prueba: (c) => /[a-z]/.test(c) },
  { id: "numero", texto: "Un número", prueba: (c) => /[0-9]/.test(c) },
];

export function claveCumplePolitica(clave) {
  return _REQUISITOS.every((r) => r.prueba(clave));
}

/** Checklist en vivo (como el de la propia pantalla de registro de
    Cognito): cada requisito pasa a verde con un check apenas se cumple,
    en vez de un solo mensaje de error genérico al enviar el formulario. */
export default function ChecklistClave({ clave }) {
  return (
    <ul className="checklist-clave">
      {_REQUISITOS.map((r) => {
        const ok = r.prueba(clave);
        return (
          <li key={r.id} className={ok ? "ok" : ""}>
            {ok ? <Icono nombre="check" tam={14} /> : <span className="circulo" />}
            {r.texto}
          </li>
        );
      })}
    </ul>
  );
}
