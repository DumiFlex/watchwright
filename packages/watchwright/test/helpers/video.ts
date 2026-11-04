import { spawnSync } from "node:child_process";

/** A video's size as ffmpeg reads it ("640x400"), or null. */
export function videoSize(ffmpeg: string, file: string): string | null {
  const out = spawnSync(ffmpeg, ["-hide_banner", "-i", file], { encoding: "utf8" });
  return /Video: [^\n]*?(\d{2,5}x\d{2,5})/.exec(out.stderr ?? "")?.[1] ?? null;
}
