/**
 * Limits paid searches for one agent run. Cache hits never reach reserve(),
 * so they remain free and do not consume the allowance.
 */
export interface SearchBudget {
  beginRun(): void;
  settleRun(): void;
  reserve(): void;
  getUsed(): number;
  getLimit(): number;
}

export function createSearchBudget(limit: number): SearchBudget {
  let used = 0;

  return {
    beginRun() {
      used = 0;
    },
    settleRun() {
      // The count remains available for the settled run's status display.
    },
    reserve() {
      if (used >= limit) {
        throw new Error(
          `Kagi search budget exhausted: ${used}/${limit} paid searches used in this agent run. ` +
            "Use cached Kagi results, kagi_extract on selected URLs, or another available research tool.",
        );
      }
      used++;
    },
    getUsed() {
      return used;
    },
    getLimit() {
      return limit;
    },
  };
}
