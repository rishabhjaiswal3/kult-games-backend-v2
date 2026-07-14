import { config } from '../config';
import { logger } from '../db/logger';

export type GrantArenaQuestRewardResult = {
  granted: boolean;
  txHash?: string;
  amountArena?: string;
  skipped?: boolean;
  reason?: string;
};

export async function grantArenaQuestReward(
  playerAddress: string,
  amountArena: string,
  reason: string,
): Promise<GrantArenaQuestRewardResult> {
  const { baseUrl, serviceKey, timeoutMs } = config.arenaChain;

  if (!serviceKey) {
    logger.warn({ playerAddress, amountArena }, 'Arena chain service key not configured — skipping quest reward');
    return { granted: false, skipped: true, reason: 'service_key_not_configured' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/v1/arena/rewards/quest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Key': serviceKey,
      },
      body: JSON.stringify({
        playerAddress,
        amountArena,
        reason,
      }),
      signal: controller.signal,
    });

    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(
        `Arena quest reward grant failed (${response.status}): ${String(body.error ?? 'unknown error')}`,
      );
    }

    return {
      granted: true,
      txHash: typeof body.txHash === 'string' ? body.txHash : undefined,
      amountArena: typeof body.amountArena === 'string' ? body.amountArena : amountArena,
    };
  } finally {
    clearTimeout(timeout);
  }
}
