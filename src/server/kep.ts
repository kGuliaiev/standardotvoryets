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
 * Expected JSON response from the IIT signature service (variant A). The
 * service wraps the IIT EU Sign library, which after VerifyDataInternal
 * exposes the embedded signed data and the signer's certificate fields
 * (GetSubjDRFOCode → РНОКПП, GetSerial → serial, GetSubjCN → ПІБ, …).
 * Adjust the parser if your deployed service uses different field names.
 */
interface KepVerifyResponse {
  /** Overall verdict: signature valid + certificate trusted/in-date. */
  valid?: boolean;
  /** The data the signature actually covers (the client signs the nonce). */
  signedData?: string;
  /** Optional: service already compared signedData to our expectedData. */
  dataMatches?: boolean;
  signer?: {
    rnokpp?: string | null; // GetSubjDRFOCode
    edrpou?: string | null; // GetSubjEDRPOUCode
    serial?: string | null; // GetSerial (certificate serial number)
    fullName?: string | null; // GetSubjCN
    issuerCN?: string | null; // GetIssuerCN
    notAfter?: string | null; // GetCertEndTime
  };
}

/**
 * Verify a КЕП internal-signature container server-side via the IIT
 * signature service and assert it signs exactly `expectedData` (the nonce
 * for login/bind, or the document hash for signing). Returns the verified
 * signer identity. Throws a user-facing (Ukrainian) error on any failure.
 *
 * The client must produce the container with an INTERNAL signature
 * (euSign.SignInternal("true", expectedData)) so the signed data is
 * embedded and the service can recover both the data and the signer.
 */
export async function verifySignature(params: {
  containerBase64: string;
  expectedData: string;
}): Promise<VerifiedSigner> {
  if (!env.KEP_VERIFY_URL) throw new Error('KEP_VERIFY_URL не налаштовано');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(env.KEP_VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        container: params.containerBase64,
        expectedData: params.expectedData,
      }),
      signal: controller.signal,
    });
  } catch {
    throw new Error('Сервіс перевірки підпису недоступний');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`Сервіс перевірки підпису повернув помилку (${res.status})`);
  }
  const body = (await res.json().catch(() => null)) as KepVerifyResponse | null;
  if (!body || body.valid === false) throw new Error('Підпис недійсний');

  // The signed data MUST be exactly our challenge/document hash — this is
  // what stops a replay of some other signed payload.
  const dataMatches =
    body.dataMatches === true ||
    (typeof body.signedData === 'string' && body.signedData === params.expectedData);
  if (!dataMatches) throw new Error('Підпис не відповідає запиту');

  const serial = (body.signer?.serial ?? '').trim();
  if (!serial) throw new Error('У підписі відсутній серійний номер сертифіката');

  return {
    rnokpp: body.signer?.rnokpp ? String(body.signer.rnokpp).trim() : null,
    keyId: serial,
    fullName: body.signer?.fullName ?? null,
    issuerCN: body.signer?.issuerCN ?? null,
    notAfter: body.signer?.notAfter ?? null,
  };
}
