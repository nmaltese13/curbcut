import config from './config.js';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

// Redact anything that looks like a credential before it reaches a log sink.
const SENSITIVE = /^(password|token|secret|authorization|cookie|api_?key|key_hash|password_hash)$/i;

function scrub(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE.test(k) ? '[redacted]' : scrub(v, depth + 1);
  }
  return out;
}

function emit(level, message, meta) {
  if (LEVELS[level] > threshold) return;
  const record = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(meta ? scrub(meta) : {}),
  };
  if (config.isProd) {
    // Structured single-line JSON so a hosted log drain can parse it.
    process.stdout.write(`${JSON.stringify(record)}\n`);
    return;
  }
  const tag = { error: 'ERR ', warn: 'WARN', info: 'INFO', debug: 'DBG ' }[level];
  const extra = meta ? ` ${JSON.stringify(scrub(meta))}` : '';
  process.stdout.write(`${tag} ${message}${extra}\n`);
}

export const log = {
  error: (msg, meta) => emit('error', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  info: (msg, meta) => emit('info', msg, meta),
  debug: (msg, meta) => emit('debug', msg, meta),
};

export default log;
