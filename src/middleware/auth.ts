import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ethers } from 'ethers';
import { config } from '../config';
import { AppError } from '../core/error';
import { AuthPlayer } from '../core/types';

// ── Augment Express Request ───────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      player?: AuthPlayer;
    }
  }
}

// ── JWT helpers ───────────────────────────────────────────────────────────────

interface JwtPayload {
  wallet_address: string;
}

export function signToken(walletAddress: string): string {
  return jwt.sign({ wallet_address: walletAddress }, config.auth.jwtSecret, {
    expiresIn: `${config.auth.jwtExpiryDays}d`,
  });
}

function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.auth.jwtSecret) as JwtPayload;
}

// ── SIWE helpers ──────────────────────────────────────────────────────────────

export function recoverSigner(message: string, signature: string): string {
  return ethers.verifyMessage(message, signature);
}

export function verifySiweSignature(wallet: string, message: string, signature: string): void {
  const recovered = recoverSigner(message, signature);
  if (recovered.toLowerCase() !== wallet.toLowerCase()) {
    throw AppError.unauthorized('Invalid signature — wallet ownership not proven');
  }
}

export function extractNonce(message: string): string | null {
  for (const line of message.split('\n')) {
    if (line.startsWith('Nonce: ')) return line.replace('Nonce: ', '').trim();
  }
  return null;
}

// ── Auth middleware ───────────────────────────────────────────────────────────

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(AppError.unauthorized('Missing or invalid bearer token'));
  }

  try {
    const token = header.slice(7);
    const payload = verifyToken(token);
    req.player = { walletAddress: payload.wallet_address };
    next();
  } catch {
    next(AppError.unauthorized('Invalid or expired token'));
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!config.app.isAdmin()) {
    return next(AppError.forbidden('Admin access only'));
  }
  next();
}
