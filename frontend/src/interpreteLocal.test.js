// Regresiones del intérprete local en JS: los mismos casos que
// backend/tests/test_interprete.py, para confirmar que el puerto a
// JavaScript (interpreteLocal.js) se comporta igual que el original en
// Python que corre en el servidor. Corre con: node --test src/*.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretarLocal, normalizarUnidad } from "./interpreteLocal.js";

// ── números ──
test("numero digito simple", () => {
  assert.equal(interpretarLocal("hay 12 arroces").cantidad, 12);
});
test("numero decimal con punto", () => {
  assert.equal(interpretarLocal("hay 2.5 kilos de arroz").cantidad, 2.5);
});
test("numero decimal con coma", () => {
  assert.equal(interpretarLocal("hay 2,5 kilos de arroz").cantidad, 2.5);
});
test("numero negativo con menos", () => {
  assert.equal(interpretarLocal("hay menos 5 cazuelas").cantidad, -5);
});
test("numero en palabras simple", () => {
  assert.equal(interpretarLocal("hay cinco cazuelas").cantidad, 5);
});
test("numero compuesto decena y unidad", () => {
  assert.equal(interpretarLocal("hay treinta y cinco tablas").cantidad, 35);
});
test("numero compuesto centena y decena", () => {
  assert.equal(interpretarLocal("hay ciento ochenta unidades").cantidad, 180);
});
test("numero en palabras mil", () => {
  assert.equal(interpretarLocal("hay mil servilletas").cantidad, 1000);
});
test("numero en palabras con menos", () => {
  assert.equal(interpretarLocal("hay menos cinco cazuelas").cantidad, -5);
});
test("sin numero ni palabra clave cae en ayuda", () => {
  const r = interpretarLocal("no logro ver nada aqui");
  assert.equal(r.intencion, "ayuda");
  assert.equal(r.cantidad ?? null, null);
});

// ── unidades ──
test("unidad kilo variantes", () => {
  for (const palabra of ["kilo", "kilos", "kilogramo", "kilogramos", "kg"]) {
    assert.equal(interpretarLocal(`hay 3 ${palabra} de arroz`).unidad, "Kilogram");
  }
});
test("unidad litro variantes", () => {
  for (const palabra of ["litro", "litros", "l"]) {
    assert.equal(interpretarLocal(`hay 3 ${palabra} de aceite`).unidad, "Liter");
  }
});
test("unidad no reconocida es null", () => {
  assert.equal(interpretarLocal("hay 3 cazuelas blancas").unidad, null);
});
test("normalizarUnidad pasa canonicas intactas", () => {
  assert.equal(normalizarUnidad("Kilogram"), "Kilogram");
});
test("normalizarUnidad traduce lo dicho", () => {
  assert.equal(normalizarUnidad("kilos"), "Kilogram");
  assert.equal(normalizarUnidad("litros"), "Liter");
  assert.equal(normalizarUnidad("unidades"), "Unidad");
  assert.equal(normalizarUnidad("porciones"), "Portion");
});
test("normalizarUnidad desconocida se devuelve igual", () => {
  assert.equal(normalizarUnidad("bultos"), "bultos");
});
test("normalizarUnidad vacia", () => {
  assert.equal(normalizarUnidad(null), null);
  assert.equal(normalizarUnidad(""), "");
});

// ── intenciones ──
test("intencion navegar iniciar conteo", () => {
  const r = interpretarLocal("iniciar conteo en almacen ayb");
  assert.equal(r.intencion, "navegar");
});
test("intencion navegar abrir bodega", () => {
  assert.equal(interpretarLocal("abrir bodega restaurante fuentes").intencion, "navegar");
});
test("intencion pedir con porciones", () => {
  const r = interpretarLocal("hoy preparamos cincuenta ajiacos");
  assert.equal(r.intencion, "pedir");
  assert.equal(r.porciones, 50);
});
test("intencion pedir sin porciones queda en cero", () => {
  const r = interpretarLocal("vamos a preparar sancocho");
  assert.equal(r.intencion, "pedir");
  assert.equal(r.porciones, 0);
});
test("intencion confirmar variantes", () => {
  for (const frase of ["confirmo", "si", "sí", "correcto"]) {
    assert.equal(interpretarLocal(frase).intencion, "confirmar");
  }
});
test("intencion corregir variantes", () => {
  for (const frase of ["no son esos, corregir", "uy no, esta mal", "cambiar la cantidad"]) {
    assert.equal(interpretarLocal(frase).intencion, "corregir");
  }
});
test("intencion consultar", () => {
  const r = interpretarLocal("cuanto arroz hay");
  assert.equal(r.intencion, "consultar");
  assert.ok(r.articulo_texto.includes("arroz"));
});
test("intencion reporte", () => {
  for (const frase of ["generame el reporte", "el consolidado por favor", "imprimeme el archivo"]) {
    assert.equal(interpretarLocal(frase).intencion, "reporte");
  }
});
test("intencion ayuda explicita", () => {
  for (const frase of ["ayuda", "no entiendo"]) {
    assert.equal(interpretarLocal(frase).intencion, "ayuda");
  }
});
test("intencion contar con cantidad y articulo", () => {
  const r = interpretarLocal("hay noventa cazuelas blancas");
  assert.equal(r.intencion, "contar");
  assert.equal(r.cantidad, 90);
});
test("intencion desconocida pide repetir", () => {
  const r = interpretarLocal("xyzzy blorp qwerty");
  assert.equal(r.intencion, "ayuda");
  assert.ok(r.respuesta_hablada.toLowerCase().includes("repite"));
});
test("articulo_texto sin ruido quita palabras vacias", () => {
  const r = interpretarLocal("hay noventa cazuelas blancas");
  const palabras = r.articulo_texto.split(" ");
  assert.ok(!palabras.includes("hay"));
  assert.ok(!palabras.includes("noventa"));
});

// ── casos propios del puerto a JS (ambiguedad centena/decena real) ──
test("arroz vs arroz basmati: frase completa se limpia igual que en Python", () => {
  const r = interpretarLocal("hay noventa arroces");
  assert.equal(r.cantidad, 90);
  assert.ok(r.articulo_texto.includes("arroces"));
});
