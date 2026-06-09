import assert from "node:assert/strict";
import test from "node:test";
import { sum } from "./sum.js";

test("adds positive numbers", () => {
  assert.equal(sum(1, 2), 3);
});

test("adds negative and positive numbers", () => {
  assert.equal(sum(-1, 5), 4);
});
