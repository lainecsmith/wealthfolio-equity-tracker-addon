import type { VestingTranche } from "../types";

export function newId(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

export function addMonths(iso: string, months: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export interface VestingOptions {
  /** Date used to mark tranches already vested. Defaults to today. */
  asOf?: string;
  id?: () => string;
}

/**
 * Builds a vesting schedule:
 * - cliffMonths: 0 = no cliff
 * - cliffPercent: portion that vests at the cliff (e.g. 25)
 * - postCliffMonths: number of months after the cliff over which the rest vests monthly
 */
export function generateVesting(
  totalQty: number,
  startDate: string,
  cliffMonths: number,
  cliffPercent: number,
  postCliffMonths: number,
  options: VestingOptions = {}
): VestingTranche[] {
  const asOf = options.asOf ?? new Date().toISOString().slice(0, 10);
  const id = options.id ?? newId;
  const tranches: VestingTranche[] = [];

  const cliffQty = cliffMonths > 0 ? Math.floor(totalQty * (cliffPercent / 100)) : 0;
  const remaining = totalQty - cliffQty;

  if (cliffMonths > 0 && cliffQty > 0) {
    const cliffDate = addMonths(startDate, cliffMonths);
    tranches.push({
      id: id(),
      date: cliffDate,
      quantity: cliffQty,
      vested: cliffDate <= asOf,
    });
  }

  if (postCliffMonths > 0 && remaining > 0) {
    const perMonth = Math.floor(remaining / postCliffMonths);
    let leftover = remaining - perMonth * postCliffMonths;
    const firstPost = cliffMonths + 1;

    for (let i = 0; i < postCliffMonths; i++) {
      const qty = perMonth + (leftover > 0 ? 1 : 0);
      if (leftover > 0) leftover--;
      if (qty <= 0) continue;
      const date = addMonths(startDate, firstPost + i);
      tranches.push({
        id: id(),
        date,
        quantity: qty,
        vested: date <= asOf,
      });
    }
  } else if (cliffMonths === 0 && remaining > 0) {
    tranches.push({
      id: id(),
      date: startDate,
      quantity: remaining,
      vested: startDate <= asOf,
    });
  }

  return tranches;
}
