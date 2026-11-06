import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { SETTINGS_PATH, Settings } from "./config.js";
import { cacheText } from "./normalize.js";

// Pre-rendered quick replies, kept apart from the rolling cache so presets stay
// ready and never evict recent messages.
const DIR = join(dirname(SETTINGS_PATH), "preset-audio");

export const PRESET_SPEED = 1; // the "Normal" option the page sends by default

export function presetKey(text: string, s: Settings, speed = PRESET_SPEED): string {
  return createHash("sha256")
    .update(JSON.stringify([cacheText(text), s.voice, speed, s.pad_seconds, s.tail_seconds, s.play_chime]))
    .digest("hex")
    .slice(0, 32);
}

export function getPreset(key: string): string | null {
  const path = join(DIR, key + ".wav");
  return existsSync(path) ? path : null;
}

export function putPreset(key: string, source: string): void {
  mkdirSync(DIR, { recursive: true });
  copyFileSync(source, join(DIR, key + ".wav"));
}

// A voice or timing change re-keys every preset, so anything outside the current
// key set is stale.
export function prunePresets(keep: Set<string>): number {
  if (!existsSync(DIR)) return 0;
  let removed = 0;
  for (const file of readdirSync(DIR)) {
    if (!file.endsWith(".wav")) continue;
    if (keep.has(file.slice(0, -4))) continue;
    try {
      unlinkSync(join(DIR, file));
      removed++;
    } catch {
      // best effort
    }
  }
  return removed;
}
