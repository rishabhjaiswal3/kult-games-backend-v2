// 0G Storage client — shells out to the 0g-storage-client binary.

import { execSync } from 'child_process';
import { config } from '../config';
import { logger } from '../db/logger';

export interface ZgUploadResult {
  rootHash: string;
  txHash: string | null;
}

export function uploadFile(filePath: string): ZgUploadResult {
  const zg = config.zg;
  if (!zg.hasUpload()) throw new Error('0G upload is not configured');

  const args = [
    zg.binaryPath,
    'upload',
    '--url', zg.rpcUrl,
    '--key', zg.privateKey,
    '--indexer', zg.indexerUrl,
    '--file', filePath,
    '--rpc-timeout', zg.rpcTimeout,
    '--rpc-retry-count', String(zg.retryCount),
    '--rpc-retry-interval', zg.retryInterval,
    '--log-level', 'debug',
    '--web3-log-enabled',
  ].join(' ');

  logger.info({ filePath }, '0G upload starting');

  let combined: string;
  try {
    const stdout = execSync(args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    combined = stdout;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    combined = `${e.stdout ?? ''}\n${e.stderr ?? ''}`;
    const fatal = parseFatalError(combined) ?? e.message ?? 'Unknown 0G upload error';
    logger.error({ filePath, error: fatal }, '0G upload failed');
    throw new Error(fatal);
  }

  const rootHash = parseRootHash(combined);
  if (!rootHash) {
    throw new Error('Could not parse root hash from 0g-storage-client output');
  }

  const txHash = parseTxHash(combined);
  logger.info({ filePath, rootHash, txHash }, '0G upload succeeded');
  return { rootHash, txHash };
}

function parseRootHash(output: string): string | null {
  const match = output.match(/root\s*=\s*(0x[0-9a-fA-F]+)/i);
  return match?.[1] ?? null;
}

function parseTxHash(output: string): string | null {
  const match = output.match(/hash=(0x[0-9a-fA-F]+)/i);
  return match?.[1] ?? null;
}

function parseFatalError(output: string): string | null {
  for (const line of output.split('\n')) {
    if (line.toUpperCase().includes('FATA')) {
      return line.trim();
    }
  }
  return null;
}
