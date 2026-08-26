// Phase 5 — Standardized API Response Wrapper
//
// Every Platform API endpoint returns this envelope.
// Consistent, typed, and predictable for the v0 UI.

export interface ApiSuccess<T> {
  success: true;
  timestamp: string;
  data: T;
  metadata: {
    version: string;
    durationMs: number;
    [key: string]: unknown;
  };
}

export interface ApiError {
  success: false;
  timestamp: string;
  data: null;
  metadata: {
    version: string;
    durationMs: number;
  };
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export const API_VERSION = '1';

export function ok<T>(
  data: T,
  startTime: number,
  extraMeta?: Record<string, unknown>,
): ApiSuccess<T> {
  return {
    success: true,
    timestamp: new Date().toISOString(),
    data,
    metadata: {
      version: API_VERSION,
      durationMs: Date.now() - startTime,
      ...extraMeta,
    },
  };
}

export function fail(
  code: string,
  message: string,
  startTime: number,
  details?: unknown,
): ApiError {
  return {
    success: false,
    timestamp: new Date().toISOString(),
    data: null,
    metadata: {
      version: API_VERSION,
      durationMs: Date.now() - startTime,
    },
    error: { code, message, details },
  };
}

export function badRequest(message: string, startTime: number, details?: unknown): ApiError {
  return fail('BAD_REQUEST', message, startTime, details);
}

export function notFound(message: string, startTime: number): ApiError {
  return fail('NOT_FOUND', message, startTime);
}

export function internalError(message: string, startTime: number, details?: unknown): ApiError {
  return fail('INTERNAL_ERROR', message, startTime, details);
}
