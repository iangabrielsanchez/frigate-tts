import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkAuth,
  checkRateLimit,
  loadSettings,
  listSounds,
  publicSettings,
  saveSettings,
  soundPath,
  hashPassword,
  Settings,
  SOUNDS_DIR,
  MAX_RECORDING_BYTES,
  PORT,
  ALL_CAMERAS,
  PUBLIC_DIR,
} from "./config.js";
import {
  convertRecording,
  downloadVoice,
  ensureDefaultVoice,
  getCatalog,
  listVoices,
  play,
  synthesize,
  testGo2rtc,
} from "./piper.js";
import { feedLive, startLive, stopLive, sweepLive } from "./live.js";
import { MAIN_PAGE, SETTINGS_PAGE } from "./pages.js";

// minimal service worker: just enough to satisfy "installable" criteria. No offline caching,
// since every feature here needs a live connection to the Pi anyway.
const SERVICE_WORKER = `self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',()=>{});`;

function sendFile(res: ServerResponse, path: string, contentType: string): void {
  try {
    send(res, 200, readFileSync(path), contentType);
  } catch {
    send(res, 404, '{"error":"not found"}');
  }
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        req.destroy();
        reject(new Error("request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, code: number, body: string | Buffer, contentType = "application/json"): void {
  const data = typeof body === "string" ? Buffer.from(body) : body;
  res.writeHead(code, { "Content-Type": contentType, "Content-Length": data.length });
  res.end(data);
}

function sendJson(res: ServerResponse, code: number, obj: unknown): void {
  send(res, code, JSON.stringify(obj));
}

function resolveCameras(cam: string | undefined, s: Settings): string[] {
  if (cam === ALL_CAMERAS) return s.cameras;
  const target = cam || s.cameras[0];
  if (!s.cameras.includes(target)) throw new Error("unknown camera");
  return [target];
}

function requireAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (checkAuth(req.headers.authorization)) return true;
  res.writeHead(401, { "WWW-Authenticate": `Basic realm="${loadSettings().app_name}"`, "Content-Type": "application/json" });
  res.end('{"error":"authentication required"}');
  return false;
}

async function handleSay(body: any): Promise<unknown> {
  const s = loadSettings();
  const text = String(body.text ?? "").trim().slice(0, 500);
  const speed = Math.min(Math.max(Number(body.speed ?? 1), 0.5), 2.0);
  if (!text) throw new Error("empty text");
  const cams = resolveCameras(body.cam, s);
  checkRateLimit();
  const t0 = Date.now();
  await synthesize(text, soundPath("tts.wav"), speed, s.voice, s.pad_seconds, s.tail_seconds);
  await Promise.all(cams.map((cam) => play(cam, "tts.wav", s.go2rtc_url)));
  return { ok: true, seconds: Math.round((Date.now() - t0) / 100) / 10, cameras: cams };
}

async function handleTalk(cam: string | undefined, data: Buffer): Promise<unknown> {
  const s = loadSettings();
  const cams = resolveCameras(cam, s);
  if (data.length === 0) throw new Error("recording is empty or too large");
  checkRateLimit();
  const t0 = Date.now();
  await convertRecording(data, soundPath("mic.wav"), s.pad_seconds, s.tail_seconds);
  await Promise.all(cams.map((cam) => play(cam, "mic.wav", s.go2rtc_url)));
  return { ok: true, seconds: Math.round((Date.now() - t0) / 100) / 10, cameras: cams };
}

async function handleLiveStart(cam: string | undefined): Promise<unknown> {
  const s = loadSettings();
  const cams = resolveCameras(cam, s);
  checkRateLimit();
  const token = await startLive(cams, s.go2rtc_url);
  return { ok: true, token, cameras: cams };
}

async function handleLiveChunk(token: string | undefined, data: Buffer): Promise<unknown> {
  if (!token || data.length === 0 || data.length > MAX_RECORDING_BYTES) throw new Error("bad chunk");
  await feedLive(token, data);
  return { ok: true };
}

async function handleLiveStop(token: string | undefined): Promise<unknown> {
  if (!token) throw new Error("missing token");
  await stopLive(token, loadSettings().tail_seconds);
  return { ok: true };
}

async function handlePlaySound(body: any): Promise<unknown> {
  const s = loadSettings();
  const filename = String(body.file ?? "").trim();
  if (!listSounds().includes(filename)) throw new Error("unknown sound file");
  const cams = resolveCameras(body.cam, s);
  checkRateLimit();
  const t0 = Date.now();
  await Promise.all(cams.map((cam) => play(cam, filename, s.go2rtc_url)));
  return { ok: true, seconds: Math.round((Date.now() - t0) / 100) / 10, cameras: cams };
}

function handleSaveSettings(body: any): unknown {
  const s: Settings = { ...loadSettings() };
  if (body.app_name) s.app_name = String(body.app_name).trim().slice(0, 40);
  if (body.go2rtc_url) s.go2rtc_url = String(body.go2rtc_url).trim();
  if (Array.isArray(body.cameras)) {
    const cams = body.cameras.map((c: unknown) => String(c).trim()).filter(Boolean);
    if (cams.length) s.cameras = cams;
  }
  if (body.voice) s.voice = String(body.voice);
  if (body.pad_seconds !== undefined) s.pad_seconds = Math.max(0, Math.min(10, Number(body.pad_seconds)));
  if (body.tail_seconds !== undefined) s.tail_seconds = Math.max(0, Math.min(10, Number(body.tail_seconds)));
  if (body.show_history !== undefined) s.show_history = Boolean(body.show_history);
  if (body.ptt_mode === "record" || body.ptt_mode === "live") s.ptt_mode = body.ptt_mode;
  if (Array.isArray(body.presets)) {
    s.presets = body.presets.map((p: unknown) => String(p).trim()).filter(Boolean).slice(0, 20);
  }
  if (body.rate_limit_per_min !== undefined) {
    s.rate_limit_per_min = Math.max(0, Math.min(120, Math.round(Number(body.rate_limit_per_min))));
  }
  if (body.auth_username !== undefined) {
    const username = String(body.auth_username).trim();
    const password = String(body.auth_password ?? "");
    if (!username) {
      s.auth_username = "";
      s.auth_salt = "";
      s.auth_hash = "";
    } else {
      s.auth_username = username;
      if (password) {
        const { salt, hash } = hashPassword(password);
        s.auth_salt = salt;
        s.auth_hash = hash;
      }
    }
  }
  saveSettings(s);
  return { ok: true };
}

async function handleDownloadVoice(body: any): Promise<unknown> {
  const key = String(body.voice ?? "").trim();
  if (!key) throw new Error("missing voice");
  await downloadVoice(key);
  return { ok: true, voices: listVoices() };
}

async function handlePreview(body: any): Promise<{ data: Buffer }> {
  const s = loadSettings();
  const text = String(body.text ?? "").trim().slice(0, 300);
  const voiceName = body.voice || s.voice;
  const speed = Math.min(Math.max(Number(body.speed ?? 1), 0.5), 2.0);
  const pad = Math.max(0, Math.min(10, Number(body.pad_seconds ?? s.pad_seconds)));
  const tail = Math.max(0, Math.min(10, Number(body.tail_seconds ?? s.tail_seconds)));
  if (!text) throw new Error("empty text");
  const tmp = join(tmpdir(), `preview-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  try {
    await synthesize(text, tmp, speed, voiceName, pad, tail);
    return { data: readFileSync(tmp) };
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      // best effort
    }
  }
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  // the https-proxy sidecar's on-demand TLS asks here before issuing a cert for any
  // hostname/IP; we're only reachable on the frigate network, so anything goes.
  if (req.method === "GET" && path === "/caddy-ask") {
    return send(res, 200, "ok", "text/plain");
  }

  // PWA assets: served without auth, since the OS fetches these during install without
  // carrying any saved credentials.
  if (req.method === "GET") {
    if (path === "/manifest.webmanifest") {
      const name = loadSettings().app_name;
      return sendJson(res, 200, {
        name,
        short_name: name.slice(0, 12),
        start_url: "/",
        display: "standalone",
        background_color: "#f6f6f4",
        theme_color: "#2f6fed",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      });
    }
    if (path === "/sw.js") return send(res, 200, SERVICE_WORKER, "application/javascript");
    if (path === "/icon-192.png") return sendFile(res, join(PUBLIC_DIR, "icon-192.png"), "image/png");
    if (path === "/icon-512.png") return sendFile(res, join(PUBLIC_DIR, "icon-512.png"), "image/png");
    if (path === "/apple-touch-icon.png") return sendFile(res, join(PUBLIC_DIR, "apple-touch-icon.png"), "image/png");
  }

  if (!requireAuth(req, res)) return;

  if (req.method === "GET") {
    if (path === "/") return send(res, 200, MAIN_PAGE, "text/html; charset=utf-8");
    if (path === "/settings") return send(res, 200, SETTINGS_PAGE, "text/html; charset=utf-8");
    if (path === "/api/settings") return sendJson(res, 200, publicSettings());
    if (path === "/api/voices") return sendJson(res, 200, listVoices());
    if (path === "/api/sounds") return sendJson(res, 200, listSounds());
    if (path === "/api/catalog") {
      try {
        return sendJson(res, 200, await getCatalog());
      } catch (e) {
        return sendJson(res, 400, { ok: false, error: String(e) });
      }
    }
    if (path === "/api/test-go2rtc") {
      const target = url.searchParams.get("url")?.trim() ?? "";
      try {
        return sendJson(res, 200, { ok: true, streams: await testGo2rtc(target) });
      } catch (e) {
        return sendJson(res, 400, { ok: false, error: String(e) });
      }
    }
    return send(res, 404, '{"error":"not found"}');
  }

  if (req.method === "POST") {
    try {
      if (path === "/say") return sendJson(res, 200, await handleSay(JSON.parse((await readBody(req, 8192)).toString() || "{}")));
      if (path === "/talk") return sendJson(res, 200, await handleTalk(url.searchParams.get("cam") ?? undefined, await readBody(req, MAX_RECORDING_BYTES)));
      if (path === "/talk-live/start") return sendJson(res, 200, await handleLiveStart(url.searchParams.get("cam") ?? undefined));
      if (path === "/talk-live/chunk") return sendJson(res, 200, await handleLiveChunk(url.searchParams.get("token") ?? undefined, await readBody(req, MAX_RECORDING_BYTES)));
      if (path === "/talk-live/stop") return sendJson(res, 200, await handleLiveStop(url.searchParams.get("token") ?? undefined));
      if (path === "/api/settings") return sendJson(res, 200, handleSaveSettings(JSON.parse((await readBody(req, 8192)).toString() || "{}")));
      if (path === "/api/voices/download") return sendJson(res, 200, await handleDownloadVoice(JSON.parse((await readBody(req, 8192)).toString() || "{}")));
      if (path === "/api/sounds/play") return sendJson(res, 200, await handlePlaySound(JSON.parse((await readBody(req, 8192)).toString() || "{}")));
      if (path === "/api/preview") {
        const { data } = await handlePreview(JSON.parse((await readBody(req, 8192)).toString() || "{}"));
        return send(res, 200, data, "audio/wav");
      }
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: String((e as Error).message ?? e) });
    }
    return send(res, 404, '{"error":"not found"}');
  }

  send(res, 404, '{"error":"not found"}');
}

async function main(): Promise<void> {
  await ensureDefaultVoice();
  loadSettings();
  setInterval(sweepLive, 10_000);
  const server = createServer((req, res) => {
    route(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: String(e) });
    });
  });
  server.listen(PORT, "0.0.0.0", () => console.log(`${loadSettings().app_name} on http://0.0.0.0:${PORT}`));
}

main();
