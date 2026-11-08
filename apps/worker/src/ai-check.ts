/**
 * Smoke test of the configured AI backend (no tools, no DB writes): `pnpm --filter @nutria/worker ai:check`.
 * Exits 0 and prints the model's reply when the token/key works; prints the error otherwise.
 */
import { createProvider, toAiError } from "@nutria/ai";

const p = createProvider();
try {
  const r = await p.run({
    feature: "check",
    system: "Responde exactamente con la palabra OK.",
    history: [],
    message: [{ type: "text", text: "¿Funcionas?" }],
    tools: [],
    ctx: {} as never,
    effort: "low",
    maxTurns: 1,
    signal: AbortSignal.timeout(90_000),
  });
  console.log(`IA OK (${p.backend}, ${p.model}): ${r.text.trim().slice(0, 80)}`);
  process.exit(0);
} catch (e) {
  const err = toAiError(e);
  console.error(`IA NO disponible (${p.backend}): ${err.code ?? ""} ${err.message}`);
  process.exit(1);
}
