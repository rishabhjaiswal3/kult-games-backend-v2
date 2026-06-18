import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { AppError } from '../../core/error';
import { config } from '../../config';
import {
  AccessFeature,
  AccessTier,
  AccessTierId,
  VerifyAccessCodeRequest,
  VerifyAccessCodeResponse,
} from './access-code.model';

const ACCESS_TIERS: AccessTier[] = [
  { tier: 'tier_1', label: 'AI Arena + League', features: ['ai_arena', 'league'] },
  { tier: 'tier_2', label: 'AI Arena + Moments + Games', features: ['ai_arena', 'moments', 'games'] },
  { tier: 'tier_3', label: 'AI Arena + Games + Creator Platform + Moments', features: ['ai_arena', 'games', 'creator_platform', 'moments'] },
  { tier: 'tier_4', label: 'Full Browser', features: ['full_browser', 'ai_arena', 'league', 'moments', 'games', 'creator_platform', 'creator_studio'] },
  { tier: 'tier_5', label: 'Creator Studio', features: ['creator_studio'] },
];

type ScryptHash = {
  n: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
};

function parseScryptHash(hash: string): ScryptHash | null {
  const parts = hash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;

  const [, nRaw, rRaw, pRaw, saltRaw, keyRaw] = parts;
  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p)) return null;

  try {
    return {
      n,
      r,
      p,
      salt: Buffer.from(saltRaw, 'base64url'),
      key: Buffer.from(keyRaw, 'base64url'),
    };
  } catch {
    return null;
  }
}

function verifyScryptHash(code: string, hash: string): boolean {
  const parsed = parseScryptHash(hash);
  if (!parsed) return false;

  const candidate = crypto.scryptSync(code, parsed.salt, parsed.key.length, {
    N: parsed.n,
    r: parsed.r,
    p: parsed.p,
  });

  return candidate.length === parsed.key.length && crypto.timingSafeEqual(candidate, parsed.key);
}

function verifySha256Hash(code: string, hash: string): boolean {
  if (!hash.startsWith('sha256:')) return false;
  const expectedHex = hash.slice('sha256:'.length);
  if (!/^[a-f0-9]{64}$/i.test(expectedHex)) return false;

  const expected = Buffer.from(expectedHex, 'hex');
  const candidate = crypto.createHash('sha256').update(code).digest();
  return crypto.timingSafeEqual(candidate, expected);
}

function verifyCode(code: string, hash: string): boolean {
  const normalizedHash = hash.trim();
  if (!normalizedHash) return false;
  if (normalizedHash.startsWith('scrypt$')) return verifyScryptHash(code, normalizedHash);
  if (normalizedHash.startsWith('sha256:')) return verifySha256Hash(code, normalizedHash);
  return false;
}

function signAccessToken(tier: AccessTierId, features: AccessFeature[]): string {
  return jwt.sign(
    {
      typ: 'kult_access',
      tier,
      features,
    },
    config.auth.jwtSecret,
    {
      expiresIn: `${config.accessCodes.sessionExpiryDays}d`,
      issuer: config.accessCodes.issuer,
    },
  );
}

export class AccessCodeService {
  verify(req: VerifyAccessCodeRequest): VerifyAccessCodeResponse {
    const code = req.code?.trim();
    if (!code) throw AppError.badRequest('Access code is required');

    const configuredHashes = [
      config.accessCodes.tiers.tier1,
      config.accessCodes.tiers.tier2,
      config.accessCodes.tiers.tier3,
      config.accessCodes.tiers.tier4,
      config.accessCodes.tiers.tier5,
    ];

    for (let i = 0; i < ACCESS_TIERS.length; i += 1) {
      if (verifyCode(code, configuredHashes[i] ?? '')) {
        const tier = ACCESS_TIERS[i];
        return {
          ...tier,
          accessToken: signAccessToken(tier.tier, tier.features),
          expiresInDays: config.accessCodes.sessionExpiryDays,
        };
      }
    }

    throw AppError.unauthorized('Invalid access code');
  }
}
