import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const projectFile = (relativePath: string) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

test("metadata, test runner, and development endpoint are internally consistent", () => {
  const packageJson = JSON.parse(projectFile("package.json")) as {
    version: string;
    license: string;
    scripts: Record<string, string>;
    engines: { node: string };
  };
  const packageLock = JSON.parse(projectFile("package-lock.json")) as {
    version: string;
    packages: Record<string, { version?: string; license?: string }>;
  };
  const tauriConfig = JSON.parse(projectFile("src-tauri/tauri.conf.json")) as {
    version: string;
    build: { devUrl: string };
  };
  const cargoToml = projectFile("src-tauri/Cargo.toml");
  const cargoLock = projectFile("src-tauri/Cargo.lock");
  const releaseWorkflow = projectFile(".github/workflows/release.yml");
  const readme = projectFile("README.md");
  const changelog = projectFile("CHANGELOG.md");
  const license = projectFile("LICENSE");
  const notice = projectFile("NOTICE");

  const currentVersion = packageJson.version;
  assert.equal(packageLock.version, currentVersion);
  assert.equal(packageLock.packages[""].version, currentVersion);
  assert.equal(packageJson.license, "MIT");
  assert.equal(packageLock.packages[""].license, "MIT");
  assert.equal(tauriConfig.version, currentVersion);
  assert.match(cargoToml, new RegExp(`^version = "${currentVersion}"$`, "m"));
  assert.match(cargoToml, /^license = "MIT"$/m);
  assert.match(cargoLock, new RegExp(`name = "markdown-editor"\\r?\\nversion = "${currentVersion}"`));
  assert.equal(tauriConfig.build.devUrl, "http://localhost:3000");
  assert.equal(
    packageJson.scripts.test,
    "tsc --project tsconfig.test.json --noEmit && node --experimental-strip-types --test src/lib/*.test.ts",
  );
  assert.equal(packageJson.engines.node, ">=22.6.0");
  assert.match(releaseWorkflow, /Markdown Editor v__VERSION__/);
  assert.doesNotMatch(releaseWorkflow, /v1\.0\.5/);
  assert.match(readme, new RegExp(`## Current release: v${currentVersion.replace(/\./g, "\\.")}`));
  assert.match(readme, /releases\/latest/);
  assert.match(readme, /Node\.js 22\.6\+/);
  assert.doesNotMatch(readme, /releases\/tag\/v1\.0\.5/);
  assert.match(changelog, /^## \[1\.0\.6\] - 2026-08-01$/m);
  assert.match(license, /^MIT License$/m);
  assert.match(license, /Copyright \(c\) 2026 Ali Mozaffari/);
  assert.match(notice, /Scratch by Eric Li/);
  assert.match(notice, /https:\/\/github\.com\/erictli\/scratch/);
});
