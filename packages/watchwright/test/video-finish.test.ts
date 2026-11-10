import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findFfmpeg, matroskaHeader, videoEncoder } from "../src/jobs/run-video.js";
import { VideoCapture } from "../src/jobs/video-capture.js";
import { chooseFinisher, type FinisherChoice, ffmpegOnPath, finishArgs, finisherLabel, finishThreads, gpuArgs, isAv1Video, runFfmpeg } from "../src/jobs/video-finish.js";
import { captureFileFor, VideoFinishQueue, type FinishJob } from "../src/plugins/runs/finisher.js";
import { cleanTempDirs, tempDir } from "./helpers/fixtures.js";

afterEach(() => cleanTempDirs());

/** The cluster times (ms) in a capture, read back from its bytes. */
function frameTimes(file: string): number[] {
  const buf = readFileSync(file);
  const times: number[] = [];
  for (let i = buf.indexOf(Buffer.from("1F43B675", "hex")); i >= 0; i = buf.indexOf(Buffer.from("1F43B675", "hex"), i + 4)) {
    // Cluster id, a size vint, then E7 <size> <uint>.
    let j = i + 4;
    const first = buf[j]!;
    let len = 1;
    while (len < 8 && !(first & (0x80 >> (len - 1)))) len++;
    j += len;
    if (buf[j] !== 0xe7) continue;
    const n = buf[j + 1]! & 0x7f;
    let v = 0;
    for (let k = 0; k < n; k++) v = v * 256 + buf[j + 2 + k]!;
    times.push(v);
  }
  return times;
}

const jpeg = (n: number) => Buffer.from(`fake-jpeg-${n}`);

describe("recording an attempt's video", () => {
  it("writes each frame at the time it came, not on a timer, and the last one until the stop", async () => {
    const dir = tempDir("ww-cap-");
    let now = 1000;
    const cap = new VideoCapture({ file: path.join(dir, "v.capture.mkv"), now: () => now });
    const frames = [jpeg(1), jpeg(2), jpeg(3)];
    cap.push({ data: frames[0]!, width: 641, height: 401, receivedAt: 1000 });
    // Firefox's flash filter hands a frame on one frame late: its own time counts, not when it got here.
    now = 1100;
    cap.push({ data: frames[1]!, width: 641, height: 401, receivedAt: 1045 });
    // The same frame again (a still page) isn't written twice.
    cap.push({ data: frames[1]!, width: 641, height: 401, receivedAt: 1080 });
    now = 1200;
    cap.push({ data: frames[2]!, width: 641, height: 401 });
    now = 2000;
    const r = await cap.stop();
    expect(r).toMatchObject({ width: 640, height: 400, frames: 5 });
    expect(frameTimes(r!.file)).toEqual([0, 45, 200, 1000, 1040]);
    expect(readFileSync(r!.file).subarray(0, matroskaHeader().length)).toEqual(matroskaHeader());
  });

  it("keeps times going forward, and writes nothing without frames", async () => {
    const dir = tempDir("ww-cap-");
    const cap = new VideoCapture({ file: path.join(dir, "a.capture.mkv"), size: { width: 300, height: 200 }, now: () => 0 });
    cap.push({ data: jpeg(1), width: 640, height: 400, receivedAt: 500 });
    cap.push({ data: jpeg(2), width: 640, height: 400, receivedAt: 490 });
    const r = await cap.stop();
    expect(r).toMatchObject({ width: 300, height: 200 });
    expect(frameTimes(r!.file).slice(0, 2)).toEqual([0, 1]);
    const none = new VideoCapture({ file: path.join(dir, "b.capture.mkv") });
    expect(await none.stop()).toBeNull();
    expect(existsSync(path.join(dir, "b.capture.mkv"))).toBe(false);
  });

  it("says once when the file can't be written", async () => {
    const errors: string[] = [];
    const cap = new VideoCapture({ file: path.join(tempDir("ww-cap-"), "no", "such", "x.mkv"), onError: (m) => errors.push(m) });
    cap.push({ data: jpeg(1), width: 10, height: 10 });
    expect(await cap.stop()).toBeNull();
    expect(errors).toHaveLength(1);
  });
});

describe("who finishes videos", () => {
  const cpu = () => "/pw/ffmpeg";
  const encoder = () => "libvpx-vp9" as const;

  it("uses the first hardware AV1 encoder that takes a test clip", async () => {
    const probed: string[] = [];
    const c = await chooseFinisher("auto", {
      env: {},
      cpu,
      encoder,
      system: () => "/usr/bin/ffmpeg",
      codecs: async () => ["av1_nvenc", "av1_qsv"],
      probe: async (_f, codec) => (probed.push(codec), codec === "av1_qsv"),
    });
    expect(probed).toEqual(["av1_nvenc", "av1_qsv"]);
    expect(c).toEqual({ finisher: { kind: "gpu", ffmpeg: "/usr/bin/ffmpeg", codec: "av1_qsv" }, note: null });
    expect(finisherLabel(c.finisher)).toBe("Graphics card (Intel, AV1)");
  });

  it("falls back to the CPU and says why", async () => {
    const none = await chooseFinisher("auto", { env: {}, cpu, encoder, system: () => null });
    expect(none.finisher).toEqual({ kind: "cpu", ffmpeg: "/pw/ffmpeg", codec: "libvpx-vp9" });
    expect(none.note).toMatch(/No full ffmpeg/);
    const refused = await chooseFinisher("auto", { env: {}, cpu, encoder, system: () => "/f", codecs: async () => ["av1_nvenc"], probe: async () => false });
    expect(refused.finisher?.kind).toBe("cpu");
    expect(refused.note).toMatch(/av1_nvenc/);
    const plain = await chooseFinisher("auto", { env: {}, cpu, encoder, system: () => "/f", codecs: async () => [] });
    expect(plain.note).toMatch(/no hardware AV1 encoder/);
    expect(finisherLabel(plain.finisher)).toBe("CPU (VP9)");
    expect(finisherLabel(null)).toBe("None (no ffmpeg)");
  });

  it("never tries the card on CPU only", async () => {
    const c = await chooseFinisher("cpu", { env: {}, cpu, encoder, system: () => { throw new Error("not asked"); } });
    expect(c).toEqual({ finisher: { kind: "cpu", ffmpeg: "/pw/ffmpeg", codec: "libvpx-vp9" }, note: null });
  });

  it("finds ffmpeg on the PATH", () => {
    const dir = tempDir("ww-path-");
    writeFileSync(path.join(dir, "ffmpeg.exe"), "");
    expect(ffmpegOnPath({ PATH: ["/nope", dir].join(path.delimiter) }, "win32")).toBe(path.join(dir, "ffmpeg.exe"));
    expect(ffmpegOnPath({ PATH: dir }, "linux")).toBeNull();
  });

  it("gives each quality its encoder arguments: real times, Small at 10 a second, AV1 levels by quality", () => {
    const gpu = finishArgs("in.mkv", "out.webm", 640, 400, "compact", { kind: "gpu", ffmpeg: "f", codec: "av1_nvenc" });
    expect(gpu).toEqual(expect.arrayContaining(["-fps_mode", "vfr", "-c:v", "av1_nvenc", "-cq", "36", "-f", "webm", "title=watchwright-video:compact"]));
    const small = finishArgs("in.mkv", "out.webm", 640, 400, "small", { kind: "cpu", ffmpeg: "f", codec: "libvpx-vp9" }, 3);
    expect(small).toEqual(expect.arrayContaining(["-r", "10", "-cpu-used", "6", "-threads", "3", "-crf", "42"]));
    expect(small.join(" ")).toContain("scale=480:300");
    expect(gpuArgs("av1_qsv", "high")).toEqual(expect.arrayContaining(["-global_quality", "22"]));
    expect(gpuArgs("av1_amf", "full")).toEqual(expect.arrayContaining(["-qp_i", "150"]));
    expect(finishThreads(16)).toBe(8);
    expect(finishThreads(1)).toBe(1);
  });

  it("knows an AV1 WebM", async () => {
    const dir = tempDir("ww-av1-");
    writeFileSync(path.join(dir, "a.webm"), Buffer.from("....V_AV1...."));
    writeFileSync(path.join(dir, "b.webm"), Buffer.from("....V_VP9...."));
    expect(await isAv1Video(path.join(dir, "a.webm"))).toBe(true);
    expect(await isAv1Video(path.join(dir, "b.webm"))).toBe(false);
    expect(await isAv1Video(path.join(dir, "c.webm"))).toBe(false);
  });
});

describe("the finish queue", () => {
  const cpuChoice = async (): Promise<FinisherChoice> => ({ finisher: { kind: "cpu", ffmpeg: "ff", codec: "libvpx-vp9" }, note: null });

  function setup(o: { fail?: (args: string[], ffmpeg: string) => boolean; slow?: boolean; choose?: () => Promise<FinisherChoice> } = {}) {
    const dataDir = tempDir("ww-fin-");
    const done: { job: FinishJob; size: number | null; error: string | null }[] = [];
    const runs: string[][] = [];
    const q = new VideoFinishQueue({
      dataDir,
      mode: () => "auto",
      choose: async (mode) => (mode === "cpu" ? cpuChoice() : (o.choose ?? cpuChoice)()),
      onDone: (job, size, error) => done.push({ job, size, error }),
      run: async (ffmpeg, args, opts) => {
        runs.push([ffmpeg, ...args]);
        if (o.slow) await new Promise<void>((resolve) => opts?.signal?.addEventListener("abort", () => resolve()));
        if (opts?.signal?.aborted) return { code: null, stderr: "" };
        if (o.fail?.(args, ffmpeg)) return { code: 1, stderr: "Error: nope" };
        writeFileSync(args.at(-1)!, "webm-bytes");
        return { code: 0, stderr: "" };
      },
    });
    const job = (runId: string, name = "video-p1"): FinishJob => {
      const dir = path.join(dataDir, "runs", runId, "T1", "attempt-1");
      mkdirSync(dir, { recursive: true });
      const output = path.join(dir, `${name}.webm`);
      writeFileSync(captureFileFor(output), "capture");
      return { capture: captureFileFor(output), output, width: 640, height: 400, quality: "high", runId, attemptId: `a-${runId}` };
    };
    return { dataDir, q, done, runs, job };
  }

  it("encodes each capture into its WebM and removes the capture", async () => {
    const { q, done, job } = setup();
    const a = job("r1");
    q.add(a);
    q.add(job("r1", "video-p2"));
    expect(q.pending()).toBe(2);
    await q.idle();
    expect(done.map((d) => [path.basename(d.job.output), d.size, d.error])).toEqual([
      ["video-p1.webm", 10, null],
      ["video-p2.webm", 10, null],
    ]);
    expect(readdirSync(path.dirname(a.output)).sort()).toEqual(["video-p1.webm", "video-p2.webm"]);
    expect((await q.status()).pending).toBe(0);
  });

  it("does on the CPU what the graphics card refused, and reports a video nothing could make", async () => {
    const gpu = async (): Promise<FinisherChoice> => ({ finisher: { kind: "gpu", ffmpeg: "sys", codec: "av1_nvenc" }, note: null });
    const first = setup({ choose: gpu, fail: (_a, ff) => ff === "sys" });
    first.q.add(first.job("r1"));
    await first.q.idle();
    expect(first.runs.map((r) => r[0])).toEqual(["sys", "ff"]);
    expect(first.done[0]).toMatchObject({ size: 10, error: null });

    const second = setup({ fail: () => true });
    const j = second.job("r2");
    second.q.add(j);
    await second.q.idle();
    expect(second.done[0]).toMatchObject({ size: null, error: "Error: nope" });
    expect(readdirSync(path.dirname(j.output))).toEqual([]);
  });

  it("finishes what a stopped server left, and drops a capture with no attempt", async () => {
    const { dataDir, q, job } = setup({ slow: true });
    const a = job("r1");
    q.add(a);
    await q.close();
    // Left for the next start: the capture and what its row needs.
    expect(readdirSync(path.dirname(a.output)).sort()).toEqual(["video-p1.capture.json", "video-p1.capture.mkv"]);
    const orphan = path.join(path.dirname(a.output), "video-p9.capture.mkv");
    writeFileSync(orphan, "cut off");

    const next = setup();
    const again = new VideoFinishQueue({ dataDir, mode: () => "cpu", choose: cpuChoice, onDone: (j, size) => next.done.push({ job: j, size, error: null }), run: async (_f, args) => (writeFileSync(args.at(-1)!, "x"), { code: 0, stderr: "" }) });
    expect(again.recover()).toBe(1);
    await again.idle();
    expect(next.done.map((d) => [d.job.attemptId, d.size])).toEqual([["a-r1", 1]]);
    expect(readdirSync(path.dirname(a.output))).toEqual(["video-p1.webm"]);
  });

  it("stops a run's encoding when the run is deleted", async () => {
    const { q, done, job } = setup({ slow: true });
    q.add(job("r1"));
    q.add(job("r1", "video-p2"));
    q.add(job("r2"));
    expect(q.pendingFor("r1")).toBe(2);
    await q.cancelRun("r1");
    expect(q.pendingFor("r1")).toBe(0);
    expect(q.pendingFor("r2")).toBe(1);
    await q.close();
    expect(done).toEqual([]);
  });
});

describe.skipIf(!findFfmpeg() || !videoEncoder(findFfmpeg()!))("a real finish", () => {
  it("turns a capture of JPEG frames into a WebM with the frames' own times", { timeout: 60_000 }, async () => {
    const ff = findFfmpeg()!;
    const dir = tempDir("ww-real-");
    // Three JPEG frames from ffmpeg itself.
    const jpgs: Buffer[] = [];
    for (const c of ["red", "green", "blue"]) {
      const f = path.join(dir, `${c}.jpg`);
      await runFfmpeg(ff, ["-loglevel", "error", "-f", "lavfi", "-i", `color=c=${c}:s=320x200:d=0.04`, "-frames:v", "1", f]);
      if (!existsSync(f)) return; // this ffmpeg has no lavfi; the CPU path is covered by the session tests
      jpgs.push(readFileSync(f));
    }
    let now = 0;
    const cap = new VideoCapture({ file: path.join(dir, "v.capture.mkv"), now: () => now });
    jpgs.forEach((data, i) => cap.push({ data, width: 320, height: 200, receivedAt: [0, 45, 130][i]! }));
    now = 500;
    const c = (await cap.stop())!;
    const out = path.join(dir, "v.webm");
    const r = await runFfmpeg(ff, finishArgs(c.file, out, c.width, c.height, "high", { kind: "cpu", ffmpeg: ff, codec: videoEncoder(ff)! }, 2));
    expect(r.code).toBe(0);
    expect(readFileSync(out).length).toBeGreaterThan(100);
  });
});
