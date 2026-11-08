import { transcribe } from "@nutria/integrations";
import { HttpError, json, route } from "@/lib/api";

/** Voice fallback when the browser has no Web Speech API: audio → faster-whisper on the NUC. */
export const POST = route(async (req) => {
  if (!process.env.WHISPER_URL) throw new HttpError(503, "La transcripción no está configurada");
  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) throw new HttpError(400, "Falta el audio");
  if (audio.size > 15 * 1024 * 1024) throw new HttpError(413, "Audio demasiado largo");
  const text = await transcribe(audio, { language: "es", filename: "voz.webm" });
  return json({ text });
});
