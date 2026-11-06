export class ConcurrencyConflictError extends Error {
  readonly code = "CONCURRENCY_CONFLICT";
  readonly status = 409;
  readonly entityType: string;
  readonly entityId: string;
  readonly expectedVersion: number;
  readonly currentVersion: number;
  readonly currentSnapshot: Record<string, unknown>;

  constructor(opts: {
    entityType: string;
    entityId: string;
    expectedVersion: number;
    currentVersion: number;
    currentSnapshot?: Record<string, unknown>;
    message?: string;
  }) {
    super(
      opts.message ||
        `Conflict: ${opts.entityType} '${opts.entityId}' was modified concurrently by another recruiter. Expected version ${opts.expectedVersion}, but current database version is ${opts.currentVersion}.`,
    );
    this.name = "ConcurrencyConflictError";
    this.entityType = opts.entityType;
    this.entityId = opts.entityId;
    this.expectedVersion = opts.expectedVersion;
    this.currentVersion = opts.currentVersion;
    this.currentSnapshot = opts.currentSnapshot || {};
  }
}
