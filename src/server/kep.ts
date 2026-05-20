import { createHmac, randomBytes } from 'crypto';
import { db } from '@/server/db';
import { env } from '@/lib/env';

/**
 * КЕП (qualified electronic signature) server-side helpers — the shared
 * foundation for both "login by КЕП" and "document signing".
 *
 * Security model (see docs/kep.md):
 *   - The signature is ALWAYS verified on the server. A client claiming
 *     "signed OK" proves nothing.
 *   - For login/bind the client signs a one-time server `nonce`; we assert
 *     the signature is over exactly that nonce (anti-replay).
 *   - For document signing the signed data is the document content/hash.
 *   - We never store the raw РНОКПП — only an HMAC of it (with a server
 *     pepper) — and never log it.
 */

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export type KepPurpose = 'login' | 'bind';

/** What a verified signature yields about the signer. */
export interface VerifiedSigner {
  /** РНОКПП (individual tax number) — null if the certificate has none. */
  rnokpp: string | null;
  /** Certificate serial number — the fallback identity when no РНОКПП. */
  keyId: string;
  fullName: string | null;
  issuerCN: string | null;
  /** Certificate validity end (ISO) if the service returns it. */
  notAfter: string | null;
}

/** True only when both КЕП env vars are configured. */
export function isKepConfigured(): boolean {
  return Boolean(env.KEP_VERIFY_URL && env.KEP_RNOKPP_PEPPER);
}

// ── Challenge (nonce) lifecycle ────────────────────────────────────────────

/** Create a single-use nonce for a КЕП flow. `userId` is set for 'bind'. */
export async function createChallenge(purpose: KepPurpose, userId?: string): Promise<string> {
  const nonce = randomBytes(32).toString('base64url');
  await db.kepChallenge.create({
    data: {
      nonce,
      purpose,
      userId: userId ?? null,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });
  return nonce;
}

/**
 * Validate and consume a nonce (marks it used). Throws a user-facing
 * (Ukrainian) error on invalid / wrong-purpose / expired / already-used.
 * Returns the `userId` the challenge was issued for ('bind').
 */
export async function consumeChallenge(
  nonce: string,
  purpose: KepPurpose,
): Promise<{ userId: string | null }> {
  const row = await db.kepChallenge.findUnique({ where: { nonce } });
  if (row?.purpose !== purpose) throw new Error('Невірний запит підпису');
  if (row.usedAt) throw new Error('Запит підпису вже використано');
  if (row.expiresAt.getTime() < Date.now()) throw new Error('Запит підпису протерміновано');
  await db.kepChallenge.update({ where: { nonce }, data: { usedAt: new Date() } });
  return { userId: row.userId };
}

// ── Identity ────────────────────────────────────────────────────────────────

/** HMAC of РНОКПП with the server pepper — exactly what we store/compare. */
export function rnokppHash(rnokpp: string): string {
  if (!env.KEP_RNOKPP_PEPPER) throw new Error('KEP_RNOKPP_PEPPER не налаштовано');
  return createHmac('sha256', env.KEP_RNOKPP_PEPPER).update(rnokpp.trim()).digest('hex');
}

/** Storable identity keys for a verified signer (РНОКПП hash + key id). */
export function identityKeys(signer: VerifiedSigner): {
  rnokppHash: string | null;
  keyId: string;
} {
  return {
    rnokppHash: signer.rnokpp ? rnokppHash(signer.rnokpp) : null,
    keyId: signer.keyId,
  };
}

// ── Signature verification ───────────────────────────────────────────────────

/**
 * Verify a КЕП signature container server-side and assert it signs exactly
 * `expectedData` (the nonce for login/bind, or the document hash for
 * signing). Returns the verified signer identity.
 *
 * TODO(phase-1): wire the concrete ІІТ/ЦЗО verification request once the
 * public endpoint contract is confirmed. It must:
 *   1) send `containerBase64` (+ `expectedData`) to `env.KEP_VERIFY_URL`;
 *   2) assert the signature is cryptographically valid AND covers exactly
 *      `expectedData`;
 *   3) validate the certificate chain / validity period;
 *   4) extract РНОКПП, certificate serial, ПІБ, issuer CN, notAfter.
 * Everything else in the app stays endpoint-agnostic behind this function.
 */
export function verifySignature(_params: {
  containerBase64: string;
  expectedData: string;
}): Promise<VerifiedSigner> {
  if (!env.KEP_VERIFY_URL) {
    return Promise.reject(new Error('KEP_VERIFY_URL не налаштовано'));
  }
  // Placeholder until the ІІТ/ЦЗО endpoint contract is confirmed.
  return Promise.reject(
    new Error('Перевірку підпису ще не підключено (Етап 1: підтвердження endpoint ІІТ/ЦЗО)'),
  );
}
