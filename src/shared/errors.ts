export type ErrorCode =
  | "AUTH_TOKEN_MISSING"
  | "AUTH_TOKEN_INVALID"
  | "AUTH_TOKEN_EXPIRED"
  | "AUTH_FAILED"
  | "UNSUPPORTED_URL"
  | "CONVERSATION_NOT_FOUND_OR_FORBIDDEN"
  | "REMOTE_REQUEST_FAILED"
  | "CACHE_MISS"
  | "CACHE_READ_FAILED"
  | "CACHE_WRITE_FAILED"
  | "FORMAT_FAILED";

export interface CachePaths {
  json_path?: string;
  markdown_path?: string;
  messages_path?: string;
  metadata_path?: string;
}

export interface SerializedError {
  error_code: ErrorCode;
  message: string;
  recoverable: boolean;
  cache_available?: boolean;
  cache?: CachePaths;
}

export class AppError extends Error {
  readonly error_code: ErrorCode;
  readonly recoverable: boolean;
  readonly cache_available?: boolean;
  readonly cache?: CachePaths;

  constructor(
    error_code: ErrorCode,
    message: string,
    options: { recoverable?: boolean; cache_available?: boolean; cache?: CachePaths } = {}
  ) {
    super(message);
    this.name = "AppError";
    this.error_code = error_code;
    this.recoverable = options.recoverable ?? true;
    this.cache_available = options.cache_available;
    this.cache = options.cache;
  }
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof AppError) {
    return {
      error_code: error.error_code,
      message: error.message,
      recoverable: error.recoverable,
      cache_available: error.cache_available,
      cache: error.cache
    };
  }

  return {
    error_code: "REMOTE_REQUEST_FAILED",
    message: error instanceof Error ? error.message : String(error),
    recoverable: true
  };
}

