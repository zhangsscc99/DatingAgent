/**
 * P05 — in-memory last-value recorder of the most recent 5xx response sent
 * under `/api/*`. Surfaced only by the localhost-only verbose health probe;
 * nothing is persisted and it resets on process restart.
 */
export interface LastApiError {
  /** ISO timestamp of when the failing response finished. */
  ts: string;
  /** Request path without the query string (queries can carry user input). */
  path: string;
  status: number;
  method: string;
}

export class LastApiErrorRecorder {
  private current: LastApiError | null = null;

  record(entry: LastApiError): void {
    this.current = entry;
  }

  latest(): LastApiError | null {
    return this.current;
  }
}

/** Shared recorder for the running server. */
export const apiErrors = new LastApiErrorRecorder();
