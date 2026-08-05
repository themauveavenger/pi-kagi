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
  public used: number;
  private readonly limit: number;

  constructor(limit: number) {
    this.used = 0;
    this.limit = limit;
  }

  beginRun(): void {
    this.used = 0;
  }

  settleRun(): void {
    // left empty on purpose?
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

export function createSearchBudget(limit: number): SearchBudget {
  return new SearchBudget(limit);
}
