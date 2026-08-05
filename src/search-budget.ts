export class BudgetExhaustedError extends Error {
  constructor(used: number, limit:number) {
    const message = `Kagi search budget exhausted: ${used}/${limit} paid searches used in this agent run. ` +
        "Use cached Kagi results, kagi_extract on selected URLs, or another available research tool."
    super(message);
  }
}

/**
 * Where the budget sits in the agent-run lifecycle:
 * - `idle`    — no run has begun yet in this extension instance (fresh
 *               startup, or a session just resumed/forked). The count is
 *               not a record of anything.
 * - `active`  — between `agent_start` and `agent_settled`; the count is live.
 * - `settled` — a run finished; the count is a record of that run and will
 *               reset when the next run begins.
 */
export type BudgetState = "idle" | "active" | "settled";

/**
 * Limits paid searches for one agent run. Cache hits never reach reserve(),
 * so they remain free and do not consume the allowance.
 */
export default class SearchBudget {
  private used = 0;
  private state: BudgetState = "idle";
  private readonly limit: number;

  constructor(limit: number) {
    if (!Number.isFinite(limit) || limit < 0) {
      throw new RangeError("Search budget limit must be a non-negative finite number");
    }
    this.limit = limit;
  }

  beginRun(): void {
    if (this.state === "active") return;
    this.used = 0;
    this.state = "active";
  }

  settleRun(): void {
    // Retain the count for the settled run's status display. Settling
    // without a run leaves the budget idle, so the status never claims a
    // "last run" that never happened.
    if (this.state === "active") this.state = "settled";
  }

  getState(): BudgetState {
    return this.state;
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

