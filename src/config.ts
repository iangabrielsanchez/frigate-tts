import { randomBytes, pbkdf2Sync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

export interface Settings {
  app_name: string;
  cameras: string[];
  go2rtc_url: string;
  voice: string;
  pad_seconds: number;
  tail_seconds: number;
  show_history: boolean;
  ptt_mode: "record" | "live";
  presets: string[];
  rate_limit_per_min: number;
  auth_username: string;
  auth_salt: string;
  auth_hash: string;
}

export const SOUNDS_DIR = process.env.SOUNDS_DIR ?? "/sounds";
export const FRIGATE_SOUNDS_DIR = process.env.FRIGATE_SOUNDS_DIR ?? "/sounds";
export const VOICES_DIR = process.env.VOICES_DIR ?? "/app/voices";
export const PUBLIC_DIR = process.env.PUBLIC_DIR ?? "/app/public";
export const SETTINGS_PATH = process.env.SETTINGS_PATH ?? (existsSync("/data") ? "/data/settings.json" : "./data/settings.json");
export const PORT = Number(process.env.PORT ?? 5005);
export const MAX_RECORDING_BYTES = 10 * 1024 * 1024;
export const ALL_CAMERAS = "*"; // sentinel camera value meaning "every configured camera"
export const SOUND_EXTENSIONS = [".mp3", ".wav", ".ogg", ".m4a", ".flac"];

const DEFAULTS: Settings = {
  app_name: "FrigateTTS",
  cameras: ["cam1_hd"],
  go2rtc_url: "http://frigate:1984",
  voice: "en_US-lessac-medium",
  pad_seconds: 3.0,
  tail_seconds: 1.0,
  show_history: true,
  ptt_mode: "record",
  presets: [
    "Leave the package by the door, thanks!",
    "Be right there!",
    "No soliciting, please leave the property.",
    "Can you come back later?",
  ],
  rate_limit_per_min: 10,
  auth_username: "",
  auth_salt: "",
  auth_hash: "",
};

let cached: Settings | null = null;

function writeSettingsFile(data: Settings): void {
  mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
  const tmp = SETTINGS_PATH + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, SETTINGS_PATH);
}

export function loadSettings(): Settings {
  if (cached) return cached;
  let data: Settings = { ...DEFAULTS };
  if (existsSync(SETTINGS_PATH)) {
    try {
      data = { ...DEFAULTS, ...JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) };
    } catch (e) {
      console.error(`settings.json unreadable, using defaults: ${e}`);
    }
  } else {
    writeSettingsFile(data);
  }
  cached = data;
  return cached;
}

export function saveSettings(data: Settings): void {
  writeSettingsFile(data);
  cached = data;
}

export function publicSettings() {
  const s = loadSettings();
  return {
    app_name: s.app_name,
    cameras: s.cameras,
    go2rtc_url: s.go2rtc_url,
    voice: s.voice,
    pad_seconds: s.pad_seconds,
    tail_seconds: s.tail_seconds,
    show_history: s.show_history,
    ptt_mode: s.ptt_mode,
    presets: s.presets,
    rate_limit_per_min: s.rate_limit_per_min,
    auth_username: s.auth_username,
  };
}

export function hashPassword(password: string, saltHex?: string): { salt: string; hash: string } {
  const salt = saltHex ?? randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, Buffer.from(salt, "hex"), 100_000, 32, "sha256").toString("hex");
  return { salt, hash };
}

export function checkAuth(authorizationHeader: string | undefined): boolean {
  const s = loadSettings();
  if (!s.auth_username) return true;
  if (!authorizationHeader || !authorizationHeader.startsWith("Basic ")) return false;
  let user: string, pw: string;
  try {
    const decoded = Buffer.from(authorizationHeader.slice(6), "base64").toString("utf8");
    const i = decoded.indexOf(":");
    user = i === -1 ? decoded : decoded.slice(0, i);
    pw = i === -1 ? "" : decoded.slice(i + 1);
  } catch {
    return false;
  }
  if (!timingSafeEqualStr(user, s.auth_username)) return false;
  const { hash } = hashPassword(pw, s.auth_salt);
  return timingSafeEqualStr(hash, s.auth_hash);
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// leaky bucket: level drains at `limit` per minute, each play adds 1, rejects once full
const bucket = { level: 0, last: Date.now() };

export function checkRateLimit(): void {
  const limit = loadSettings().rate_limit_per_min;
  if (limit <= 0) return;
  const drainPerMs = limit / 60000;
  const now = Date.now();
  bucket.level = Math.max(0, bucket.level - (now - bucket.last) * drainPerMs);
  bucket.last = now;
  if (bucket.level >= limit) {
    throw new Error(`rate limit: more than ${limit} camera messages per minute, try again shortly`);
  }
  bucket.level += 1;
}

export function listSounds(): string[] {
  if (!existsSync(SOUNDS_DIR)) return [];
  return readdirSync(SOUNDS_DIR)
    .filter((name) => {
      if (name === "tts.wav" || name === "mic.wav" || name.startsWith("ptt_live_")) return false;
      const lower = name.toLowerCase();
      return SOUND_EXTENSIONS.some((ext) => lower.endsWith(ext));
    })
    .sort();
}

export function soundPath(name: string): string {
  return join(SOUNDS_DIR, name);
}
