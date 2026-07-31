import assert from "node:assert/strict";
import test from "node:test";
import { formatAppVersion } from "./appVersion.ts";

test("app version labels use the packaged runtime version", () => {
  assert.equal(formatAppVersion("1.0.5"), "v1.0.5");
});

test("app version labels remain intelligible when the runtime version is unavailable", () => {
  assert.equal(formatAppVersion(""), "Version unavailable");
  assert.equal(formatAppVersion(null), "Version unavailable");
});
