export type GrantType = "RSU" | "ISO" | "NSO";

export interface VestingTranche {
  id: string;
  date: string; // ISO YYYY-MM-DD
  quantity: number;
  vested?: boolean;
  activityId?: string;
}

export interface Valuation {
  date: string;
  fmvPerShare: number;
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
  expirationDate?: string;
  vesting: VestingTranche[];
  accountId: string;
  isPrivate: boolean;
  valuations?: Valuation[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaxEstimate {
  ordinaryIncome?: number;
  amtBargainElement?: number;
  notes: string[];
}
