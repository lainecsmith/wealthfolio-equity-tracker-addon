import type { EquityGrant } from "../types";

/** Updates grant state after a vest or exercise activity is recorded. */
export function applyExercise(
  grant: EquityGrant,
  quantity: number,
  date: string,
  activityId?: string
): EquityGrant {
  return {
    ...grant,
    exercisedQuantity: (grant.exercisedQuantity ?? 0) + quantity,
    vesting: grant.vesting.map((t) =>
      t.date === date && !t.activityId ? { ...t, activityId, vested: true } : t
    ),
  };
}
