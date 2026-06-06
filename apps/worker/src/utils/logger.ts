// Minimal pino-style context logger (replaces the monorepo's @repo/logger).
type Fields = Record<string, unknown>;
export interface ContextLogger {
  info(a: Fields | string, msg?: string): void;
  warn(a: Fields | string, msg?: string): void;
  error(a: Fields | string, msg?: string): void;
  debug(a: Fields | string, msg?: string): void;
}
function emit(level: string, context: string, a: Fields | string, b?: string) {
  const rec: Fields = { level, context };
  if (typeof a === "string") rec.message = a;
  else { Object.assign(rec, a); if (b) rec.message = b; }
  const line = JSON.stringify(rec);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
export function createContextLogger(context: string): ContextLogger {
  return {
    info: (a, b) => emit("info", context, a, b),
    warn: (a, b) => emit("warn", context, a, b),
    error: (a, b) => emit("error", context, a, b),
    debug: (a, b) => emit("debug", context, a, b),
  };
}
