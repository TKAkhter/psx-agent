// ─────────────────────────────────────────────────────────────
//  src/logger.ts  —  Centralised structured logger
//
//  All output goes to stdout so it can be captured by cron:
//    npm start >> /var/log/psx-agent.log 2>&1
//
//  Format:
//    [HH:MM:SS PKT] LEVEL  message  {context?}
//
//  Levels: DEBUG | INFO | WARN | ERROR | FATAL
//  DEBUG lines are suppressed unless LOG_LEVEL=debug in .env
// ─────────────────────────────────────────────────────────────

import moment from "moment-timezone";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";

const LEVEL_RANK: Record<LogLevel, number> = {
  DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4,
};

const MIN_LEVEL: LogLevel = (() => {
  const env = (process.env.LOG_LEVEL ?? "info").toUpperCase() as LogLevel;
  return LEVEL_RANK[env] != null ? env : "INFO";
})();

function ts(): string {
  return moment().tz("Asia/Karachi").format("HH:mm:ss");
}

function fmt(level: LogLevel, msg: string, ctx?: Record<string, unknown>): string {
  const prefix = `[${ts()} PKT] ${level.padEnd(5)}`;
  const ctxStr = ctx && Object.keys(ctx).length > 0
    ? "  " + Object.entries(ctx)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join("  ")
    : "";
  return `${prefix}  ${msg}${ctxStr}`;
}

function emit(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[MIN_LEVEL]) return;
  const line = fmt(level, msg, ctx);
  if (level === "ERROR" || level === "FATAL") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

// ── Public API ───────────────────────────────────────────────

export const log = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit("DEBUG", msg, ctx),
  info:  (msg: string, ctx?: Record<string, unknown>) => emit("INFO",  msg, ctx),
  warn:  (msg: string, ctx?: Record<string, unknown>) => emit("WARN",  msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit("ERROR", msg, ctx),
  fatal: (msg: string, ctx?: Record<string, unknown>) => emit("FATAL", msg, ctx),

  // Step header — clearly marks pipeline stages in the log
  step: (n: number, total: number, label: string) =>
    emit("INFO", `${"─".repeat(10)} STEP ${n}/${total}: ${label} ${"─".repeat(10)}`),

  // API call logging — request + timing
  apiStart: (label: string, url: string) =>
    emit("DEBUG", `→ ${label}`, { url }),

  apiOk: (label: string, url: string, ms: number, detail?: string) =>
    emit("INFO", `✓ ${label}${detail ? ": " + detail : ""}`, { url, ms }),

  apiError: (label: string, url: string, ms: number, err: Error | unknown) => {
    const e = err as { response?: { status?: number; statusText?: string; data?: unknown }; code?: string; message?: string };
    const status  = e?.response?.status;
    const text    = e?.response?.statusText;
    const body    = e?.response?.data;
    const code    = e?.code;
    const message = e?.message ?? String(err);
    emit("ERROR", `✗ ${label} FAILED`, {
      url, ms,
      ...(status  ? { httpStatus: status }  : {}),
      ...(text    ? { httpText:   text }    : {}),
      ...(code    ? { netCode:    code }    : {}),
      message,
      ...(body    ? { responseBody: JSON.stringify(body).slice(0, 200) } : {}),
    });
  },

  // Stock-level result line
  stock: (symbol: string, ok: boolean, detail: string, extra?: Record<string, unknown>) =>
    emit(ok ? "INFO" : "WARN", `${ok ? "✓" : "✗"} ${symbol.padEnd(8)} ${detail}`, extra),
};

// ── Timed wrapper for async calls ────────────────────────────

export async function timed<T>(
  label: string,
  url: string,
  fn: () => Promise<T>
): Promise<T> {
  const t0 = Date.now();
  log.apiStart(label, url);
  try {
    const result = await fn();
    log.apiOk(label, url, Date.now() - t0);
    return result;
  } catch (err) {
    log.apiError(label, url, Date.now() - t0, err);
    throw err;
  }
}
