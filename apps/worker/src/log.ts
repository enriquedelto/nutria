/** Structured JSON logs (never log bodies or health data). */
type Fields = Record<string, unknown>;
const emit = (level: "info" | "warn" | "error", msg: string, f: Fields = {}) =>
  console[level === "info" ? "log" : level](JSON.stringify({ t: new Date().toISOString(), level, svc: "worker", msg, ...f }));
export const log = {
  info: (m: string, f?: Fields) => emit("info", m, f),
  warn: (m: string, f?: Fields) => emit("warn", m, f),
  error: (m: string, f?: Fields) => emit("error", m, f),
};
