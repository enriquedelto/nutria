/**
 * Speech-to-text (faster-whisper HTTP service on the NUC) and video recipe extraction (yt-dlp).
 * Whisper service: onerahmet/openai-whisper-asr-webservice (POST /asr?task=transcribe&language=es&output=json).
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { assertPublicUrl } from "./net";

const run = promisify(execFile);

export async function transcribe(audio: Blob | Buffer, opts: { whisperUrl?: string; language?: string; filename?: string } = {}): Promise<string> {
  const url = opts.whisperUrl ?? process.env.WHISPER_URL;
  if (!url) throw new Error("WHISPER_URL no está configurada");
  const form = new FormData();
  const blob = audio instanceof Blob ? audio : new Blob([new Uint8Array(audio)]);
  form.append("audio_file", blob, opts.filename ?? "audio.webm");
  const r = await fetch(`${url.replace(/\/$/, "")}/asr?task=transcribe&language=${opts.language ?? "es"}&output=json&encode=true`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(180000),
  });
  if (!r.ok) throw new Error(`Whisper respondió ${r.status}`);
  const j = (await r.json()) as { text?: string };
  return (j.text ?? "").trim();
}

export interface VideoInfo {
  title: string;
  description: string;
  uploader: string | null;
  durationSec: number | null;
  thumbnail: string | null;
  webpageUrl: string;
  transcript: string | null;
}

/** Download metadata (+ audio for transcription) of a YouTube/TikTok/Instagram video with yt-dlp. */
export async function extractVideo(url: string, opts: { ytDlp?: string; whisperUrl?: string; maxDurationSec?: number } = {}): Promise<VideoInfo> {
  await assertPublicUrl(url);
  const bin = opts.ytDlp ?? process.env.YT_DLP_BIN ?? "yt-dlp";
  const { stdout } = await run(bin, ["--dump-single-json", "--no-playlist", "--skip-download", url], { timeout: 60000, maxBuffer: 20 * 1024 * 1024 });
  const meta = JSON.parse(stdout) as { title?: string; description?: string; uploader?: string; duration?: number; thumbnail?: string; webpage_url?: string };
  const info: VideoInfo = {
    title: meta.title ?? "Receta de vídeo",
    description: meta.description ?? "",
    uploader: meta.uploader ?? null,
    durationSec: meta.duration ?? null,
    thumbnail: meta.thumbnail ?? null,
    webpageUrl: meta.webpage_url ?? url,
    transcript: null,
  };
  const max = opts.maxDurationSec ?? 1200;
  const whisper = opts.whisperUrl ?? process.env.WHISPER_URL;
  if (whisper && (info.durationSec ?? 0) <= max) {
    const dir = await mkdtemp(join(tmpdir(), "nutria-video-"));
    try {
      await run(bin, ["-f", "bestaudio[filesize<40M]/bestaudio/best", "-x", "--audio-format", "mp3", "--audio-quality", "5", "-o", join(dir, "a.%(ext)s"), "--no-playlist", url], { timeout: 180000 });
      const file = (await readdir(dir)).find((f) => f.startsWith("a."));
      if (file) info.transcript = await transcribe(await readFile(join(dir, file)), { whisperUrl: whisper, filename: file });
    } catch {
      info.transcript = null;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  return info;
}
