import { getVersion } from "@tauri-apps/api/app";

export function formatAppVersion(version: string | null | undefined): string {
  const value = version?.trim();
  return value ? `v${value}` : "Version unavailable";
}

export async function getAppVersionLabel(): Promise<string> {
  try {
    return formatAppVersion(await getVersion());
  } catch {
    return formatAppVersion(null);
  }
}
