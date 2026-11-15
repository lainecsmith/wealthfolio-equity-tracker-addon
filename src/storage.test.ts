import { describe, expect, it } from "vitest";
import { exercisedQuantity, vestedQuantity } from "./storage";
import type { EquityGrant } from "./types";

function grant(overrides: Partial<EquityGrant> = {}): EquityGrant {
  return {
    id: "g1",
    type: "ISO",
    companyName: "Acme",
    grantDate: "2020-01-15",
    totalQuantity: 100,
    vesting: [
      { id: "a", date: "2021-01-15", quantity: 25, vested: true },
      { id: "b", date: "2024-01-15", quantity: 75, vested: false },
    ],
    accountId: "",
    isPrivate: true,
    createdAt: "2020-01-15T00:00:00.000Z",
    updatedAt: "2020-01-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("vestedQuantity", () => {
  it("counts only tranches that are marked vested and on or before the date", () => {
    expect(vestedQuantity(grant(), "2024-06-01")).toBe(25);
  });

  it("does not count a future tranche even if it is marked vested", () => {
    const g = grant({
      vesting: [{ id: "a", date: "2025-01-15", quantity: 25, vested: true }],
    });
    expect(vestedQuantity(g, "2024-06-01")).toBe(0);
  });
});

describe("exercisedQuantity", () => {
  it("is zero until an exercise is recorded", () => {
    expect(exercisedQuantity(grant())).toBe(0);
    expect(exercisedQuantity(grant({ exercisedQuantity: 10 }))).toBe(10);
  });
});
