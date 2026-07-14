import { config } from '../config';
import { logger } from '../db/logger';

export type GrantHighwayRewardResult = {
  granted: boolean;
  created?: boolean;
  skipped?: boolean;
  reason?: string;
};

export async function grantHighwayHustleVehicleReward(
  walletAddress: string,
  rewardId: string,
  note: string,
): Promise<GrantHighwayRewardResult> {
  const wallet = walletAddress.trim().toLowerCase();
  const { baseUrl, grantSecret, timeoutMs } = config.highwayHustle;

  if (!grantSecret) {
    logger.warn({ wallet, rewardId }, 'Highway Hustle reward grant secret not configured — skipping');
    return { granted: false, skipped: true, reason: 'grant_secret_not_configured' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/player/rewards/grant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-contest-grant-secret': grantSecret,
      },
      body: JSON.stringify({
        walletAddress: wallet,
        rewardId,
        rewardType: 'vehicle',
        note,
      }),
      signal: controller.signal,
    });

    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || body.success !== true) {
      throw new Error(
        `Highway Hustle reward grant failed (${response.status}): ${String(body.error ?? 'unknown error')}`,
      );
    }

    return {
      granted: true,
      created: body.created === true,
    };
  } finally {
    clearTimeout(timeout);
  }
}
