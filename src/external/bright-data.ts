// Bright Data post scraper — trigger → poll → snapshot download pattern.

import axios from 'axios';
import { config } from '../config';
import { logger } from '../db/logger';

const bd = config.brightData;

async function triggerScrape(datasetId: string, urls: string[]): Promise<string> {
  const url = `${bd.baseUrl}${bd.triggerPath}?dataset_id=${datasetId}&include_errors=true`;
  const payload = urls.map((u) => ({ url: u }));

  const res = await axios.post<{ snapshot_id: string }>(url, payload, {
    headers: { Authorization: `Bearer ${bd.apiKey}`, 'Content-Type': 'application/json' },
  });

  return res.data.snapshot_id;
}

async function pollUntilReady(snapshotId: string): Promise<void> {
  const pollUrl = `${bd.baseUrl}${bd.progressPath}/${snapshotId}`;
  const deadline = Date.now() + bd.pollTimeout * 1000;

  while (Date.now() < deadline) {
    const res = await axios.get<{ status: string }>(pollUrl, {
      headers: { Authorization: `Bearer ${bd.apiKey}` },
    });

    if (res.data.status === 'ready') return;
    if (res.data.status === 'failed') throw new Error(`Snapshot ${snapshotId} failed`);

    await new Promise((r) => setTimeout(r, bd.pollInterval * 1000));
  }

  throw new Error(`Snapshot ${snapshotId} timed out after ${bd.pollTimeout}s`);
}

async function downloadSnapshot(snapshotId: string): Promise<unknown[]> {
  const url = `${bd.baseUrl}${bd.snapshotPath}/${snapshotId}?format=json`;
  const res = await axios.get<unknown[]>(url, {
    headers: { Authorization: `Bearer ${bd.apiKey}` },
  });
  return res.data;
}

async function scrape(datasetId: string, urls: string[]): Promise<unknown[]> {
  if (!urls.length) return [];

  logger.info({ datasetId, count: urls.length }, 'Starting Bright Data scrape');
  const snapshotId = await triggerScrape(datasetId, urls);
  await pollUntilReady(snapshotId);
  return downloadSnapshot(snapshotId);
}

// ── Per-platform helpers ──────────────────────────────────────────────────────

export const brightData = {
  scrapeTwitter:   (urls: string[]) => scrape(bd.datasets.twitter,   urls),
  scrapeInstagram: (urls: string[]) => scrape(bd.datasets.instagram,  urls),
  scrapeTikTok:    (urls: string[]) => scrape(bd.datasets.tiktok,     urls),
  scrapeFacebook:  (urls: string[]) => scrape(bd.datasets.facebook,   urls),
  scrapeReddit:    (urls: string[]) => scrape(bd.datasets.reddit,     urls),
  scrapeLinkedIn:  (urls: string[]) => scrape(bd.datasets.linkedin,   urls),
  scrapePinterest: (urls: string[]) => scrape(bd.datasets.pinterest,  urls),

  scrapeByPlatform(platform: string, urls: string[]): Promise<unknown[]> {
    const map: Record<string, (u: string[]) => Promise<unknown[]>> = {
      twitter:   this.scrapeTwitter.bind(this),
      instagram: this.scrapeInstagram.bind(this),
      tiktok:    this.scrapeTikTok.bind(this),
      facebook:  this.scrapeFacebook.bind(this),
      reddit:    this.scrapeReddit.bind(this),
      linkedin:  this.scrapeLinkedIn.bind(this),
      pinterest: this.scrapePinterest.bind(this),
    };
    const fn = map[platform.toLowerCase()];
    if (!fn) throw new Error(`Unknown platform: ${platform}`);
    return fn(urls);
  },
};
