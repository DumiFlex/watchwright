import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { unzip } from "./zip.js";

// A full ffmpeg Watchwright fetches for itself, so videos can be finished on the graphics card
// without installing anything by hand (see docs/research/smooth-videos.md). It comes from the
// BtbN FFmpeg builds (GPL, with NVIDIA, Intel and AMD encoders), the release branch's newest build,
// checked against the checksum list published beside it, and goes into the data folder:
// `<data>/tools/ffmpeg/ffmpeg(.exe)`. Nothing is added to the PATH and no admin rights are needed.

/** Where the builds come from. */
export const FFMPEG_RELEASES = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest";
/** The ffmpeg release branch fetched. */
export const FFMPEG_BRANCH = "8.1";

export interface FfmpegBuild {
  /** The file on the release page. */
  asset: string;
  /** The ffmpeg binary inside it. */
  binary: string;
  /** Roughly how big the download is, for the button. */
  bytes: number;
}

/** The build for this machine, or null where there is none (macOS has no hardware AV1 encoder anyway). */
export function ffmpegBuild(platform: NodeJS.Platform = process.platform, arch: string = process.arch): FfmpegBuild | null {
  const name = (os: string, ext: string) => `ffmpeg-n${FFMPEG_BRANCH}-latest-${os}-gpl-${FFMPEG_BRANCH}${ext}`;
  if (platform === "win32" && arch === "x64") {
    const asset = name("win64", ".zip");
    return { asset, binary: `${asset.slice(0, -4)}/bin/ffmpeg.exe`, bytes: 195_000_000 };
  }
  if (platform === "linux" && (arch === "x64" || arch === "arm64")) {
    const asset = name(arch === "x64" ? "linux64" : "linuxarm64", ".tar.xz");
    return { asset, binary: `${asset.slice(0, -7)}/bin/ffmpeg`, bytes: 130_000_000 };
  }
  return null;
}

/** The folder a fetched ffmpeg lives in. */
export const ffmpegToolDir = (dataDir: string) => path.join(dataDir, "tools", "ffmpeg");
const binaryName = (platform: NodeJS.Platform) => (platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

/** The fetched ffmpeg, if there is one. */
export function downloadedFfmpeg(dataDir: string, platform: NodeJS.Platform = process.platform): string | null {
  const file = path.join(ffmpegToolDir(dataDir), binaryName(platform));
  return existsSync(file) ? file : null;
}

/** The checksum a `checksums.sha256` list gives `asset`, or null. */
export function checksumFor(list: string, asset: string): string | null {
  for (const line of list.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (m && m[2] === asset) return m[1]!.toLowerCase();
  }
  return null;
}

export class FfmpegDownloadError extends Error {}

export interface DownloadOptions {
  dataDir: string;
  build: FfmpegBuild;
  platform?: NodeJS.Platform;
  base?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /** Bytes so far, and the whole when the server says it. */
  onProgress?: (done: number, total: number | null) => void;
  /** Unpacks `archive` and returns the ffmpeg in it (tests swap it). */
  extract?: (archive: string, build: FfmpegBuild, into: string) => Buffer;
  /** Checks the binary runs (tests swap it). */
  check?: (file: string) => string | null;
}

/** Takes the ffmpeg binary out of a zip (Windows) or a .tar.xz (Linux, through `tar`). */
export function extractFfmpeg(archive: string, build: FfmpegBuild, into: string): Buffer {
  if (build.asset.endsWith(".zip")) {
    const entries = unzip(readFileSync(archive), { only: (name) => name === build.binary });
    const found = entries.find((e) => e.name === build.binary);
    if (!found) throw new FfmpegDownloadError(`The download has no ${build.binary}.`);
    return found.data;
  }
  const out = spawnSync("tar", ["-xJf", archive, "-C", into, build.binary], { encoding: "utf8", timeout: 120_000 });
  if (out.status !== 0) throw new FfmpegDownloadError(`Couldn't unpack the download with tar: ${(out.stderr || out.error?.message || "").trim()}`);
  const file = path.join(into, ...build.binary.split("/"));
  const data = readFileSync(file);
  rmSync(path.join(into, build.binary.split("/")[0]!), { recursive: true, force: true });
  return data;
}

/** What `ffmpeg -version` says first, or null when it doesn't run. */
export function ffmpegVersion(file: string): string | null {
  const out = spawnSync(file, ["-hide_banner", "-version"], { encoding: "utf8", windowsHide: true, timeout: 20_000 });
  if (out.status !== 0) return null;
  return `${out.stdout ?? ""}`.split(/\r?\n/)[0]?.trim() || null;
}

/**
 * Fetches the build, checks its SHA-256 against the release's list, and puts its ffmpeg into the
 * tools folder. Resolves with the binary's path; throws FfmpegDownloadError with what went wrong.
 */
export async function downloadFfmpeg(o: DownloadOptions): Promise<string> {
  const get = o.fetch ?? fetch;
  const base = o.base ?? FFMPEG_RELEASES;
  const platform = o.platform ?? process.platform;
  const dir = ffmpegToolDir(o.dataDir);
  mkdirSync(dir, { recursive: true });
  const part = path.join(dir, `${o.build.asset}.part`);
  try {
    const sums = await get(`${base}/checksums.sha256`, { signal: o.signal ?? null });
    if (!sums.ok) throw new FfmpegDownloadError(`The checksum list answered ${sums.status}.`);
    const want = checksumFor(await sums.text(), o.build.asset);
    if (!want) throw new FfmpegDownloadError(`The checksum list has no ${o.build.asset}.`);

    const res = await get(`${base}/${o.build.asset}`, { signal: o.signal ?? null });
    if (!res.ok || !res.body) throw new FfmpegDownloadError(`The download answered ${res.status}.`);
    const total = Number(res.headers.get("content-length")) || null;
    const hash = createHash("sha256");
    const file = createWriteStream(part);
    let done = 0;
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        hash.update(chunk);
        done += chunk.length;
        if (!file.write(chunk)) await new Promise<void>((r) => file.once("drain", () => r()));
        o.onProgress?.(done, total);
      }
    } finally {
      await new Promise<void>((r) => file.end(r));
    }
    if (hash.digest("hex") !== want) throw new FfmpegDownloadError("The download doesn't match its checksum; nothing was installed.");

    const data = (o.extract ?? extractFfmpeg)(part, o.build, dir);
    const target = path.join(dir, binaryName(platform));
    const fresh = `${target}.new`;
    writeFileSync(fresh, data);
    if (platform !== "win32") chmodSync(fresh, 0o755);
    if (!(o.check ?? ffmpegVersion)(fresh)) {
      rmSync(fresh, { force: true });
      throw new FfmpegDownloadError("The downloaded ffmpeg doesn't run here (an antivirus may have blocked it).");
    }
    renameSync(fresh, target);
    return target;
  } catch (err) {
    if (err instanceof FfmpegDownloadError) throw err;
    if (o.signal?.aborted) throw new FfmpegDownloadError("The download was stopped.");
    throw new FfmpegDownloadError(`The download failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    rmSync(part, { force: true });
  }
}

/** Removes a fetched ffmpeg. */
export function removeDownloadedFfmpeg(dataDir: string): void {
  rmSync(ffmpegToolDir(dataDir), { recursive: true, force: true });
}
