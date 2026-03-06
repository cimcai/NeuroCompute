import fs from "fs";
import path from "path";

const LOG_DIR = path.resolve("logs");
const ERROR_LOG = path.join(LOG_DIR, "error.log");
const APP_LOG = path.join(LOG_DIR, "app.log");
const MAX_LOG_SIZE = 5 * 1024 * 1024;

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function rotateIfNeeded(filePath: string) {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size > MAX_LOG_SIZE) {
      const rotated = filePath + ".old";
      if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
      fs.renameSync(filePath, rotated);
    }
  } catch {}
}

function formatEntry(level: string, category: string, message: string, meta?: any): string {
  const ts = new Date().toISOString();
  let line = `[${ts}] [${level}] [${category}] ${message}`;
  if (meta) {
    const metaStr = meta instanceof Error
      ? `${meta.message}\n${meta.stack || ""}`
      : JSON.stringify(meta, null, 0);
    line += ` :: ${metaStr}`;
  }
  return line + "\n";
}

function appendLog(filePath: string, entry: string) {
  rotateIfNeeded(filePath);
  fs.appendFileSync(filePath, entry);
}

export const logger = {
  error(category: string, message: string, meta?: any) {
    const entry = formatEntry("ERROR", category, message, meta);
    appendLog(ERROR_LOG, entry);
    appendLog(APP_LOG, entry);
    console.error(`[${category}] ${message}`, meta || "");
  },

  warn(category: string, message: string, meta?: any) {
    const entry = formatEntry("WARN", category, message, meta);
    appendLog(APP_LOG, entry);
    console.warn(`[${category}] ${message}`, meta || "");
  },

  info(category: string, message: string, meta?: any) {
    const entry = formatEntry("INFO", category, message, meta);
    appendLog(APP_LOG, entry);
  },
};
