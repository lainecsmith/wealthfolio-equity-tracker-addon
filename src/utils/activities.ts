import type { AddonContext } from "@wealthfolio/addon-sdk";
import type { EquityGrant } from "../types";
import { getLatestValuation } from "../storage";

/**
 * Records a vest (RSU) or exercise (ISO/NSO) as a core Wealthfolio activity.
 * RSUs → external TRANSFER_IN at FMV cost basis
 * Options → BUY at strike price
 */
export async function recordVestOrExercise(
  ctx: AddonContext,
  grant: EquityGrant,
  quantity: number,
  date: string,
  accountId: string
): Promise<string | undefined> {
  if (quantity <= 0) throw new Error("Quantity must be positive");

  const symbol = grant.symbol || grant.companyName.replace(/\s+/g, "").toUpperCase().slice(0, 6);
  const fmv = getLatestValuation(grant) ?? grant.strikePrice ?? 0;

  if (grant.type === "RSU") {
    // External TRANSFER_IN so cost basis is set to FMV (ordinary income)
    const activity = await ctx.api.activities.create({
      accountId,
      activityType: "TRANSFER_IN",
      activityDate: date,
      asset: { symbol },
      quantity,
      unitPrice: fmv,
      currency: "USD",
      status: "POSTED",
    });
    return activity.id;
  }

  // ISO / NSO exercise → BUY at strike
  const strike = grant.strikePrice ?? 0;
  const activity = await ctx.api.activities.create({
    accountId,
    activityType: "BUY",
    activityDate: date,
    asset: { symbol },
    quantity,
    unitPrice: strike,
    currency: "USD",
    status: "POSTED",
  });
  return activity.id;
}

export function estimateTax(grant: EquityGrant, quantity: number, fmv: number): string[] {
  const notes: string[] = [];
  if (grant.type === "RSU") {
    const income = quantity * fmv;
    notes.push(`Ordinary income (approx): $${income.toFixed(2)}`);
    notes.push("Withholding typically applied at vest. Cost basis = FMV.");
  } else if (grant.type === "ISO") {
    const bargain = Math.max(0, fmv - (grant.strikePrice ?? 0)) * quantity;
    notes.push(`AMT bargain element (approx): $${bargain.toFixed(2)}`);
    notes.push("No regular tax at exercise. Qualifying disposition after 2y/1y may yield LTCG.");
  } else {
    const income = Math.max(0, fmv - (grant.strikePrice ?? 0)) * quantity;
    notes.push(`Ordinary income at exercise (approx): $${income.toFixed(2)}`);
  }
  return notes;
}
