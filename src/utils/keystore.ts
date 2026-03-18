import fs from 'fs';
import path from 'path';
import { encrypt, decrypt, generateKey } from './crypto.js';
import { getSetting, setSetting } from '../db/queries.js';
import { createLogger } from './logger.js';

const log = createLogger('keystore');

const KEY_FILE = path.join(process.cwd(), '.encryption_key');

/**
 * Get or create the encryption key.
 * Stored in a separate file (not .env, not DB) so it's independent of both.
 */
function getEncryptionKey(): string {
  // 1. Check env var first
  if (process.env.ENCRYPTION_KEY) {
    return process.env.ENCRYPTION_KEY;
  }

  // 2. Check key file
  try {
    const key = fs.readFileSync(KEY_FILE, 'utf-8').trim();
    if (key) return key;
  } catch {
    // File doesn't exist yet
  }

  // 3. Auto-generate and save
  const key = generateKey();
  fs.writeFileSync(KEY_FILE, key, { mode: 0o600 });
  log.info('Generated new encryption key → .encryption_key');
  return key;
}

// DB key prefixes for encrypted secrets
const ENCRYPTED_PREFIX = 'secret:';

/**
 * Store an encrypted secret in the settings DB.
 */
export function storeSecret(name: string, value: string): void {
  const key = getEncryptionKey();
  const encrypted = encrypt(value, key);
  setSetting(`${ENCRYPTED_PREFIX}${name}`, encrypted);
}

/**
 * Load a decrypted secret from the settings DB.
 * Returns null if not stored.
 */
export function loadSecret(name: string): string | null {
  const stored = getSetting(`${ENCRYPTED_PREFIX}${name}`);
  if (!stored) return null;

  try {
    const key = getEncryptionKey();
    return decrypt(stored, key);
  } catch (err) {
    log.error(`Failed to decrypt secret: ${name}`, err);
    return null;
  }
}

/**
 * Check if a secret exists in the DB.
 */
export function hasSecret(name: string): boolean {
  return getSetting(`${ENCRYPTED_PREFIX}${name}`) !== null;
}

/**
 * Resolve credentials: DB secrets take priority over .env values.
 */
export function resolveCredentials() {
  return {
    binanceApiKey: loadSecret('binance_api_key') ?? process.env.BINANCE_API_KEY ?? '',
    binanceApiSecret: loadSecret('binance_api_secret') ?? process.env.BINANCE_API_SECRET ?? '',
    llmApiKey: loadSecret('llm_api_key') ?? process.env.LLM_API_KEY ?? '',
  };
}

/**
 * Check if Binance credentials are configured (either in DB or .env).
 */
export function hasBinanceCredentials(): boolean {
  const creds = resolveCredentials();
  return !!(creds.binanceApiKey && creds.binanceApiSecret);
}

/**
 * Check if LLM credentials are configured (either in DB or .env).
 */
export function hasLlmCredentials(): boolean {
  return !!resolveCredentials().llmApiKey;
}
