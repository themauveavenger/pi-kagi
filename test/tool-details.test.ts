import assert from "node:assert/strict";
import { test } from "node:test";
import { readKagiSource } from "../src/tool-details.ts";

test("readKagiSource reads the source a Kagi tool recorded", () => {
  assert.equal(readKagiSource({ kagi: { source: "cache" } }), "cache");
  assert.equal(readKagiSource({ kagi: { source: "paid" } }), "paid");
});

test("readKagiSource returns undefined for anything that isn't the Kagi details shape", () => {
  assert.equal(readKagiSource(undefined), undefined, "a tool result with no details");
  assert.equal(readKagiSource(null), undefined, "null details");
  assert.equal(readKagiSource("oops"), undefined, "a non-object details value");
  assert.equal(readKagiSource({}), undefined, "details from an unrelated tool");
  assert.equal(readKagiSource({ kagi: null }), undefined, "a null kagi field");
  assert.equal(readKagiSource({ kagi: "oops" } as never), undefined, "a non-object kagi field");
  assert.equal(readKagiSource({ kagi: { source: "free" } } as never), undefined, "an unrecognised source value");
});
