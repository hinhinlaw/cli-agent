import assert from "node:assert/strict";
import test from "node:test";
import { validateManifest } from "./manifest.js";

test("validateManifest passes for a valid minimal manifest", () => {
  const result = validateManifest({
    id: "builtin/test",
    name: "Test Plugin",
    version: "0.1.0"
  });
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
});

test("validateManifest fails when manifest is not an object", () => {
  const result = validateManifest(null);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes("must be an object")));
});

test("validateManifest fails when array is passed", () => {
  const result = validateManifest([1, 2, 3]);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes("must be an object")));
});

test("validateManifest fails when id is missing", () => {
  const result = validateManifest({
    name: "No ID",
    version: "1.0.0"
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes("'id'")));
});

test("validateManifest fails when id is empty string", () => {
  const result = validateManifest({
    id: "",
    name: "Empty ID",
    version: "1.0.0"
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes("'id'")));
});

test("validateManifest fails when name is missing", () => {
  const result = validateManifest({
    id: "test/plugin",
    version: "1.0.0"
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes("'name'")));
});

test("validateManifest fails when version is not semver", () => {
  const result = validateManifest({
    id: "test/plugin",
    name: "Bad Ver",
    version: "not-a-version"
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes("'version'")));
});

test("validateManifest accepts semver with pre-release suffix", () => {
  const result = validateManifest({
    id: "test/plugin",
    name: "Pre-release",
    version: "0.1.0-beta.1"
  });
  assert.equal(result.ok, true);
});

test("validateManifest accepts semver with build metadata", () => {
  const result = validateManifest({
    id: "test/plugin",
    name: "Build Meta",
    version: "1.2.3+build.456"
  });
  assert.equal(result.ok, true);
});

test("validateManifest rejects version with only major.minor", () => {
  const result = validateManifest({
    id: "test/plugin",
    name: "Incomplete",
    version: "1.0"
  });
  assert.equal(result.ok, false);
});

test("validateManifest fails when contributes.hooks contains unknown hook point", () => {
  const result = validateManifest({
    id: "test/plugin",
    name: "Bad Hook",
    version: "1.0.0",
    contributes: {
      hooks: ["preToolUse", "unknownHook"]
    }
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes("Unknown hook point")));
  // preToolUse is valid and should not trigger an error
  assert.ok(result.errors.some(e => e.includes("unknownHook")));
});

test("validateManifest succeeds when contributes.hooks only contains valid hook points", () => {
  const result = validateManifest({
    id: "test/plugin",
    name: "Good Hook",
    version: "1.0.0",
    contributes: {
      hooks: ["preToolUse"]
    }
  });
  assert.equal(result.ok, true);
});

test("validateManifest warns for dangerous permissions (shell, network)", () => {
  const result = validateManifest({
    id: "test/plugin",
    name: "Dangerous",
    version: "1.0.0",
    permissions: [
      { capability: "shell", reason: "needs shell" },
      { capability: "network", reason: "needs network" },
      { capability: "filesystem", reason: "needs fs" }
    ]
  });
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 2);
  assert.ok(result.warnings.some(w => w.includes("shell")));
  assert.ok(result.warnings.some(w => w.includes("network")));
  assert.ok(!result.warnings.some(w => w.includes("filesystem")));
});

test("validateManifest handles missing optional fields gracefully", () => {
  const result = validateManifest({
    id: "minimal/ok",
    name: "Minimal",
    version: "1.0.0"
    // no contributes, no permissions, no requires
  });
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 0);
});
