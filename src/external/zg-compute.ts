// 0G Compute client — OpenAI-compatible API for gaming moment analysis.

import axios from 'axios';
import { config } from '../config';
import { logger } from '../db/logger';

export interface MomentAnalysis {
  caption: string;
  rankScore: number;
  highlights: string[];
  momentType?: string;
  skillScore?: number;
  reactionQuality?: string;
  rarity?: string;
}

function makeClient() {
  const { computeProviderUrl, computeApiKey } = config.zg;
  if (!computeProviderUrl || !computeApiKey) return null;

  return axios.create({
    baseURL: computeProviderUrl.replace(/\/$/, ''),
    timeout: 45_000,
    headers: { Authorization: `Bearer ${computeApiKey}`, 'Content-Type': 'application/json' },
  });
}

const SYSTEM_PROMPT = `You are a gaming moment analyst for the Kult Web3 platform, verified on 0G Network.
Gaming moments are on-chain clips and screenshots from Kult's games:
- guess-the-ai: player detects AI-generated content (skill = deduction speed, precision)
- highway-hustle: speed racing game (skill = reaction time, lap consistency)
- ai-arena: AI agent battle (skill = strategy, agent build quality)
- kult-royale: battle royale (skill = survival decisions, kill quality)

Analyze the moment and respond with ONLY valid JSON — no markdown, no explanation.
Fields: caption (string, max 120 chars), rankScore (0-100), highlights (array of 3 strings),
momentType (clutch|speedrun|strategy|ai_duel|domination|highlight),
skillScore (0-100), reactionQuality (low|medium|high|exceptional), rarity (common|rare|epic|legendary).`;

export async function analyzeMoment(
  title: string,
  description: string | undefined,
  tags: string[],
  relatedGames: string[],
): Promise<MomentAnalysis | null> {
  const client = makeClient();
  if (!client) {
    logger.warn('0G Compute not configured, skipping analysis');
    return null;
  }

  const userContent = [
    `Title: ${title}`,
    description ? `Description: ${description}` : null,
    tags.length ? `Tags: ${tags.join(', ')}` : null,
    relatedGames.length ? `Games: ${relatedGames.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const res = await client.post<{ choices: { message: { content: string } }[] }>(
      '/v1/chat/completions',
      {
        model: config.zg.computeModel,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        temperature: 0.3,
        max_tokens: 300,
      },
    );

    const raw = res.data.choices[0]?.message.content ?? '';
    const jsonStr = raw.replace(/```json\n?/g, '').replace(/```/g, '').trim();
    return JSON.parse(jsonStr) as MomentAnalysis;
  } catch (err) {
    logger.error({ err, title }, '0G Compute analysis failed');
    return null;
  }
}
