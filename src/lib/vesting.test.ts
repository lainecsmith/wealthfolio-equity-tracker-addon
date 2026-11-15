import { describe, expect, it } from "vitest";
import { generateVesting } from "./vesting";

function ids() {
  let n = 0;
  return () => `t${++n}`;
}

describe("generateVesting", () => {
  it("builds a 4-year schedule: 25% at a 12-month cliff, then monthly", () => {
    const tranches = generateVesting(4800, "2020-01-15", 12, 25, 36, {
      asOf: "2020-01-15",
      id: ids(),
    });

    expect(tranches).toHaveLength(37);
    expect(tranches[0]).toMatchObject({ date: "2021-01-15", quantity: 1200, vested: false });
    expect(tranches[1]).toMatchObject({ date: "2021-02-15", quantity: 100, vested: false });
    expect(tranches[36]).toMatchObject({ date: "2024-01-15", quantity: 100, vested: false });
    expect(tranches.reduce((sum, t) => sum + t.quantity, 0)).toBe(4800);
  });

  it("marks only tranches on or before asOf as vested", () => {
    const tranches = generateVesting(4800, "2020-01-15", 12, 25, 36, {
      asOf: "2022-06-15",
      id: ids(),
    });

    const vested = tranches.filter((t) => t.vested);
    expect(vested.map((t) => t.date)).toContain("2021-01-15");
    expect(vested.map((t) => t.date)).toContain("2022-06-15");
    expect(vested.map((t) => t.date)).not.toContain("2022-07-15");
    expect(vested.reduce((sum, t) => sum + t.quantity, 0)).toBe(2900);
  });

  it("puts leftover shares on the earliest monthly tranches", () => {
    const tranches = generateVesting(100, "2020-01-15", 0, 0, 3, {
      asOf: "2019-01-01",
      id: ids(),
    });

    expect(tranches.map((t) => t.quantity)).toEqual([34, 33, 33]);
    expect(tranches.map((t) => t.date)).toEqual(["2020-02-15", "2020-03-15", "2020-04-15"]);
  });

  it("vests everything on the grant date when there is no schedule", () => {
    const tranches = generateVesting(500, "2020-01-15", 0, 0, 0, {
      asOf: "2020-01-15",
      id: ids(),
    });

    expect(tranches).toEqual([
      { id: "t1", date: "2020-01-15", quantity: 500, vested: true },
    ]);
  });
});
