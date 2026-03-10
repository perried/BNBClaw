import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Encrypt a string using AES-256-GCM.
 * Returns base64-encoded: IV + ciphertext + authTag
 */
export function encrypt(plaintext: string, key: string): string {
  const keyHash = crypto.createHash('sha256').update(key).digest();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, keyHash, iv);

  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, encrypted, tag]).toString('base64');
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 */
export function decrypt(ciphertext: string, key: string): string {
  const keyHash = crypto.createHash('sha256').update(key).digest();
  const buf = Buffer.from(ciphertext, 'base64');

  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(buf.length - TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH, buf.length - TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, keyHash, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString('utf8');
}

/**
 * Generate a random encryption key.
 */
export function generateKey(): string {
  return crypto.randomBytes(32).toString('hex');
}
