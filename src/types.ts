export type GrantType = "RSU" | "ISO" | "NSO";

export interface VestingTranche {
  id: string;
  date: string; // ISO YYYY-MM-DD
  quantity: number;
  vested?: boolean;
  activityId?: string;
}

export interface EquityGrant {
  id: string;
  externalId?: string;
  type: GrantType;
  companyName: string;
  symbol?: string;
  grantDate: string;
  totalQuantity: number;
  strikePrice?: number;
  /** Current share price for a private company. Not used for a listed symbol. */
  fmv?: number;
  expirationDate?: string;
  vesting: VestingTranche[];
  accountId: string;
  isPrivate: boolean;
  exercisedQuantity?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
