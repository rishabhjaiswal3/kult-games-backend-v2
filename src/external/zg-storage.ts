// 0G Storage client — invokes the binary directly without a command shell.

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { logger } from '../db/logger';

export interface ZgUploadResult {
  rootHash: string;
  txHash: string | null;
}

export function uploadFile(filePath: string): ZgUploadResult {
  const zg = config.zg;
  if (!zg.hasUpload()) throw new Error('0G upload is not configured');
  const binaryPath = zg.binaryPath!;
  const rpcUrl = zg.rpcUrl!;
  const privateKey = zg.privateKey!;
  const indexerUrl = zg.indexerUrl!;
  const rpcTimeout = zg.rpcTimeout!;
  const retryInterval = zg.retryInterval!;

  const resolvedFile = path.resolve(filePath);
  const resolvedTmpDir = path.resolve(config.spaces.tmpDir);
  const relativePath = path.relative(resolvedTmpDir, resolvedFile);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('0G upload file must be inside the configured temporary directory');
  }
  const stat = fs.lstatSync(resolvedFile);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('0G upload path must be a regular file');
  }

  const args = [
    'upload',
    '--url', rpcUrl,
    '--key', privateKey,
    '--indexer', indexerUrl,
    '--file', filePath,
    '--rpc-timeout', rpcTimeout,
    '--rpc-retry-count', String(zg.retryCount),
    '--rpc-retry-interval', retryInterval,
    '--log-level', 'debug',
    '--web3-log-enabled',
  ];

  logger.info({ filePath }, '0G upload starting');

  let combined: string;
  try {
    const stdout = execFileSync(binaryPath, args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      timeout: 15 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
    });
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
