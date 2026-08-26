// n8n REST API client — the low-level HTTP layer. Handles auth headers,
// timeout, retry with exponential backoff, and SSL. All higher-level
// services (workflow, execution, webhook) build on this client. It never
// reads secrets directly; it receives an N8nConfig from credentialService.

import type { N8nConfig } from "./types.ts";
import { n8nLog } from "./logger.ts";

export class N8nApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public endpoint: string,
    public retryable: boolean,
  ) {
    super(message);
    this.name = "N8nApiError";
  }
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function buildHeaders(config: N8nConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
  if (config.apiKey) headers["X-N8N-API-KEY"] = config.apiKey;
  return headers;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

export interface N8nResponse<T> {
  data: T;
  status: number;
  latency: number;
}

/**
 * Perform a request to the n8n REST API with retry and timeout.
 * Retries on network errors and retryable HTTP statuses up to config.retryCount.
 */
export async function n8nRequest<T>(
  config: N8nConfig,
  path: string,
  options: RequestOptions = {},
): Promise<N8nResponse<T>> {
  const url = new URL(`${config.url}/api/v1${path}`);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const headers = buildHeaders(config);
  const body = options.body ? JSON.stringify(options.body) : undefined;
  const maxAttempts = Math.max(1, config.retryCount + 1);
  let lastError: N8nApiError | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    try {
      const res = await fetch(url.toString(), {
        method: options.method ?? "GET",
        headers,
        body,
        signal: controller.signal,
        // @ts-expect-error: Deno supports verify option; not in DOM lib.
        verify: config.sslVerify,
      });
      clearTimeout(timeoutId);
      const latency = Date.now() - start;
      const text = await res.text();

      if (!res.ok) {
        const retryable = RETRYABLE_STATUS.has(res.status);
        const msg = extractErrorMessage(text, res.status);
        lastError = new N8nApiError(msg, res.status, path, retryable);
        if (retryable && attempt < maxAttempts - 1) {
          const delay = 500 * Math.pow(2, attempt);
          n8nLog.warn("request", `Retryable error ${res.status}, retrying in ${delay}ms`, {
            status: String(res.status), endpoint: path, durationMs: latency,
          });
          await sleep(delay);
          continue;
        }
        throw lastError;
      }

      const data = (text ? JSON.parse(text) : {}) as T;
      n8nLog.debug("request", `${options.method ?? "GET"} ${path} ok`, {
        status: String(res.status), durationMs: latency, endpoint: path,
      });
      return { data, status: res.status, latency };
    } catch (err) {
      clearTimeout(timeoutId);
      const latency = Date.now() - start;
      if (err instanceof N8nApiError) throw err;

      const isAbort = err instanceof DOMException && err.name === "TimeoutError";
      const msg = isAbort ? `Request timed out after ${config.timeout}ms` : (err as Error).message;
      const retryable = isAbort || !(err instanceof Error) || err.message.includes("network");
      lastError = new N8nApiError(msg, 0, path, retryable);

      if (retryable && attempt < maxAttempts - 1) {
        const delay = 500 * Math.pow(2, attempt);
        n8nLog.warn("request", `Network error, retrying in ${delay}ms`, {
          error: msg, endpoint: path, durationMs: latency,
        });
        await sleep(delay);
        continue;
      }
      throw lastError;
    }
  }
  throw lastError ?? new N8nApiError("Exhausted retries", 0, path, false);
}

function extractErrorMessage(text: string, status: number): string {
  try {
    const parsed = JSON.parse(text);
    return parsed.message ?? parsed.error ?? `n8n error (${status})`;
  } catch {
    return text || `n8n error (${status})`;
  }
}
