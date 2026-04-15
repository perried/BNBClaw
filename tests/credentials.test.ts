import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { initDb, closeDb } from '../src/db/database.js';
import {
  upsertCredentials,
  getStoredCredentials,
  clearStoredCredentials,
} from '../src/db/queries.js';

let tempDir: string | null = null;

afterEach(() => {
  closeDb();
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  tempDir = null;
});

describe('stored credentials', () => {
  it('can upsert, read, and clear Binance credentials', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bnbclaw-credentials-'));
    initDb(tempDir);

    upsertCredentials('binance', 'key-1234', 'secret-5678');
    let stored = getStoredCredentials('binance');

    expect(stored?.api_key).toBe('key-1234');
    expect(stored?.api_secret).toBe('secret-5678');

    upsertCredentials('binance', 'key-updated', 'secret-updated');
    stored = getStoredCredentials('binance');

    expect(stored?.api_key).toBe('key-updated');
    expect(stored?.api_secret).toBe('secret-updated');

    clearStoredCredentials('binance');

    expect(getStoredCredentials('binance')).toBeNull();
  });
});
