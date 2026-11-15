import type { AddonContext } from "@wealthfolio/addon-sdk";
import type { EquityGrant } from "../types";

type Listing = {
  symbol: string;
  currency: string;
  listed: boolean;
  exchangeMic?: string;
  existingAssetId?: string;
  instrumentType?: string;
};

export function privateSymbol(companyName: string): string {
  const cleaned = companyName.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return (cleaned || "PRIVATE").slice(0, 12);
}

async function resolveSymbol(ctx: AddonContext, symbol: string): Promise<Listing> {
  let results: unknown;
  try {
    results = await ctx.api.market.searchTicker(symbol);
  } catch (error) {
    throw new Error(`market.searchTicker failed: ${String(error)}`);
  }
  try {
    const hits = Array.isArray(results) ? results : results ? [results] : [];
    const exact = hits.find(
      (h: { symbol?: string }) => (h.symbol || "").toUpperCase() === symbol.toUpperCase()
    ) as
      | {
          symbol?: string;
          currency?: string;
          exchangeMic?: string;
          existingAssetId?: string;
          quoteType?: string;
          instrumentType?: string;
        }
      | undefined;
    if (exact) {
      return {
        symbol: exact.symbol || symbol,
        currency: exact.currency || "USD",
        listed: true,
        exchangeMic: exact.exchangeMic,
        existingAssetId: exact.existingAssetId,
        instrumentType: exact.instrumentType || exact.quoteType,
      };
    }
  } catch (error) {
    throw new Error(`market.searchTicker failed: ${String(error)}`);
  }
  return { symbol, currency: "USD", listed: false };
}

function assetFor(grant: EquityGrant, listing: Listing) {
  // An existing security is named by its id only. Sending a symbol next to
  // the id makes Wealthfolio infer the listing again and then refuse the row.
  if (listing.existingAssetId) {
    return { id: listing.existingAssetId };
  }
  if (listing.listed) {
    return {
      symbol: listing.symbol,
      name: grant.companyName,
      quoteCcy: listing.currency,
      instrumentType: listing.instrumentType || "EQUITY",
      ...(listing.exchangeMic ? { exchangeMic: listing.exchangeMic } : {}),
    };
  }
  return {
    symbol: listing.symbol,
    name: grant.companyName,
    kind: "OTHER",
    quoteCcy: "USD",
    quoteMode: "MANUAL",
  };
}

function plainActivity(activity: Record<string, unknown>) {
  const asset = activity.asset as Record<string, unknown> | undefined;
  const payload: Record<string, unknown> = {
    accountId: String(activity.accountId ?? ""),
    activityType: String(activity.activityType ?? ""),
    activityDate: String(activity.activityDate ?? ""),
    amount: Number(activity.amount ?? 0),
    currency: String(activity.currency ?? "USD"),
    status: "POSTED",
  };
  if (activity.quantity !== undefined) payload.quantity = Number(activity.quantity);
  if (activity.unitPrice !== undefined) payload.unitPrice = Number(activity.unitPrice);
  if (asset) {
    const next: Record<string, string> = {};
    for (const key of [
      "id",
      "symbol",
      "name",
      "quoteCcy",
      "instrumentType",
      "exchangeMic",
      "kind",
      "quoteMode",
    ]) {
      const value = asset[key];
      if (typeof value === "string" && value) next[key] = value;
    }
    payload.asset = next;
  }
  return payload;
}

async function latestManualPrice(ctx: AddonContext, symbol: string): Promise<number | undefined> {
  const getHistory = ctx.api.quotes?.getHistory;
  if (!getHistory || !symbol) return undefined;
  try {
    const history = await getHistory(symbol);
    const quotes = Array.isArray(history) ? history : [];
    let best: { time: string; close: number } | undefined;
    for (const quote of quotes as Array<{ timestamp?: string; close?: number; adjclose?: number }>) {
      const close = Number(quote?.close ?? quote?.adjclose);
      const time = String(quote?.timestamp ?? "");
      if (!Number.isFinite(close) || close <= 0) continue;
      if (!best || time > best.time) best = { time, close };
    }
    return best?.close;
  } catch {
    return undefined;
  }
}

async function restoreManualPrice(
  ctx: AddonContext,
  assetId: string,
  price: number,
  currency: string
) {
  const timestamp = new Date().toISOString();
  await ctx.api.quotes.update(assetId, {
    id: "",
    createdAt: timestamp,
    dataSource: "MANUAL",
    timestamp,
    assetId,
    open: price,
    high: price,
    low: price,
    close: price,
    adjclose: price,
    volume: 0,
    currency,
  } as never);
}

async function createActivity(ctx: AddonContext, activity: Record<string, unknown>) {
  const payload = plainActivity(activity);
  try {
    return await ctx.api.activities.create(payload as never);
  } catch (error) {
    throw new Error(`activities.create failed: ${String(error)}`);
  }
}

export async function recordVestOrExercise(
  ctx: AddonContext,
  grant: EquityGrant,
  quantity: number,
  date: string,
  accountId: string
): Promise<string | undefined> {
  if (quantity <= 0) throw new Error("Quantity must be positive");

  const typedSymbol = grant.symbol?.trim();
  const listing = typedSymbol
    ? await resolveSymbol(ctx, typedSymbol)
    : { symbol: privateSymbol(grant.companyName), currency: "USD", listed: false };
  const asset = assetFor(grant, listing);
  const currency = listing.listed ? listing.currency : "USD";
  const strike = grant.strikePrice ?? 0;

  if (grant.type === "RSU") {
    const activity = await createActivity(ctx, {
      accountId,
      activityType: "TRANSFER_IN",
      activityDate: date,
      asset,
      quantity,
      unitPrice: 0,
      amount: 0,
      currency,
      status: "POSTED",
    });
    return activity.id;
  }

  const savedPrice = listing.listed ? undefined : await latestManualPrice(ctx, listing.symbol);

  const cost = quantity * strike;
  const activity = await createActivity(ctx, {
    accountId,
    activityType: "BUY",
    activityDate: date,
    asset,
    quantity,
    unitPrice: strike,
    amount: cost,
    currency,
    status: "POSTED",
  });

  // The buy spends cash. The money came from outside this account, so record
  // a matching deposit. A failure here must not hide the buy.
  if (cost > 0) {
    try {
      await createActivity(ctx, {
        accountId,
        activityType: "DEPOSIT",
        activityDate: date,
        amount: cost,
        currency,
        status: "POSTED",
      });
    } catch {
      // The shares are already recorded.
    }
  }

  // A private-company buy records the strike as that day's price. Put the
  // previous price back so the security stays at its current FMV.
  const assetId = activity?.assetId || listing.existingAssetId || listing.symbol;
  if (!listing.listed && savedPrice !== undefined && savedPrice !== strike && assetId) {
    try {
      await restoreManualPrice(ctx, assetId, savedPrice, currency);
    } catch {
      // The shares are already recorded.
    }
  }

  return activity.id;
}
