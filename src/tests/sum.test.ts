import assert from "node:assert/strict";
import test from "node:test";
import { sum } from "./sum.js";

test("sum(1, 2) returns 3", () => {
  assert.equal(sum(1, 2), 3);
});

test("sum(-1, 5) returns 4", () => {
  assert.equal(sum(-1, 5), 4);
});
