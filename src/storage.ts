import type { AddonContext } from "@wealthfolio/addon-sdk";
import type { EquityGrant } from "./types";

const STORAGE_KEY = "equity-grants";

export async function loadGrants(ctx: AddonContext): Promise<EquityGrant[]> {
  const raw = await ctx.api.storage.get(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as EquityGrant[];
  } catch {
    return [];
  }
}

export async function saveGrants(ctx: AddonContext, grants: EquityGrant[]): Promise<void> {
  await ctx.api.storage.set(STORAGE_KEY, JSON.stringify(grants));
}

export async function upsertGrant(ctx: AddonContext, grant: EquityGrant): Promise<void> {
  const grants = await loadGrants(ctx);
  const idx = grants.findIndex((g) => g.id === grant.id);
  const now = new Date().toISOString();
  if (idx >= 0) {
    grants[idx] = { ...grant, updatedAt: now };
  } else {
    grants.push({ ...grant, createdAt: now, updatedAt: now });
  }
  await saveGrants(ctx, grants);
}

export async function deleteGrant(ctx: AddonContext, id: string): Promise<void> {
  const grants = await loadGrants(ctx);
  await saveGrants(ctx, grants.filter((g) => g.id !== id));
}

export function getLatestValuation(grant: EquityGrant): number | undefined {
  if (!grant.valuations?.length) return undefined;
  return [...grant.valuations].sort((a, b) => b.date.localeCompare(a.date))[0].fmvPerShare;
}

export function vestedQuantity(grant: EquityGrant, asOf = new Date().toISOString().slice(0, 10)): number {
  return grant.vesting
    .filter((t) => t.date <= asOf && t.vested !== false)
    .reduce((sum, t) => sum + t.quantity, 0);
}

export function unvestedQuantity(grant: EquityGrant): number {
  return grant.totalQuantity - vestedQuantity(grant);
}
