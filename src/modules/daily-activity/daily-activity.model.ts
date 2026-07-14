export interface DailyActivityDoc {
  walletAddress: string;
  /** UTC calendar day key, e.g. 2026-07-14 */
  activityDate: string;
  firstLoginAt: Date;
  lastLoginAt: Date;
  loginCount: number;
  lastLoginIp?: string;
  createdAt: Date;
  updatedAt: Date;
}
