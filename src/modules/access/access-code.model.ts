export type AccessFeature =
  | 'ai_arena'
  | 'league'
  | 'moments'
  | 'games'
  | 'creator_platform'
  | 'creator_studio'
  | 'full_browser';

export type AccessTierId = 'tier_1' | 'tier_2' | 'tier_3' | 'tier_4' | 'tier_5';

export interface AccessTier {
  tier: AccessTierId;
  label: string;
  features: AccessFeature[];
}

export interface VerifyAccessCodeRequest {
  code?: string;
}

export interface VerifyAccessCodeResponse extends AccessTier {
  accessToken: string;
  expiresInDays: number;
}
