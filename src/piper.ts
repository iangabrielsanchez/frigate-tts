import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { FRIGATE_SOUNDS_DIR, VOICES_DIR } from "./config.js";

const PIPER_VOICES_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main";
const DEFAULT_VOICE_NAME = "en_US-lessac-medium";
const CATALOG_TTL_MS = 86_400_000;

export interface CatalogEntry {
  key: string;
  language: string;
  quality: string;
  mb: number;
  onnx_path: string;
}

function run(cmd: string, args: string[], input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => errChunks.push(c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(Buffer.concat(errChunks).toString().trim() || `${cmd} exited with code ${code}`));
    });
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

export async function ensureDefaultVoice(): Promise<void> {
  if (existsSync(VOICES_DIR) && readdirSync(VOICES_DIR).some((f) => f.endsWith(".onnx"))) return;
  mkdirSync(VOICES_DIR, { recursive: true });
  console.log("No voices found, downloading the default one...");
  for (const ext of ["onnx", "onnx.json"]) {
    const buf = Buffer.from(await (await fetch(`${PIPER_VOICES_BASE}/en/en_US/lessac/medium/${DEFAULT_VOICE_NAME}.${ext}`)).arrayBuffer());
    writeFileSync(join(VOICES_DIR, `${DEFAULT_VOICE_NAME}.${ext}`), buf);
  }
}

export function listVoices(): string[] {
  if (!existsSync(VOICES_DIR)) return [];
  return readdirSync(VOICES_DIR)
    .filter((f) => f.endsWith(".onnx") && existsSync(join(VOICES_DIR, f + ".json")))
    .map((f) => f.slice(0, -5))
    .sort();
}

let catalogCache: { data: CatalogEntry[]; ts: number } | null = null;

export async function getCatalog(): Promise<CatalogEntry[]> {
  if (catalogCache && Date.now() - catalogCache.ts < CATALOG_TTL_MS) return catalogCache.data;
  const raw = (await (await fetch(`${PIPER_VOICES_BASE}/voices.json`)).json()) as Record<string, any>;
  const trimmed: CatalogEntry[] = [];
  for (const [key, v] of Object.entries(raw)) {
    const onnxPath = Object.keys(v.files).find((p) => p.endsWith(".onnx"));
    if (!onnxPath) continue;
    trimmed.push({
      key,
      language: `${v.language.name_english} (${v.language.country_english})`,
      quality: v.quality,
      mb: Math.round((v.files[onnxPath].size_bytes / 1e6) * 10) / 10,
      onnx_path: onnxPath,
    });
  }
  trimmed.sort((a, b) => (a.language + a.key).localeCompare(b.language + b.key));
  catalogCache = { data: trimmed, ts: Date.now() };
  return trimmed;
}

export async function downloadVoice(key: string): Promise<void> {
  if (listVoices().includes(key)) return;
  const entry = (await getCatalog()).find((v) => v.key === key);
  if (!entry) throw new Error(`unknown voice: ${key}`);
  mkdirSync(VOICES_DIR, { recursive: true });
  const partial = join(VOICES_DIR, key + ".onnx.part");
  const onnx = Buffer.from(await (await fetch(`${PIPER_VOICES_BASE}/${entry.onnx_path}`)).arrayBuffer());
  writeFileSync(partial, onnx);
  const json = Buffer.from(await (await fetch(`${PIPER_VOICES_BASE}/${entry.onnx_path}.json`)).arrayBuffer());
  writeFileSync(join(VOICES_DIR, key + ".onnx.json"), json);
  renameSync(partial, join(VOICES_DIR, key + ".onnx")); // atomic: only now does listVoices() see it
}

export async function synthesize(
  text: string,
  outPath: string,
  speed: number,
  voiceName: string,
  padSeconds: number,
  tailSeconds: number,
  playChime = false
): Promise<void> {
  const modelPath = join(VOICES_DIR, voiceName + ".onnx");
  if (!existsSync(modelPath)) throw new Error(`unknown voice: ${voiceName}`);
  const rawWav = outPath + ".raw.wav";
  try {
    await run("piper", ["--model", modelPath, "--output_file", rawWav, "--length_scale", String(1 / speed)], Buffer.from(text));
    const source = playChime ? await prependChime(rawWav, outPath) : rawWav;
    try {
      const af = `adelay=${Math.round(padSeconds * 1000)}:all=1,apad=pad_dur=${tailSeconds}`;
      await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", source, "-af", af, "-ac", "1", outPath]);
    } finally {
      if (source !== rawWav) unlinkSync(source);
    }
  } finally {
    if (existsSync(rawWav)) unlinkSync(rawWav);
  }
}

let chimePath: string | null = null;

async function ensureChime(): Promise<string> {
  if (chimePath) return chimePath;
  const path = join(tmpdir(), "frigate-tts-chime.wav");
  if (!existsSync(path)) {
    // a two-tone "ding-dong", supermarket-PA style: E5 then C5, each with a quick fade to avoid clicks
    await run("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "sine=frequency=659.25:duration=0.5:sample_rate=22050",
      "-f", "lavfi", "-i", "sine=frequency=523.25:duration=0.8:sample_rate=22050",
      "-filter_complex",
      "[0:a]afade=t=in:d=0.01,afade=t=out:st=0.35:d=0.15[a0];" +
        "[1:a]afade=t=in:d=0.01,afade=t=out:st=0.55:d=0.25[a1];" +
        "[a0][a1]concat=n=2:v=0:a=1,volume=0.7[out]",
      "-map", "[out]",
      "-ar", "22050", "-ac", "1",
      path,
    ]);
  }
  chimePath = path;
  return chimePath;
}

// chime, then half a second of air, then the speech; the caller still applies the leading/trailing padding
async function prependChime(ttsPath: string, outPath: string): Promise<string> {
  const combined = outPath + ".chime.wav";
  const af =
    "[0:a]aformat=sample_rates=22050:channel_layouts=mono:sample_fmts=s16[ch];" +
    "[1:a]aformat=sample_rates=22050:channel_layouts=mono:sample_fmts=s16[tts];" +
    "anullsrc=r=22050:cl=mono,atrim=duration=0.5,asetpts=PTS-STARTPTS,aformat=sample_rates=22050:channel_layouts=mono:sample_fmts=s16[gap];" +
    "[ch][gap][tts]concat=n=3:v=0:a=1[out]";
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", await ensureChime(), "-i", ttsPath, "-filter_complex", af, "-map", "[out]", combined]);
  return combined;
}

export async function convertRecording(data: Buffer, outPath: string, padSeconds: number, tailSeconds: number): Promise<void> {
  const tmp = outPath + ".in";
  writeFileSync(tmp, data);
  try {
    const af = `adelay=${Math.round(padSeconds * 1000)}:all=1,apad=pad_dur=${tailSeconds}`;
    await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", tmp, "-af", af, "-ac", "1", "-ar", "16000", outPath]);
  } catch (e) {
    throw new Error(`could not decode recording: ${e}`);
  } finally {
    unlinkSync(tmp);
  }
}

export async function play(cam: string, filename: string, go2rtcUrl: string): Promise<void> {
  const src = `ffmpeg:${FRIGATE_SOUNDS_DIR}/${basename(filename)}#audio=pcma#input=file`;
  const url = `${go2rtcUrl}/api/streams?${new URLSearchParams({ dst: cam, src })}`;
  const res = await fetch(url, { method: "POST", body: "" });
  if (!res.ok) throw new Error(`go2rtc returned ${res.status}`);
}

export async function testGo2rtc(url: string): Promise<string[]> {
  if (!url.startsWith("http://") && !url.startsWith("https://")) throw new Error("URL must start with http:// or https://");
  const res = await fetch(`${url}/api/streams`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`go2rtc returned ${res.status}`);
  return Object.keys((await res.json()) as Record<string, unknown>);
}

export async function decodeChunkToPcm(data: Buffer, sampleRate: number): Promise<Buffer> {
  const tmp = `/tmp/live-chunk-${Date.now()}-${Math.random().toString(36).slice(2)}.webm`;
  writeFileSync(tmp, data);
  try {
    return await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", tmp, "-f", "s16le", "-ar", String(sampleRate), "-ac", "1", "-"]);
  } finally {
    unlinkSync(tmp);
  }
}
