import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checksumFor, downloadedFfmpeg, downloadFfmpeg, extractFfmpeg, FfmpegDownloadError, ffmpegBuild, ffmpegToolDir, type FfmpegBuild } from "../src/jobs/ffmpeg-download.js";
import { chooseFinisher } from "../src/jobs/video-finish.js";
import { zip } from "../src/jobs/zip.js";
import { FfmpegFetcher } from "../src/plugins/runs/ffmpeg-fetch.js";
import { cleanTempDirs, tempDir } from "./helpers/fixtures.js";

afterEach(() => cleanTempDirs());

const WIN = ffmpegBuild("win32", "x64")!;
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** A fake release: the checksum list and one asset, served in small chunks. */
function release(asset: Buffer, o: { sum?: string; status?: number } = {}): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const f = async (url: string | URL | Request) => {
    const u = String(url);
    urls.push(u);
    if (u.endsWith("/checksums.sha256")) return new Response(`${o.sum ?? sha(asset)}  ${WIN.asset}\nabc  other.zip\n`);
    if (o.status) return new Response("no", { status: o.status });
    const chunks = [asset.subarray(0, 10), asset.subarray(10)];
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        const next = chunks.shift();
        if (next) c.enqueue(new Uint8Array(next));
        else c.close();
      },
    });
    return new Response(body, { headers: { "content-length": String(asset.length) } });
  };
  return { fetch: f as typeof fetch, urls };
}

const winZip = (data = Buffer.from("MZ fake ffmpeg")) =>
  zip([
    { name: `${WIN.asset.slice(0, -4)}/bin/ffprobe.exe`, data: Buffer.from("probe") },
    { name: WIN.binary, data },
  ]);

describe("Get ffmpeg", () => {
  it("knows the build for each machine", () => {
    expect(WIN.asset).toMatch(/^ffmpeg-n[\d.]+-latest-win64-gpl-[\d.]+\.zip$/);
    expect(WIN.binary).toMatch(/\/bin\/ffmpeg\.exe$/);
    expect(ffmpegBuild("linux", "x64")?.asset).toMatch(/linux64-gpl-[\d.]+\.tar\.xz$/);
    expect(ffmpegBuild("linux", "arm64")?.binary).toMatch(/linuxarm64-gpl-[\d.]+\/bin\/ffmpeg$/);
    expect(ffmpegBuild("darwin", "arm64")).toBeNull();
    expect(ffmpegBuild("win32", "arm64")).toBeNull();
  });

  it("reads a checksum list", () => {
    const list = `${"a".repeat(64)}  one.zip\r\n${"B".repeat(64)} *two.zip\n`;
    expect(checksumFor(list, "one.zip")).toBe("a".repeat(64));
    expect(checksumFor(list, "two.zip")).toBe("b".repeat(64));
    expect(checksumFor(list, "three.zip")).toBeNull();
  });

  it("takes ffmpeg.exe out of the zip alone", () => {
    const dir = tempDir("ww-ff-");
    const file = path.join(dir, WIN.asset);
    writeFileSync(file, winZip());
    expect(extractFfmpeg(file, WIN, dir).toString()).toBe("MZ fake ffmpeg");
    writeFileSync(file, zip([{ name: "other/bin/ffmpeg.exe", data: Buffer.from("x") }]));
    expect(() => extractFfmpeg(file, WIN, dir)).toThrow(FfmpegDownloadError);
  });

  it("downloads, checks the checksum, and installs the binary into the data folder", async () => {
    const dir = tempDir("ww-ff-");
    const asset = winZip();
    const { fetch, urls } = release(asset);
    const progress: number[] = [];
    const file = await downloadFfmpeg({ dataDir: dir, build: WIN, platform: "win32", base: "https://x/r", fetch, check: () => "ffmpeg version 8.1", onProgress: (d) => progress.push(d) });
    expect(file).toBe(path.join(ffmpegToolDir(dir), "ffmpeg.exe"));
    expect(readFileSync(file).toString()).toBe("MZ fake ffmpeg");
    expect(urls).toEqual(["https://x/r/checksums.sha256", `https://x/r/${WIN.asset}`]);
    expect(progress.at(-1)).toBe(asset.length);
    expect(downloadedFfmpeg(dir, "win32")).toBe(file);
    // Nothing but the binary is left behind.
    expect(existsSync(path.join(ffmpegToolDir(dir), `${WIN.asset}.part`))).toBe(false);
  });

  it("installs nothing when the checksum, the answer or the binary is wrong", async () => {
    const dir = tempDir("ww-ff-");
    const asset = winZip();
    const base = { dataDir: dir, build: WIN, platform: "win32" as const, base: "https://x/r", check: () => "ok" };
    await expect(downloadFfmpeg({ ...base, fetch: release(asset, { sum: "0".repeat(64) }).fetch })).rejects.toThrow(/checksum/);
    await expect(downloadFfmpeg({ ...base, fetch: release(asset, { status: 404 }).fetch })).rejects.toThrow(/404/);
    await expect(downloadFfmpeg({ ...base, fetch: release(asset).fetch, check: () => null })).rejects.toThrow(/doesn't run/);
    expect(downloadedFfmpeg(dir, "win32")).toBeNull();
  });

  it("is tried for the graphics card after an ffmpeg installed by hand", async () => {
    const probed: string[] = [];
    const c = await chooseFinisher("auto", {
      env: {},
      cpu: () => "/pw/ffmpeg",
      encoder: () => "libvpx-vp9",
      system: () => "/usr/bin/ffmpeg",
      downloaded: () => "/data/tools/ffmpeg/ffmpeg",
      codecs: async (f) => (probed.push(f), ["av1_nvenc"]),
      probe: async (f) => f === "/data/tools/ffmpeg/ffmpeg",
    });
    expect(probed).toEqual(["/usr/bin/ffmpeg", "/data/tools/ffmpeg/ffmpeg"]);
    expect(c.finisher).toEqual({ kind: "gpu", ffmpeg: "/data/tools/ffmpeg/ffmpeg", codec: "av1_nvenc" });
  });

  it("downloads in the background, then asks the finisher again; stops and removes", async () => {
    const dir = tempDir("ww-ff-");
    let changed = 0;
    let finish: (() => void) | null = null;
    const build: FfmpegBuild = { ...WIN };
    const fetcher = new FfmpegFetcher({
      dataDir: dir,
      build,
      changed: () => changed++,
      download: (o) =>
        new Promise<string>((resolve, reject) => {
          o.onProgress?.(5, 10);
          o.signal?.addEventListener("abort", () => reject(new FfmpegDownloadError("The download was stopped.")));
          finish = () => {
            const file = path.join(ffmpegToolDir(dir), process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
            writeFileSync(file, "x");
            resolve(file);
          };
        }),
    });
    expect(fetcher.report()).toMatchObject({ supported: true, installed: false, state: "idle" });
    expect(fetcher.start()).toMatchObject({ state: "downloading", done: 5, total: 10 });
    // A second start doesn't start another.
    expect(fetcher.start().state).toBe("downloading");
    expect(await fetcher.stop()).toMatchObject({ state: "idle", error: null });
    expect(changed).toBe(0);

    fetcher.start();
    mkdirSync(ffmpegToolDir(dir), { recursive: true });
    finish!();
    await fetcher.idle();
    expect(fetcher.report()).toMatchObject({ installed: true, state: "idle" });
    expect(changed).toBe(1);

    expect(await fetcher.remove()).toMatchObject({ installed: false });
    expect(changed).toBe(2);
  });

  it("says why a download failed, and refuses where there is no build or while videos are finished", async () => {
    const dir = tempDir("ww-ff-");
    const failing = new FfmpegFetcher({ dataDir: dir, build: WIN, changed: () => {}, download: async () => Promise.reject(new FfmpegDownloadError("The download answered 404.")) });
    failing.start();
    await failing.idle();
    expect(failing.report()).toMatchObject({ state: "failed", error: "The download answered 404." });
    expect(() => new FfmpegFetcher({ dataDir: dir, build: null, changed: () => {} }).start()).toThrow(/no ffmpeg build/);
    await expect(new FfmpegFetcher({ dataDir: dir, build: WIN, changed: () => {}, busy: () => true }).remove()).rejects.toThrow(/being finished/);
  });
});
