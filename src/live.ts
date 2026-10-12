import { execFileSync } from "node:child_process";
import { close, constants as fsConstants, open, unlinkSync, write } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { SOUNDS_DIR } from "./config.js";
import { decodeChunkToPcm, play } from "./piper.js";

export const LIVE_RATE = 16000;
const IDLE_TIMEOUT_MS = 20_000;
const OPEN_RETRY_MS = 8000;

interface LiveSession {
  fd: number | null;
  fifoPath: string;
  last: number;
}

const sessions = new Map<string, LiveSession>();

function wavStreamingHeader(rate: number): Buffer {
  // declares an oversized data length, so ffmpeg reads it as an open-ended stream
  const channels = 1;
  const bits = 16;
  const byteRate = (rate * channels * bits) / 8;
  const blockAlign = (channels * bits) / 8;
  const dataSize = 0x7fffffff - 44;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(dataSize + 36, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataSize, 40);
  return header;
}

function writeFd(fd: number, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    write(fd, data, (err) => (err ? reject(err) : resolve()));
  });
}

function openNonBlocking(path: string): Promise<number | null> {
  return new Promise((resolve) => {
    const deadline = Date.now() + OPEN_RETRY_MS;
    const tryOpen = () => {
      open(path, fsConstants.O_WRONLY | fsConstants.O_NONBLOCK, (err, fd) => {
        if (!err) return resolve(fd);
        if (Date.now() >= deadline) return resolve(null);
        setTimeout(tryOpen, 100);
      });
    };
    tryOpen();
  });
}

export function cleanupLive(token: string): void {
  const sess = sessions.get(token);
  if (!sess) return;
  sessions.delete(token);
  if (sess.fd !== null) close(sess.fd, () => {});
  try {
    unlinkSync(sess.fifoPath);
  } catch {
    // already gone
  }
}

export async function startLive(cam: string, go2rtcUrl: string): Promise<string> {
  const token = randomBytes(8).toString("hex");
  const fifoPath = join(SOUNDS_DIR, `ptt_live_${token}.wav`);
  execFileSync("mkfifo", [fifoPath]);
  sessions.set(token, { fd: null, fifoPath, last: Date.now() });

  await play(cam, fifoPath.split("/").pop()!, go2rtcUrl);

  const fd = await openNonBlocking(fifoPath);
  if (fd === null) {
    cleanupLive(token);
    throw new Error("go2rtc never opened the audio pipe");
  }
  const sess = sessions.get(token);
  if (!sess) {
    // session was cancelled while we were waiting for a reader
    close(fd, () => {});
    try {
      unlinkSync(fifoPath);
    } catch {
      // already gone
    }
    throw new Error("session was cancelled");
  }
  sess.fd = fd;
  await writeFd(fd, wavStreamingHeader(LIVE_RATE));
  return token;
}

export async function feedLive(token: string, chunk: Buffer): Promise<void> {
  const sess = sessions.get(token);
  if (!sess || sess.fd === null) throw new Error("no active session for that token");
  let pcm: Buffer;
  try {
    pcm = await decodeChunkToPcm(chunk, LIVE_RATE);
  } catch {
    return; // a dropped segment shouldn't kill the whole session
  }
  await writeFd(sess.fd, pcm);
  sess.last = Date.now();
}

export async function stopLive(token: string, tailSeconds: number): Promise<void> {
  const sess = sessions.get(token);
  if (sess && sess.fd !== null) {
    try {
      await writeFd(sess.fd, Buffer.alloc(Math.round(LIVE_RATE * tailSeconds * 2)));
    } catch {
      // closing anyway
    }
  }
  cleanupLive(token);
}

export function sweepLive(): void {
  const now = Date.now();
  for (const [token, sess] of sessions) {
    if (now - sess.last > IDLE_TIMEOUT_MS) cleanupLive(token);
  }
}
