import { createHmac, createPublicKey, JsonWebKey, KeyObject, timingSafeEqual } from 'crypto';
import jwt, { JwtHeader, JwtPayload } from 'jsonwebtoken';
import { config } from '../../config';
import { AppError } from '../../core/error';

interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface PrivyClaims extends JwtPayload {
  iss?: string;
  aud?: string | string[];
  linked_accounts?: unknown;
}

export function verifyTelegramInitData(initData: string): TelegramUser {
  const botToken = config.auth.telegramBotToken;
  if (!botToken) throw AppError.internal('TELEGRAM_BOT_TOKEN is not configured');

  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  if (!receivedHash) throw AppError.unauthorized('Telegram initData is missing its hash');

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  const expected = Buffer.from(expectedHash, 'hex');
  const received = Buffer.from(receivedHash, 'hex');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw AppError.unauthorized('Telegram initData signature is invalid');
  }

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || Math.abs(Date.now() / 1000 - authDate) > 86_400) {
    throw AppError.unauthorized('Telegram initData is expired');
  }

  const rawUser = params.get('user');
  if (!rawUser) throw AppError.unauthorized('Telegram initData is missing its user');
  try {
    const user = JSON.parse(rawUser) as TelegramUser;
    if (!Number.isSafeInteger(user.id)) throw new Error('invalid user id');
    return user;
  } catch {
    throw AppError.unauthorized('Telegram initData contains an invalid user');
  }
}

export function verifyPrivyTonWallet(identityToken: string, walletAddress: string): void {
  const appId = config.auth.privyAppId;
  if (!appId) throw AppError.internal('PRIVY_APP_ID is not configured');

  const decoded = jwt.decode(identityToken, { complete: true });
  if (!decoded || typeof decoded === 'string') {
    throw AppError.unauthorized('Invalid Privy identity token');
  }

  const key = getPrivyVerificationKey(decoded.header);
  let claims: PrivyClaims;
  try {
    claims = jwt.verify(identityToken, key, {
      algorithms: ['ES256'],
      audience: appId,
      issuer: 'privy.io',
    }) as PrivyClaims;
  } catch {
    throw AppError.unauthorized('Invalid or expired Privy identity token');
  }

  let linkedAccounts = claims.linked_accounts;
  if (typeof linkedAccounts === 'string') {
    try {
      linkedAccounts = JSON.parse(linkedAccounts);
    } catch {
      throw AppError.unauthorized('Privy linked accounts claim is invalid');
    }
  }

  const hasWallet = Array.isArray(linkedAccounts) && linkedAccounts.some((account: unknown) => {
    if (!account || typeof account !== 'object') return false;
    const value = account as Record<string, unknown>;
    return value.type === 'wallet'
      && (value.chainType === 'ton' || value.chain_type === 'ton')
      && value.address === walletAddress;
  });

  if (!hasWallet) {
    throw AppError.unauthorized('TON wallet is not linked to the verified Privy user');
  }
}

function getPrivyVerificationKey(header: JwtHeader): KeyObject | string {
  const pem = config.auth.privyVerificationKeyPem;
  if (pem) return pem.replace(/\\n/g, '\n');

  const rawJwk = config.auth.privyVerificationKeyJwk;
  if (!rawJwk) {
    throw AppError.internal('Set PRIVY_VERIFICATION_KEY_JWK or PRIVY_VERIFICATION_KEY_PEM');
  }

  try {
    const parsed = JSON.parse(rawJwk) as Record<string, unknown>;
    const keys = Array.isArray(parsed.keys) ? parsed.keys as Record<string, unknown>[] : [parsed];
    const selected = keys.find((key) => !header.kid || key.kid === header.kid);
    if (!selected) throw new Error('matching key not found');
    return createPublicKey({ key: selected as JsonWebKey, format: 'jwk' });
  } catch {
    throw AppError.internal('PRIVY_VERIFICATION_KEY_JWK is invalid');
  }
}
