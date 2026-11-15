import { describe, expect, it } from "vitest";
import { applyExercise } from "./exercise";
import type { EquityGrant } from "../types";

function grant(): EquityGrant {
  return {
    id: "g1",
    type: "ISO",
    companyName: "Acme",
    grantDate: "2020-01-15",
    totalQuantity: 100,
    strikePrice: 5,
    vesting: [
      { id: "a", date: "2021-01-15", quantity: 50, vested: true },
      { id: "b", date: "2021-02-15", quantity: 50, vested: true },
    ],
    accountId: "",
    isPrivate: true,
    createdAt: "2020-01-15T00:00:00.000Z",
    updatedAt: "2020-01-15T00:00:00.000Z",
  };
}

describe("applyExercise", () => {
  it("adds the exercised quantity and stamps the matching tranche", () => {
    const updated = applyExercise(grant(), 50, "2021-01-15", "act-1");

    expect(updated.exercisedQuantity).toBe(50);
    expect(updated.vesting[0]).toMatchObject({ activityId: "act-1", vested: true });
    expect(updated.vesting[1].activityId).toBeUndefined();
  });

  it("does not stamp a tranche that already has an activity", () => {
    const once = applyExercise(grant(), 50, "2021-01-15", "act-1");
    const twice = applyExercise(once, 10, "2021-01-15", "act-2");

    expect(twice.exercisedQuantity).toBe(60);
    expect(twice.vesting[0].activityId).toBe("act-1");
  });
});
