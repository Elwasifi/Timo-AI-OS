// Phase 5 — API Security Middleware Interfaces
//
// Extension points for future security layers.
// NOT implemented — only defines the contracts that future
// phases will fulfill. The current runtime uses no-op defaults
// so the API layer is ready for security without blocking development.

import type { NextRequest } from 'next/server';

// ---- Authentication ----

export interface AuthContext {
  userId: string | null;
  isAuthenticated: boolean;
  role: 'admin' | 'user' | 'anonymous';
}

export interface AuthMiddleware {
  authenticate(req: NextRequest): Promise<AuthContext>;
}

// ---- Authorization ----

export interface AuthorizationMiddleware {
  authorize(req: NextRequest, context: AuthContext, resource: string): Promise<boolean>;
}

// ---- Rate Limiting ----

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: string;
}

export interface RateLimitMiddleware {
  check(req: NextRequest, limit?: number, windowMs?: number): Promise<RateLimitResult>;
}

// ---- Request Validation ----

export interface ValidationMiddleware {
  validate<T>(req: NextRequest, schema: unknown): Promise<{ valid: boolean; data?: T; errors?: string[] }>;
}

// ---- Audit Logging ----

export interface AuditEntry {
  timestamp: string;
  method: string;
  path: string;
  userId: string | null;
  statusCode: number;
  durationMs: number;
  ip: string | null;
}

export interface AuditMiddleware {
  log(entry: AuditEntry): Promise<void>;
}

// ---- API Versioning ----

export interface VersioningMiddleware {
  getVersion(req: NextRequest): string;
  requireVersion(req: NextRequest, minVersion: string): boolean;
}

// ---- No-op defaults (used until real implementations are added) ----

export const defaultAuth: AuthMiddleware = {
  async authenticate() {
    return { userId: null, isAuthenticated: false, role: 'anonymous' };
  },
};

export const defaultAuthorization: AuthorizationMiddleware = {
  async authorize() {
    return true;
  },
};

export const defaultRateLimit: RateLimitMiddleware = {
  async check() {
    return { allowed: true, remaining: 999, resetAt: new Date(Date.now() + 60000).toISOString() };
  },
};

export const defaultAudit: AuditMiddleware = {
  async log(entry) {
    console.log(`[audit] ${entry.method} ${entry.path} ${entry.statusCode} ${entry.durationMs}ms`);
  },
};

export const defaultVersioning: VersioningMiddleware = {
  getVersion(req) {
    return req.headers.get('x-api-version') ?? '1';
  },
  requireVersion(req, minVersion) {
    const version = req.headers.get('x-api-version') ?? '1';
    return Number(version) >= Number(minVersion);
  },
};

// ---- Middleware Registry (for future dependency injection) ----

export interface SecurityMiddleware {
  auth: AuthMiddleware;
  authorization: AuthorizationMiddleware;
  rateLimit: RateLimitMiddleware;
  validation: ValidationMiddleware;
  audit: AuditMiddleware;
  versioning: VersioningMiddleware;
}

export const securityMiddleware: SecurityMiddleware = {
  auth: defaultAuth,
  authorization: defaultAuthorization,
  rateLimit: defaultRateLimit,
  validation: {
    async validate() {
      return { valid: true };
    },
  },
  audit: defaultAudit,
  versioning: defaultVersioning,
};

export function registerSecurityMiddleware<K extends keyof SecurityMiddleware>(
  name: K,
  middleware: SecurityMiddleware[K],
): void {
  securityMiddleware[name] = middleware;
}
