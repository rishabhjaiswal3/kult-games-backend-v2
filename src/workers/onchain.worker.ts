// Processes pending onchain activity jobs and submits them to the EVM contract.

import { ethers } from 'ethers';
import { IWorker } from '../core/types';
import { logger } from '../db/logger';
import { config } from '../config';
import { OnchainActivityRepository } from '../modules/onchain/onchain.repository';
import { OnchainActivityJob, ACTIVITY_CONTRACT_VALUES } from '../modules/onchain/onchain.model';

const ABI = [
  'function recordActivity(bytes32 activityId, address user, uint8 activityType, bytes32 momentIdHash, bytes32 entityIdHash, bytes32 metadataHash, uint256 timestamp) external',
];

export class OnchainActivityWorker implements IWorker {
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly repo: OnchainActivityRepository) {}

  start(): void {
    if (!config.onchain.canSubmit()) {
      logger.info('Onchain worker disabled — missing enabled flag, contract, or relayer key');
      return;
    }
    logger.info({ rpcUrl: config.onchain.rpcUrl, chainId: config.onchain.chainId }, 'Onchain worker started');
    this.schedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    logger.info('Onchain worker stopping');
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), config.onchain.pollSecs * 1000);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.processBatch();
    } catch (err) {
      logger.error({ err }, 'Onchain batch failed');
    }
    this.schedule();
  }

  private async processBatch(): Promise<void> {
    const jobs = await this.repo.findPending(10);

    for (const job of jobs) {
      if (this.stopped) break;

      if (job.attempts >= config.onchain.maxRetries) {
        await this.repo.markFailed(job.activityId, 'max retries exceeded');
        continue;
      }

      try {
        const txHash = await this.submitJob(job);
        await this.repo.markSubmitted(job.activityId, txHash);
        await this.repo.markConfirmed(job.activityId);
        logger.info({ activityId: job.activityId, txHash }, 'Onchain activity submitted');
      } catch (err) {
        logger.warn({ err, activityId: job.activityId, attempts: job.attempts }, 'Onchain submission failed');
        await this.repo.markFailed(job.activityId, String(err));
      }
    }
  }

  private async submitJob(job: OnchainActivityJob): Promise<string> {
    const provider = new ethers.JsonRpcProvider(config.onchain.rpcUrl);
    const signer = new ethers.Wallet(config.onchain.relayerKey, provider);
    const contract = new ethers.Contract(config.onchain.contract, ABI, signer);

    const activityIdBytes = ethers.encodeBytes32String(job.activityId.slice(0, 31));
    const momentIdHash = ethers.keccak256(ethers.toUtf8Bytes(job.momentId));
    const entityIdHash = ethers.keccak256(ethers.toUtf8Bytes(job.entityId));
    const metadataHashBytes = ethers.zeroPadValue(`0x${job.metadataHash.replace(/^0x/, '')}`, 32);
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const activityTypeNum = ACTIVITY_CONTRACT_VALUES[job.activityType] ?? 0;

    const tx = await (contract['recordActivity'] as (...args: unknown[]) => Promise<{ hash: string }>)(
      activityIdBytes,
      job.userWallet,
      activityTypeNum,
      momentIdHash,
      entityIdHash,
      metadataHashBytes,
      timestamp,
    );

    return tx.hash;
  }
}
