let indexing = false;
let indexError: string | null = null;

export function markIndexingStarted(): void {
  indexing = true;
  indexError = null;
}

export function markIndexingSucceeded(): void {
  indexing = false;
  indexError = null;
}

export function markIndexingFailed(message: string): void {
  indexing = false;
  indexError = message;
}

export function getIndexingStatus(): { indexing: boolean; indexError: string | null } {
  return { indexing, indexError };
}
