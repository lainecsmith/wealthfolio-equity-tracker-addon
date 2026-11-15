import { describe, expect, it, vi } from "vitest";
import type { AddonContext } from "@wealthfolio/addon-sdk";
import { recordVestOrExercise } from "./activities";
import type { EquityGrant } from "../types";

function grant(overrides: Partial<EquityGrant> = {}): EquityGrant {
  return {
    id: "g1",
    type: "ISO",
    companyName: "Acme Inc",
    grantDate: "2020-01-15",
    totalQuantity: 100,
    strikePrice: 5,
    vesting: [],
    accountId: "",
    isPrivate: true,
    createdAt: "2020-01-15T00:00:00.000Z",
    updatedAt: "2020-01-15T00:00:00.000Z",
    ...overrides,
  };
}

function host(searchTicker: (symbol: string) => Promise<unknown> = async () => []) {
  const created: Record<string, unknown>[] = [];
  const ctx = {
    api: {
      logger: { error: vi.fn() },
      market: { searchTicker: vi.fn(searchTicker) },
      activities: {
        create: vi.fn(async (activity: Record<string, unknown>) => {
          created.push(activity);
          return { id: `act-${created.length}` };
        }),
      },
    },
  } as unknown as AddonContext;
  return { ctx, created };
}

describe("recordVestOrExercise", () => {
  it("buys a listed symbol and does not add cash", async () => {
    const { ctx, created } = host(async () => [{ symbol: "ACME", currency: "USD" }]);

    const id = await recordVestOrExercise(ctx, grant({ symbol: "ACME" }), 10, "2024-06-01", "acct-1");

    expect(id).toBe("act-1");
    expect(created[0]).toEqual(
      expect.objectContaining({
        activityType: "BUY",
        asset: { symbol: "ACME", name: "Acme Inc", quoteCcy: "USD", instrumentType: "EQUITY" },
        quantity: 10,
        unitPrice: 5,
        amount: 50,
        currency: "USD",
      })
    );
    expect(created[1]).toMatchObject({ activityType: "DEPOSIT", amount: 50, currency: "USD" });
  });

  it("names an existing security by id only", async () => {
    const { ctx, created } = host(async () => [
      { symbol: "ACME", currency: "CAD", existingAssetId: "asset-9", exchangeMic: "XNAS" },
    ]);

    await recordVestOrExercise(ctx, grant({ symbol: "acme" }), 2, "2024-06-01", "acct-1");

    expect(created[0]).toMatchObject({
      activityType: "BUY",
      asset: { id: "asset-9" },
      currency: "CAD",
      unitPrice: 5,
    });
  });

  it("records an RSU as a transfer in", async () => {
    const { ctx, created } = host();

    const id = await recordVestOrExercise(
      ctx,
      grant({ type: "RSU", symbol: "ACME", strikePrice: undefined }),
      10,
      "2024-06-01",
      "acct-1"
    );

    expect(id).toBe("act-1");
    expect(created).toEqual([
      expect.objectContaining({
        activityType: "TRANSFER_IN",
        asset: {
          symbol: "ACME",
          name: "Acme Inc",
          quoteCcy: "USD",
          quoteMode: "MANUAL",
          kind: "OTHER",
        },
        quantity: 10,
        unitPrice: 0,
        amount: 0,
      }),
    ]);
  });

  it("does not search or use a truncated symbol when the grant has none", async () => {
    const search = vi.fn(async () => [{ symbol: "TEMCZZX", currency: "USD" }]);
    const { ctx, created } = host(search);

    await recordVestOrExercise(ctx, grant({ symbol: undefined }), 4, "2024-06-01", "acct-1");

    expect(search).not.toHaveBeenCalled();
    expect(created[0]).toMatchObject({
      activityType: "BUY",
      asset: {
        symbol: "ACMEINC",
        quoteCcy: "USD",
        quoteMode: "MANUAL",
        kind: "OTHER",
      },
    });
  });

  it("ignores a fuzzy search hit", async () => {
    const { ctx, created } = host(async () => [{ symbol: "TEMCZZX", currency: "USD" }]);

    await recordVestOrExercise(ctx, grant({ symbol: "TEMPOR" }), 1, "2024-06-01", "acct-1");

    expect(created[0]).toMatchObject({
      asset: { symbol: "TEMPOR", quoteMode: "MANUAL", quoteCcy: "USD" },
    });
  });

  it("deposits the strike cost after a buy", async () => {
    const { ctx, created } = host(async () => [{ symbol: "ACME", currency: "USD" }]);

    await recordVestOrExercise(ctx, grant({ symbol: "ACME" }), 10, "2024-06-01", "acct-1");

    expect(created.map((activity) => activity.activityType)).toEqual(["BUY", "DEPOSIT"]);
  });

  it("does not send a price when exercising a private company", async () => {
    const { ctx, created } = host();

    await recordVestOrExercise(ctx, grant({ symbol: undefined, strikePrice: 5 }), 4, "2024-08-01", "acct-1");

    expect(created[0].unitPrice).toBeUndefined();
    expect(created[0]).toMatchObject({ activityType: "BUY", amount: 20, quantity: 4 });
  });

  it("rejects a non-positive quantity before creating anything", async () => {
    const { ctx, created } = host();

    await expect(recordVestOrExercise(ctx, grant(), 0, "2024-06-01", "acct-1")).rejects.toThrow(
      "Quantity must be positive"
    );
    expect(created).toHaveLength(0);
  });
});
