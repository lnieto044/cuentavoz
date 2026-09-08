# Guion de presentación · CuentaVoz

**10 minutos exactos · 16 diapositivas · Luis y Diana**

> El reparto aprovecha algo que ya tienen a favor: la plataforma tiene dos
> perfiles y ustedes son dos. **Luis presenta y demuestra como auxiliar de
> inventarios; Diana cierra el ciclo como administradora de bodega.** No es
> un truco de exposición: es la operación real, contada por las dos personas
> que la viven.

---

## Antes de empezar (5 minutos antes)

- [ ] Tableta con la sesión de **luis** ya abierta en Conteo, bodega **sin abrir**.
- [ ] Segundo dispositivo o pestaña con **diana** en Auditoría.
- [ ] Probar el micrófono **una vez** con la frase de la demo.
- [ ] Volumen del computador al máximo (el agente responde hablando).
- [ ] Tener a mano: `d13g9u0pgpag0b.cloudfront.net` · `luis` / `diana` · `StockXperts1`

---

## 1 · Portada — **LUIS** — 0:20

> «Buenos días. Somos StockXperts. Yo soy Luis, ella es Diana.
> Traemos **CuentaVoz**: contar el inventario hablando, en vez de escribiendo.
> En diez minutos se lo mostramos funcionando con los datos reales de ustedes.»

**No lea la diapositiva.** Es la portada, ya se ve.

---

## 2 · El conteo manual cuesta caro — **LUIS** — 0:40

> «Hoy el inventario de una bodega se toma en papel. Alguien camina con una
> planilla, anota, y después otra persona lo digita en el sistema.
>
> Eso tiene tres costos: **tiempo** —se hace dos veces—, **errores** —de
> letra, de digitación— y **demora**: la diferencia se descubre semanas
> después, cuando ya nadie se acuerda de qué pasó.»

Pausa corta antes de pasar.

---

## 3 · La solución, en una frase — **LUIS** — 0:30

> «Voz, inteligencia artificial y validaciones automáticas.
> La persona habla, el sistema entiende, valida contra el inventario y guarda.
> **Una sola vez, en el sitio, y validado en el momento.**»

---

## 4 · Cómo piensa el agente — **DIANA** — 0:40

> «Cada vez que alguien habla pasan cinco pasos: escucha, interpreta,
> resuelve el artículo contra el catálogo oficial, valida y confirma.
>
> Y algo importante: **el modelo interpreta, pero el que decide es el
> backend**. La inteligencia artificial no escribe en la base de datos —
> propone, y unas reglas en código deciden si eso entra o no.»

Ese matiz tranquiliza a quien pregunta por confiabilidad de la IA.

---

## 5 · Tres momentos, una sola plataforma — **DIANA** — 0:40

> «No es solo contar. Son los tres momentos del ciclo: **el pedido** al
> almacén calculado por receta, **el conteo** de la bodega, y **la
> legalización** del servicio al final del turno.
>
> Todo sin salir de la misma aplicación, con la misma voz.»

---

## 6 · DEMO EN VIVO — **LUIS cuenta, DIANA cierra** — 2:00

**⚠️ No use las capturas. Abra la tableta.**

**LUIS (1:10)** — como auxiliar:

1. «Entro como auxiliar. Solo veo **mis** bodegas asignadas, ninguna más.»
2. Abre una bodega. «Ya está abierta, con sus 133 referencias.»
3. Toca el micrófono y dicta despacio:
   **«papa criolla veinte kilos»**
4. «Me repite lo que entendió y me pide confirmar.» → confirma.
5. Si sale una diferencia: «Aquí me avisa que el sistema esperaba otra
   cantidad. **Esto es el hallazgo**: se ve ahora, no en tres semanas.»
6. «Cuando termino, firmo mi conteo.» → toca **Terminar y firmar mi conteo**.

**DIANA (0:50)** — como administradora:

7. «Yo recibo esa bodega firmada y hago el **recuento ciego**: cuento sin ver
   sus números.»
8. Muestra la comparación. «Aquí se revelan las tres columnas: el sistema,
   lo que contó Luis, lo que conté yo.»
9. «Y se cierra con **doble firma**. Ninguno de los dos puede cerrar solo.»

> **Si el micrófono falla:** toque **Teclado** y escriba la misma frase.
> Es el respaldo real de la aplicación, no una excusa — dígalo así:
> «así funciona en una bodega con ruido».

---

## 7 · Nada se guarda sin validar — **LUIS** — 0:40

> «Lo que acaban de ver validó cuatro cosas sin que yo hiciera nada:
> que el artículo existe en el catálogo, que la unidad es la correcta, que
> la cantidad tiene sentido, y que yo tenía permiso sobre esa bodega.
>
> Si algo no cuadra, **no se detiene el conteo**: queda marcado y sigue.»

---

## 8 · Arquitectura — **DIANA** — 0:40

> «Está en **AWS**: el frontend en S3 con CloudFront, el backend en EC2 con
> Docker, la base en RDS. La misma nube que ya usa Colsubsidio, así que no
> hay nada que migrar.
>
> Y cada cambio pasa por **149 pruebas automáticas antes de desplegarse**.
> Si una falla, no llega a producción.»

Es la lámina donde más preguntan. No se extienda: si preguntan, hay tiempo al final.

---

## 9 · Datos reales — **DIANA** — 0:30

> «Nada de esto es una maqueta: son **las 54 bodegas** de ustedes, **1.041
> artículos** del catálogo oficial y **1.405 registros** de stock.
>
> Al cargarlo, el sistema encontró solo **79 saldos negativos** — inventario
> que el sistema dice tener en menos que cero.»

---

## 10 · Seguridad — **LUIS** — 0:30

> «La identidad la maneja **AWS Cognito**, con verificación en dos pasos
> opcional. La clave nunca pasa por nuestro servidor.
>
> Y **nada se borra**: una corrección crea un registro nuevo que apunta al
> original. La trazabilidad es completa.»

---

## 11 · Qué significa para Colsubsidio — **LUIS** — 0:30

> «Decisiones con datos reales, no con memoria ni planillas sueltas.
> El auxiliar recupera tiempo, el administrador ve el estado en vivo.»

Una idea. No enumere las tres viñetas: escoja la que más le importe a quien tiene enfrente.

---

## 12 · Costo — **DIANA** — 0:30

> «No hay licencias por usuario. Sumar una bodega o veinte personas más no
> cuesta más. Se paga la infraestructura y el consumo de la IA por uso.»

---

## 13 · Adopción — **DIANA** — 0:30

> «Hoy: prototipo real desplegado y funcionando.
> Próximo paso: cargar el archivo oficial de recetas y un piloto guiado en
> un grupo de bodegas.
> Visión: toda la operación de hotelería, integrada con My Inventory.»

---

## 14 · Qué necesitamos hoy — **LUIS** — 0:40

**Esta es la lámina que no se sacrifica.** Si va corto de tiempo, recorte la 11 o la 12, nunca esta.

> «Para pasar del prototipo al piloto necesitamos cuatro cosas concretas:
> un **sponsor** dentro de Operaciones, un **grupo de bodegas** para el
> piloto, el **archivo oficial de recetas**, y **acceso a My Inventory**
> para cerrar el ciclo.»

Mire a la persona que puede decir que sí.

---

## 15 · Equipo — **DIANA** — 0:15

> «Somos el equipo StockXperts. Esto lo construimos nosotros, de cero.»

---

## 16 · Gracias — **LUIS** — 0:15

> «Ahí está la dirección para que lo prueben ustedes mismos, con estas
> cuentas. Quedamos atentos a sus preguntas.»

**Deje la diapositiva 16 puesta** durante las preguntas: tiene la URL, las
cuentas y el contacto.

---

## Control de tiempo

| Corte | Deberían ir en |
|---|---|
| Terminando la 5 | **2:50** |
| Saliendo de la demo | **4:50** |
| Terminando la 10 | **7:10** |
| Empezando la 14 | **8:40** |
| Cierre | **9:50** |

Si a los **5:00** no han salido de la demo, córtela y siga. La demo es lo
más fuerte, pero quedarse sin llegar a la 14 es perder el pedido.

---

## Preguntas que probablemente hagan

**«¿Qué pasa si no hay señal en la bodega?»** — Luis
> «El conteo no se detiene. Se guarda en la tableta y se sincroniza solo al
> volver la conexión. Es una PWA real.»

**«¿Y si la IA entiende mal?»** — Diana
> «Confirma antes de guardar, siempre. Y si el nombre se parece a varios
> artículos, muestra las opciones para que la persona elija. El modelo
> propone; nunca escribe solo.»

**«¿Esto reemplaza a My Inventory?»** — Diana
> «No. Lo alimenta. Hoy comparamos contra el extracto que ustedes nos dieron;
> el siguiente paso es la integración directa.»

**«¿Cuánto cuesta?»** — Diana
> «Infraestructura AWS y consumo de IA por uso. Sin licencias por usuario.»

**«¿Por qué la exactitud es del 88%?»** — Luis
> «Porque 12 de cada 100 referencias estaban descuadradas **antes** de que
> llegáramos. Ese número no mide qué tan bien contamos: mide qué tan lejos
> estaba el sistema de la bodega. Encontrarlo es el valor.»

**«¿Es accesible?»** — Luis
> «Sí, y está medido: cero incumplimientos WCAG A/AA en las 17 pantallas,
> con axe-core. Navegación completa por teclado, alto contraste y tamaño de
> letra ajustable.»
