import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const pngAssets = [
  "app-icon.png",
  "docs/app-icon.png",
  "docs/screenshot.png",
  "public/folders-dark.png",
  "public/note-dark.png",
  "src-tauri/icons/128x128.png",
  "src-tauri/icons/128x128@2x.png",
  "src-tauri/icons/32x32.png",
  "src-tauri/icons/64x64.png",
  "src-tauri/icons/Square107x107Logo.png",
  "src-tauri/icons/Square142x142Logo.png",
  "src-tauri/icons/Square150x150Logo.png",
  "src-tauri/icons/Square284x284Logo.png",
  "src-tauri/icons/Square30x30Logo.png",
  "src-tauri/icons/Square310x310Logo.png",
  "src-tauri/icons/Square44x44Logo.png",
  "src-tauri/icons/Square71x71Logo.png",
  "src-tauri/icons/Square89x89Logo.png",
  "src-tauri/icons/StoreLogo.png",
  "src-tauri/icons/icon.png",
];

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("native packaging PNG assets retain valid binary signatures", () => {
  for (const asset of pngAssets) {
    const bytes = readFileSync(resolve(process.cwd(), asset));
    assert.deepEqual(bytes.subarray(0, pngSignature.length), pngSignature, asset);
  }
});

test("Windows NSIS installer uses the branded application icon", () => {
  const config = JSON.parse(
    readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
  );
  const installerIcon = config.bundle?.windows?.nsis?.installerIcon;

  assert.equal(installerIcon, "icons/icon.ico");

  const icon = readFileSync(resolve(process.cwd(), "src-tauri", installerIcon));
  assert.deepEqual(icon.subarray(0, 4), Buffer.from([0, 0, 1, 0]));
});
