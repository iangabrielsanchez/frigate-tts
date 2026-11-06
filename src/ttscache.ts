import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, utimesSync } from "node:fs";
import { dirname, join } from "node:path";
import { SETTINGS_PATH } from "./config.js";
import { cacheText } from "./normalize.js";

const CACHE_DIR = join(dirname(SETTINGS_PATH), "tts-cache");
const DEFAULT_ENTRIES = 5;
let maxEntries = DEFAULT_ENTRIES;

export interface CacheKeyParts {
  text: string;
  voice: string;
  speed: number;
  pad: number;
  tail: number;
  chime: boolean;
}

interface Entry {
  size: number;
  usedAt: number;
}

// Loaded once, then kept in memory, so a hit costs a Map lookup and a file copy.
let index: Map<string, Entry> | null = null;

function loadIndex(): Map<string, Entry> {
  if (index) return index;
  index = new Map();
  if (!existsSync(CACHE_DIR)) return index;
  for (const file of readdirSync(CACHE_DIR)) {
    if (!file.endsWith(".wav")) continue;
    const path = join(CACHE_DIR, file);
    try {
      const st = statSync(path);
      index.set(file.slice(0, -4), { size: st.size, usedAt: st.mtimeMs });
    } catch {
      // gone since readdir
    }
  }
  return index;
}

function evict(idx: Map<string, Entry>): void {
  if (idx.size <= maxEntries) return;
  const ordered = [...idx.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt);
  for (const [key] of ordered.slice(0, idx.size - maxEntries)) {
    try {
      unlinkSync(join(CACHE_DIR, key + ".wav"));
    } catch {
      // best effort
    }
    idx.delete(key);
  }
}

// Everything that changes the audio belongs in the key, or a hit replays audio
// rendered with the old settings.
export function cacheKey(p: CacheKeyParts): string {
  return createHash("sha256")
    .update(JSON.stringify([cacheText(p.text), p.voice, p.speed, p.pad, p.tail, p.chime]))
    .digest("hex")
    .slice(0, 32);
}

// Set from the Settings page. Presets live in their own store.
export function setCapacity(n: number): void {
  const parsed = Number.isFinite(n) ? Math.floor(n) : DEFAULT_ENTRIES;
  maxEntries = Math.min(200, Math.max(0, parsed));
  const idx = loadIndex();
  if (maxEntries === 0) {
    for (const key of [...idx.keys()]) {
      try {
        unlinkSync(join(CACHE_DIR, key + ".wav"));
      } catch {
        // best effort
      }
      idx.delete(key);
    }
    return;
  }
  evict(idx);
}

export function getCached(key: string): string | null {
  const entry = loadIndex().get(key);
  if (!entry) return null;
  entry.usedAt = Date.now();
  return join(CACHE_DIR, key + ".wav");
}

export function putCached(key: string, source: string): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const path = join(CACHE_DIR, key + ".wav");
    copyFileSync(source, path);
    const now = Date.now();
    try {
      utimesSync(path, now / 1000, now / 1000);
    } catch {
      // best effort
    }
    const idx = loadIndex();
    idx.set(key, { size: statSync(path).size, usedAt: now });
    evict(idx);
  } catch (e) {
    // a cache write must never fail a send
    console.error("tts cache write failed:", e);
  }
}

// Average cached message size, for the Settings page estimate.
export function avgBytes(): number {
  const idx = loadIndex();
  if (!idx.size) return 0;
  let total = 0;
  for (const entry of idx.values()) total += entry.size;
  return Math.round(total / idx.size);
}
