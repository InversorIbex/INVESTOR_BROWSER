/**
 * API keys for data providers, encrypted with the operating system's secure
 * store (Electron safeStorage: DPAPI on Windows, Keychain on macOS, libsecret
 * on Linux). Only the ciphertext is written to the database.
 *
 * - The UI can set, test and delete a key, but never reads it back: it only
 *   sees "configured" and the last 4 characters.
 * - If the OS cannot encrypt (e.g. Linux without a keyring, where Chromium falls
 *   back to a hard-coded password), keys are refused instead of being stored
 *   weakly. Tests may opt in explicitly.
 * - Keys never appear in logs, caches or exports.
 */
import type { QuoteProvider } from '../shared/market';

export interface Cipher {
  isEncryptionAvailable(): boolean;
  /** 'basic_text' on Linux means "no real keyring". */
  backend?(): string;
  encryptString(plain: string): Buffer;
  decryptString(data: Buffer): string;
}

export interface KvStore {
  getJson<T>(key: string): T | null;
  setJson(key: string, value: unknown): void;
}

export class SecretError extends Error {}

const KEY_RE = /^[A-Za-z0-9._\-]{8,128}$/;

export class Secrets {
  private memo = new Map<QuoteProvider, string | null>();

  constructor(
    private readonly kv: KvStore,
    private readonly cipher: Cipher,
    private readonly allowWeakForTests = false,
  ) {}

  canStore(): { ok: boolean; reason?: string } {
    if (!this.cipher.isEncryptionAvailable()) return { ok: false, reason: 'El sistema no ofrece cifrado seguro para guardar claves.' };
    const backend = this.cipher.backend?.() ?? '';
    if (backend === 'basic_text' && !this.allowWeakForTests)
      return { ok: false, reason: 'No hay un almacén seguro del sistema (llavero) disponible: la clave no se guardará en claro.' };
    return { ok: true };
  }

  set(provider: QuoteProvider, key: string): void {
    const k = key.trim();
    if (!KEY_RE.test(k)) throw new SecretError('La clave no tiene un formato válido.');
    const can = this.canStore();
    if (!can.ok) throw new SecretError(can.reason);
    const enc = this.cipher.encryptString(k).toString('base64');
    this.kv.setJson(`secret.${provider}`, { enc, last4: k.slice(-4), savedAt: Date.now() });
    this.memo.set(provider, k);
  }

  delete(provider: QuoteProvider): void {
    this.kv.setJson(`secret.${provider}`, null);
    this.memo.set(provider, null);
  }

  /** Main process only. */
  get(provider: QuoteProvider): string | null {
    if (this.memo.has(provider)) return this.memo.get(provider) ?? null;
    const row = this.kv.getJson<{ enc: string } | null>(`secret.${provider}`);
    let key: string | null = null;
    if (row?.enc) {
      try {
        key = this.cipher.decryptString(Buffer.from(row.enc, 'base64'));
      } catch {
        key = null; // e.g. database copied to another Windows user: ask for the key again
      }
    }
    this.memo.set(provider, key);
    return key;
  }

  describe(provider: QuoteProvider): { configured: boolean; last4: string | null; readable: boolean } {
    const row = this.kv.getJson<{ enc: string; last4: string } | null>(`secret.${provider}`);
    if (!row?.enc) return { configured: false, last4: null, readable: false };
    return { configured: true, last4: row.last4 ?? null, readable: this.get(provider) !== null };
  }
}
