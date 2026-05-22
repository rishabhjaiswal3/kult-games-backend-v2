// 0G DA disperser HTTP client — submit blobs and poll for finalization.

import axios from 'axios';
import { config } from '../config';
import { logger } from '../db/logger';

export interface DaReceipt {
  requestId: string;
  batchId?: number;
  blobIndex?: number;
  batchHeaderHash?: string;
  confirmationBlock?: number;
  finalizedAt?: string;
}

type DaBlobStatus =
  | { state: 'processing' }
  | { state: 'confirmed' }
  | { state: 'finalized'; receipt: DaReceipt }
  | { state: 'failed'; reason: string }
  | { state: 'unknown' };

function makeClient() {
  const url = config.zg.daDisperserUrl;
  if (!url) return null;
  return axios.create({ baseURL: url.replace(/\/$/, ''), timeout: 30_000 });
}

export async function disperseBlob(data: Buffer): Promise<string> {
  const client = makeClient();
  if (!client) throw new Error('ZG_DA_DISPERSER_URL is not configured');

  const encoded = data.toString('base64');
  const res = await client.post<{ requestId?: string }>('/DisperseBlob', { data: encoded });
  const requestId = res.data.requestId;
  if (!requestId) throw new Error('DA disperser returned no requestId');
  return requestId;
}

export async function getBlobStatus(requestId: string): Promise<DaBlobStatus> {
  const client = makeClient();
  if (!client) return { state: 'unknown' };

  try {
    const res = await client.get<{
      status?: string;
      info?: {
        blobVerificationProof?: {
          batchId?: number;
          blobIndex?: number;
          batchMetadata?: { batchHeader?: { batchRoot?: string } };
          confirmationBlockNumber?: number;
        };
        requestedAt?: string;
      };
    }>(`/GetBlobStatus/${requestId}`);

    const status = res.data.status?.toLowerCase() ?? '';

    if (status === 'finalized' || status === 'confirmed_onchain') {
      const proof = res.data.info?.blobVerificationProof;
      return {
        state: 'finalized',
        receipt: {
          requestId,
          batchId: proof?.batchId,
          blobIndex: proof?.blobIndex,
          batchHeaderHash: proof?.batchMetadata?.batchHeader?.batchRoot,
          confirmationBlock: proof?.confirmationBlockNumber,
          finalizedAt: res.data.info?.requestedAt,
        },
      };
    }
    if (status === 'confirmed') return { state: 'confirmed' };
    if (status === 'failed' || status === 'insufficient_signatures') {
      return { state: 'failed', reason: `DA status: ${status}` };
    }
    if (status === 'processing' || status === 'dispersing') return { state: 'processing' };

    return { state: 'unknown' };
  } catch (err) {
    logger.error({ err, requestId }, 'DA getBlobStatus error');
    return { state: 'unknown' };
  }
}

export async function waitForFinalization(
  requestId: string,
  pollSecs = 10,
  timeoutSecs = 180,
): Promise<DaReceipt> {
  const deadline = Date.now() + timeoutSecs * 1000;

  while (Date.now() < deadline) {
    const status = await getBlobStatus(requestId);
    if (status.state === 'finalized') return status.receipt;
    if (status.state === 'failed') throw new Error(`DA blob failed: ${status.reason}`);

    await new Promise((r) => setTimeout(r, pollSecs * 1000));
  }

  throw new Error(`DA blob ${requestId} timed out after ${timeoutSecs}s`);
}
