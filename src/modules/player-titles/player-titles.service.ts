import type { PlayerTitlesRepository } from './player-titles.repository';
import type { TitleGrant } from './player-titles.model';

export interface PlayerTitlesResponse {
  walletAddress: string;
  hasTitles: boolean;
  titles: Array<{ type: string; grantedAt: string }>;
}

export class PlayerTitlesService {
  constructor(private readonly repo: PlayerTitlesRepository) {}

  async getTitles(walletAddress: string): Promise<PlayerTitlesResponse> {
    const doc = await this.repo.findByWallet(walletAddress);
    const titles: TitleGrant[] = doc?.titles ?? [];

    return {
      walletAddress: walletAddress.toLowerCase(),
      hasTitles: titles.length > 0,
      titles: titles.map((t) => ({
        type: t.type,
        grantedAt: t.grantedAt.toISOString(),
      })),
    };
  }
}
