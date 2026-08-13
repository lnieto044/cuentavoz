// Bug real, encontrado en producción: "sí" (como lo transcribe la voz,
// CON tilde) nunca hacía match contra /^(si|sí|...)\b/ porque en
// JavaScript \b y \w son ASCII puros - "í" no cuenta como letra, así que
// la frontera de palabra justo después de la tilde no se reconocía.
// Corre con: node --test src/*.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { quitarTildes, esAfirmacion, esNegacion } from "./confirmacionVoz.js";

test("quitarTildes deja sí como si", () => {
  assert.equal(quitarTildes("sí"), "si");
});
test("quitarTildes no toca palabras sin tilde", () => {
  assert.equal(quitarTildes("confirmo"), "confirmo");
});

test("si con tilde SI confirma (el bug real reportado)", () => {
  assert.equal(esAfirmacion("sí"), true);
});
test("Si con tilde y mayuscula y punto, como lo entrega la voz", () => {
  assert.equal(esAfirmacion("Sí."), true);
});
test("si sin tilde tambien confirma", () => {
  assert.equal(esAfirmacion("si"), true);
});
test("confirmo confirma", () => {
  assert.equal(esAfirmacion("confirmo"), true);
});
test("asi es (con y sin tilde) confirma", () => {
  assert.equal(esAfirmacion("así es"), true);
  assert.equal(esAfirmacion("asi es"), true);
});
test("una palabra extra del contexto (ver) confirma solo si se pasa", () => {
  assert.equal(esAfirmacion("ver"), false);
  assert.equal(esAfirmacion("ver", ["ver"]), true);
});
test("no NO confirma aunque diga sí en otra parte de la frase", () => {
  assert.equal(esAfirmacion("no, mejor sí despues"), false);
});
test("una frase sin nada reconocible no confirma", () => {
  assert.equal(esAfirmacion("no le entendi"), false);
  assert.equal(esAfirmacion("kiosco taquilla ayb"), false);
});
test("vacio no confirma", () => {
  assert.equal(esAfirmacion(""), false);
});

test("no limpio niega", () => {
  assert.equal(esNegacion("no"), true);
  assert.equal(esNegacion("No."), true);
});
test("no en medio de la frase no cuenta como negacion limpia", () => {
  assert.equal(esNegacion("no se, tal vez"), true); // "no" es la primera palabra
  assert.equal(esNegacion("mejor no"), false);       // "no" no es la primera palabra
});
test("si no niega", () => {
  assert.equal(esNegacion("sí"), false);
});
