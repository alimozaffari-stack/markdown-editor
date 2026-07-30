import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const authorisedLogoHash =
  "d691f79514008edc3bbfcb5eec50592fae725a6f31c6f6c674a62a19edbfc38f";
const canonicalLogoAssets = [
  "app-icon.png",
  "docs/app-icon.png",
  "public/markdown-editor-logo.png",
];
const nativePngAssets = readdirSync(
  resolve(process.cwd(), "src-tauri/icons"),
  { recursive: true },
)
  .filter((path) => path.toString().endsWith(".png"))
  .map((path) => `src-tauri/icons/${path.toString()}`);
const pngSignature = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function fileBytes(path: string): Buffer {
  return readFileSync(resolve(process.cwd(), path));
}

test("canonical and runtime logos exactly match the authorised PNG", () => {
  for (const asset of canonicalLogoAssets) {
    const hash = createHash("sha256").update(fileBytes(asset)).digest("hex");
    assert.equal(hash, authorisedLogoHash, asset);
  }
});

test("native packaging PNG assets retain valid binary signatures", () => {
  assert.ok(nativePngAssets.length >= 30);
  for (const asset of nativePngAssets) {
    const bytes = fileBytes(asset);
    assert.deepEqual(
      bytes.subarray(0, pngSignature.length),
      pngSignature,
      asset,
    );
  }
});

test("native desktop icon containers retain valid signatures", () => {
  assert.deepEqual(
    fileBytes("src-tauri/icons/icon.ico").subarray(0, 4),
    Buffer.from([0, 0, 1, 0]),
  );
  assert.equal(
    fileBytes("src-tauri/icons/icon.icns").subarray(0, 4).toString("ascii"),
    "icns",
  );
});

test("runtime brand uses semantic images and has no legacy masks", () => {
  const folderPicker = readFileSync(
    resolve(process.cwd(), "src/components/layout/FolderPicker.tsx"),
    "utf8",
  );
  const editor = readFileSync(
    resolve(process.cwd(), "src/components/editor/Editor.tsx"),
    "utf8",
  );
  const index = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
  const productionText = `${folderPicker}\n${editor}\n${index}`;

  assert.match(folderPicker, /<img[\s\S]+markdown-editor-logo\.png/);
  assert.match(editor, /<img[\s\S]+markdown-editor-logo\.png/);
  assert.match(
    index,
    /rel="icon" type="image\/png" href="\/markdown-editor-logo\.png"/,
  );
  assert.doesNotMatch(productionText, /folders-dark\.png|note-dark\.png/);
});

test("Windows NSIS installer uses the branded application icon", () => {
  const config = JSON.parse(
    readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
  );
  const installerIcon = config.bundle?.windows?.nsis?.installerIcon;

  assert.equal(installerIcon, "icons/icon.ico");

  const icon = fileBytes(`src-tauri/${installerIcon}`);
  assert.deepEqual(icon.subarray(0, 4), Buffer.from([0, 0, 1, 0]));
});
