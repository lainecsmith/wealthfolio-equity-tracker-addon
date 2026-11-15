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
      market: { searchTicker },
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
  it("deposits the strike cost, then buys at the strike", async () => {
    const { ctx, created } = host(async () => [{ symbol: "ACME", currency: "USD" }]);

    const id = await recordVestOrExercise(ctx, grant({ symbol: "ACME" }), 10, "2024-06-01", "acct-1");

    expect(id).toBe("act-2");
    expect(created).toEqual([
      expect.objectContaining({
        activityType: "DEPOSIT",
        accountId: "acct-1",
        activityDate: "2024-06-01",
        amount: 50,
        unitPrice: 50,
        currency: "USD",
      }),
      expect.objectContaining({
        activityType: "BUY",
        asset: { symbol: "ACME" },
        quantity: 10,
        unitPrice: 5,
        currency: "USD",
      }),
    ]);
  });

  it("records an RSU as a transfer in at a zero price and does not deposit cash", async () => {
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
        asset: { symbol: "ACME" },
        quantity: 10,
        unitPrice: 0,
      }),
    ]);
  });

  it("uses the searched currency and does not require an existing asset id", async () => {
    const { ctx, created } = host(async () => [
      { symbol: "OTHER", currency: "EUR" },
      { symbol: "ACME", currency: "CAD", existingAssetId: "asset-9" },
    ]);

    await recordVestOrExercise(ctx, grant({ symbol: "acme" }), 2, "2024-06-01", "acct-1");

    const buy = created.find((a) => a.activityType === "BUY");
    expect(buy).toMatchObject({ asset: { symbol: "ACME" }, currency: "CAD", unitPrice: 5 });
    expect(buy?.asset).not.toHaveProperty("id");
  });

  it("creates a generated symbol when search finds nothing", async () => {
    const { ctx, created } = host(async () => {
      throw new Error("offline");
    });

    await recordVestOrExercise(ctx, grant({ symbol: undefined }), 4, "2024-06-01", "acct-1");

    expect(created[1]).toMatchObject({
      activityType: "BUY",
      asset: { symbol: "ACMEIN" },
      currency: "USD",
    });
  });

  it("rejects a non-positive quantity before creating anything", async () => {
    const { ctx, created } = host();

    await expect(recordVestOrExercise(ctx, grant(), 0, "2024-06-01", "acct-1")).rejects.toThrow(
      "Quantity must be positive"
    );
    expect(created).toHaveLength(0);
  });
});
