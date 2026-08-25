import { useEffect } from "react";

/** Devuelve el foco a quien abrió un diálogo, cuando el diálogo se cierra.
 *
 *  Sin esto el foco cae en el `<body>`. Con ratón no se nota; con teclado
 *  significa volver al principio de la página y tabular otra vez hasta
 *  donde se estaba, y con lector de pantalla además no hay ninguna señal
 *  de que el diálogo se cerró, porque el foco no aterriza en nada que se
 *  anuncie.
 *
 *  Se usa de dos formas, según cómo esté hecho el diálogo:
 *  - si vive en su propio componente que se monta y desmonta con él
 *    (Dialogo, CerrarSesion, VideoRecorrido), basta `useDevolverFoco()`;
 *  - si es un bloque condicional dentro de una pantalla más grande
 *    (los tres de Ajustes), se le pasa el estado que lo abre:
 *    `useDevolverFoco(Boolean(editando))`.
 */
export function useDevolverFoco(abierto = true) {
  useEffect(() => {
    if (!abierto) return undefined;
    const disparador = document.activeElement;
    return () => {
      // `document.contains` porque el disparador puede haber desaparecido
      // mientras el diálogo estaba abierto - por ejemplo, la fila de la
      // tabla que se acaba de borrar desde el propio diálogo.
      if (disparador && document.contains(disparador)) disparador.focus();
    };
  }, [abierto]);
}
