export type ErrorCode =
  | "INVALID_INPUT"
  | "MISSING_CREDENTIALS"
  | "UNSUPPORTED_CAPABILITY"
  | "TOO_MANY_JOBS"
  | "PROVIDER_AUTH"
  | "PROVIDER_QUOTA"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_REJECTED"
  | "PROVIDER_ERROR"
  | "TIMEOUT"
  | "NETWORK"
  | "INTERRUPTED"
  | "CANCELLED"
  | "EMPTY_AUDIO"
  | "INTERNAL";

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public retryable = false,
    public status = 500,
  ) {
    super(message);
  }
}

export const toJobError = (e: unknown) => {
  if (e instanceof AppError) return { code: e.code, message: e.message, retryable: e.retryable };
  return { code: "INTERNAL" as const, message: e instanceof Error ? e.message : String(e), retryable: true };
};
