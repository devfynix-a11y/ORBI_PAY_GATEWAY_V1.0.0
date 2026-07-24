import crypto from 'crypto';
import { config } from '../config.js';

export type EncryptedSecretEnvelope = {
  alg: 'aes-256-gcm';
  keyId: 'orbi-secret-encryption-key';
  iv: string;
  tag: string;
  ciphertext: string;
};

const encryptionKey = (): Buffer => {
  const source = config.secretEncryptionKey.trim();
  if (!source) throw new Error('ORBI_SECRET_ENCRYPTION_KEY_REQUIRED');
  return crypto.createHash('sha256').update(source).digest();
};

export const encryptSecret = (secret: string): EncryptedSecretEnvelope => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return {
    alg: 'aes-256-gcm',
    keyId: 'orbi-secret-encryption-key',
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
};

export const decryptSecret = (envelope: unknown): string => {
  const value = envelope as Partial<EncryptedSecretEnvelope> | undefined;
  if (
    !value ||
    value.alg !== 'aes-256-gcm' ||
    !value.iv ||
    !value.tag ||
    !value.ciphertext
  ) {
    throw new Error('SECRET_VAULT_ENVELOPE_INVALID');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(value.iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(value.tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
};
