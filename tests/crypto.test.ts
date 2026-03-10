import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, generateKey } from '../src/utils/crypto.js';

describe('crypto', () => {
  it('encrypts and decrypts correctly', () => {
    const key = 'test-encryption-key-12345';
    const plaintext = 'my-secret-api-key-abc123';

    const encrypted = encrypt(plaintext, key);
    expect(encrypted).not.toBe(plaintext);

    const decrypted = decrypt(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext each time (random IV)', () => {
    const key = 'test-key';
    const plaintext = 'same-input';

    const enc1 = encrypt(plaintext, key);
    const enc2 = encrypt(plaintext, key);
    expect(enc1).not.toBe(enc2);

    // Both should decrypt to same value
    expect(decrypt(enc1, key)).toBe(plaintext);
    expect(decrypt(enc2, key)).toBe(plaintext);
  });

  it('fails to decrypt with wrong key', () => {
    const encrypted = encrypt('secret', 'correct-key');
    expect(() => decrypt(encrypted, 'wrong-key')).toThrow();
  });

  it('generateKey returns 64-char hex string', () => {
    const key = generateKey();
    expect(key).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(key)).toBe(true);
  });

  it('handles empty string', () => {
    const key = 'test-key';
    const encrypted = encrypt('', key);
    expect(decrypt(encrypted, key)).toBe('');
  });

  it('handles unicode strings', () => {
    const key = 'test-key';
    const plaintext = '🦞 BNBClaw — unicode test';
    const encrypted = encrypt(plaintext, key);
    expect(decrypt(encrypted, key)).toBe(plaintext);
  });
});
