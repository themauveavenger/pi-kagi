export class BudgetExhaustedError extends Error {
  constructor(used: number, limit:number) {
    const message = `Kagi search budget exhausted: ${used}/${limit} paid searches used in this agent run. ` +
        "Use cached Kagi results, kagi_extract on selected URLs, or another available research tool."
    super(message);
  }
}

/**
 * Limits paid searches for one agent run. Cache hits never reach reserve(),
 * so they remain free and do not consume the allowance.
 */
export default class SearchBudget {
  private used = 0;
  private active = false;
  private readonly limit: number;

  constructor(limit: number) {
    if (!Number.isFinite(limit) || limit < 0) {
      throw new RangeError("Search budget limit must be a non-negative finite number");
    }
    this.limit = limit;
  }

  beginRun(): void {
    if (this.active) return;
    this.used = 0;
    this.active = true;
  }

  settleRun(): void {
    // Retain the count for the settled run's status display.
    this.active = false;
  }

  getUsed(): number {
    return this.used;
  }

  getLimit(): number {
    return this.limit;
  }

  reserve(): void {
    if (this.used >= this.limit) {
      throw new BudgetExhaustedError(this.used, this.limit);
    }
    this.used++;
  }
}

