import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Imported first by tests that touch the database so that config.js, which reads
// the environment at module evaluation time, points at a throwaway file.
const dir = mkdtempSync(path.join(tmpdir(), 'curbcut-test-'));
process.env.DATABASE_PATH = path.join(dir, 'test.db');
process.env.SESSION_SECRET = 'test-secret';
process.env.LOG_LEVEL = 'error';
// Deterministic and fast: browser rendering is exercised in render.test.js.
process.env.RENDER_MODE = 'static';

export const testDataDir = dir;
