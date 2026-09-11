import jwt, { JwtPayload } from 'jsonwebtoken';
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../types';
import { pool } from '../db/index';

let runtimeEphemeralSecret: string | null = null;

function sanitizeSecret(raw?: string): string {
  return (raw || '').trim().replace(/^["']|["']$/g, '');
}

const JWT_SIGN_OPTIONS: jwt.SignOptions = {
  expiresIn: '12h',
  algorithm: 'HS256',
  issuer: 'saka-homes-inventory'
};

const JWT_VERIFY_OPTIONS: jwt.VerifyOptions = {
  algorithms: ['HS256'],
  issuer: 'saka-homes-inventory'
};

/**
 * Application JWT secret. Never falls back to an unsigned-token path.
 * Production requires JWT_SECRET (or SUPABASE_JWT_SECRET) to be configured.
 */
export function getJwtSecret(): string {
  const appSecret = sanitizeSecret(process.env.JWT_SECRET);
  if (appSecret) {
    return appSecret;
  }

  const supabaseSecret = sanitizeSecret(process.env.SUPABASE_JWT_SECRET);
  if (supabaseSecret) {
    return supabaseSecret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET (or SUPABASE_JWT_SECRET) must be configured in production.');
  }

  if (!runtimeEphemeralSecret) {
    runtimeEphemeralSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[SECURITY] No JWT_SECRET configured. Generated an ephemeral in-memory secret for local development only. Sessions will not survive process restarts.');
  }
  return runtimeEphemeralSecret;
}

export function getJwtVerificationSecrets(): string[] {
  const secrets: string[] = [];
  const appSecret = sanitizeSecret(process.env.JWT_SECRET);
  const supabaseSecret = sanitizeSecret(process.env.SUPABASE_JWT_SECRET);
  if (appSecret) secrets.push(appSecret);
  if (supabaseSecret && supabaseSecret !== appSecret) secrets.push(supabaseSecret);
  if (secrets.length === 0 && process.env.NODE_ENV !== 'production') {
    secrets.push(getJwtSecret());
  }
  return secrets;
}

export function validateSecurityConfig(): void {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const jwtSecret = sanitizeSecret(process.env.JWT_SECRET);
  const supabaseSecret = sanitizeSecret(process.env.SUPABASE_JWT_SECRET);
  const secret = jwtSecret || supabaseSecret;

  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET or SUPABASE_JWT_SECRET must be set to a strong value (32+ characters) when NODE_ENV=production.');
  }
}

/**
 * Verify a JWT with the application secret and, if configured, the Supabase JWT secret.
 * Unsigned or incorrectly signed tokens are rejected. No decode-without-verify fallback.
 */
export function verifySignedToken(token: string): JwtPayload {
  const secrets = getJwtVerificationSecrets();
  if (secrets.length === 0) {
    const err = new Error('Authentication is not configured.');
    (err as any).name = 'JsonWebTokenError';
    throw err;
  }

  let lastError: any = null;
  for (const secret of secrets) {
    try {
      const decoded = jwt.verify(token, secret);
      if (typeof decoded === 'string') {
        const err = new Error('Invalid authentication token.');
        (err as any).name = 'JsonWebTokenError';
        throw err;
      }
      return decoded;
    } catch (err: any) {
      if (err?.name === 'TokenExpiredError') {
        throw err;
      }
      lastError = err;
    }
  }
  throw lastError || new Error('Invalid authentication token.');
}

/**
 * Generate a signed JWT token for an authenticated user.
 */
export function generateAuthToken(user: { id: string; username: string; role: string; fullName?: string; tokenVersion?: number }): string {
  const secret = getJwtSecret();
  return jwt.sign(
    {
      sub: user.id,
      userId: user.id,
      username: user.username,
      role: user.role,
      fullName: user.fullName || user.username,
      tokenVersion: user.tokenVersion || 1
    },
    secret,
    JWT_SIGN_OPTIONS
  );
}

export interface AuthUserPayload {
  id: string;
  username: string;
  role: UserRole;
  fullName: string;
  mustChangePassword?: boolean;
  tokenVersion?: number;
  lastActivityAt?: Date | string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUserPayload;
    }
  }
}

export interface SupabaseJwtPayload {
  sub: string;
  userId?: string;
  username?: string;
  email?: string;
  aud?: string;
  iss?: string;
  role?: string;
  user_metadata?: {
    role?: UserRole;
    full_name?: string;
    name?: string;
    [key: string]: any;
  };
  app_metadata?: {
    role?: string;
    provider?: string;
    [key: string]: any;
  };
  exp?: number;
  iat?: number;
  tokenVersion?: number;
}

function isTokenExpiredError(err: any): boolean {
  return err?.name === 'TokenExpiredError';
}

/**
 * Verify an application-issued JWT. Never accepts unsigned / decoded-only tokens.
 */
export function verifyAppToken(token: string): jwt.JwtPayload {
  return jwt.verify(token, getJwtSecret(), JWT_VERIFY_OPTIONS) as jwt.JwtPayload;
}

/**
 * Confirm a Supabase access token with the Supabase Auth API (signature checked
 * by Supabase). Falls back to local HMAC verification when SUPABASE_JWT_SECRET is set.
 */
export async function verifySupabaseAccessToken(token: string): Promise<{
  id: string;
  email?: string;
  fullName?: string;
  userMetadata?: Record<string, any>;
} | null> {
  const rawSupabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/^["']|["']$/g, '');
  const rawAnonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim().replace(/^["']|["']$/g, '');

  if (rawSupabaseUrl && rawAnonKey) {
    try {
      const endpoint = `${rawSupabaseUrl.replace(/\/$/, '')}/auth/v1/user`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: rawAnonKey
        },
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!res.ok) {
        console.warn('[AUTH] Supabase token introspection returned', res.status);
      } else {
        const data: any = await res.json();
        if (data?.id) {
          return {
            id: String(data.id),
            email: data.email,
            fullName: data.user_metadata?.full_name || data.user_metadata?.name,
            userMetadata: data.user_metadata || {}
          };
        }
      }
    } catch (err) {
      console.warn('[AUTH] Supabase token introspection failed:', (err as Error).message);
    }
  }

  const supabaseJwtSecret = process.env.SUPABASE_JWT_SECRET?.trim();
  if (supabaseJwtSecret) {
    try {
      const decoded = jwt.verify(token, supabaseJwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      const userId = decoded.sub || (decoded as any).userId || (decoded as any).id;
      if (!userId) return null;
      return {
        id: String(userId),
        email: (decoded as any).email || (decoded as any).username,
        fullName: (decoded as any).user_metadata?.full_name || (decoded as any).user_metadata?.name || (decoded as any).fullName,
        userMetadata: (decoded as any).user_metadata || {}
      };
    } catch {
      return null;
    }
  }

  return null;
}

function requestPath(req: Request): string {
  return `${req.baseUrl || ''}${req.path || ''}`;
}

export const SESSION_IDLE_MS = 15 * 60 * 1000;

function isAllowedDuringForcedPasswordChange(req: Request): boolean {
  const path = requestPath(req);
  if (req.method === 'GET' && path.endsWith('/auth/me')) return true;
  if (req.method === 'POST' && path.endsWith('/auth/change-password')) return true;
  if (req.method === 'POST' && path.endsWith('/auth/logout')) return true;
  return false;
}

function isIdleExempt(req: Request): boolean {
  const path = requestPath(req);
  if (req.method === 'POST' && path.endsWith('/auth/logout')) return true;
  if (req.method === 'POST' && path.endsWith('/auth/change-password')) return true;
  return false;
}

function shouldTouchActivity(req: Request): boolean {
  const path = requestPath(req);
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return false;
  if (path.endsWith('/auth/logout')) return false;
  return true;
}

function rejectIfPasswordChangeRequired(req: Request, res: Response): boolean {
  if (req.user?.mustChangePassword && !isAllowedDuringForcedPasswordChange(req)) {
    res.status(403).json({
      error: 'Password change required before you can access this resource.',
      mustChangePassword: true
    });
    return true;
  }
  return false;
}

/**
 * Idle timeout, activity stamp, and forced-password gate after a DB user is resolved.
 * Returns true when a response has already been sent.
 */
async function applySessionGuards(
  req: Request,
  res: Response,
  user: AuthUserPayload & { isActive: boolean; lastActivityAt?: Date | string | null }
): Promise<boolean> {
  if (!user.isActive) {
    res.status(401).json({
      error: 'Session has been revoked. Please sign in again.'
    });
    return true;
  }

  if (!user.lastActivityAt) {
    await pool.query(
      'UPDATE users SET last_activity_at = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    ).catch(() => {});
  } else if (!isIdleExempt(req)) {
    const lastMs = new Date(user.lastActivityAt).getTime();
    if (!Number.isNaN(lastMs) && Date.now() - lastMs > SESSION_IDLE_MS) {
      res.status(401).json({
        error: 'Session expired due to inactivity. Please sign in again.'
      });
      return true;
    }
  }

  if (shouldTouchActivity(req)) {
    await pool.query(
      'UPDATE users SET last_activity_at = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    ).catch(() => {});
  }

  req.user = {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    mustChangePassword: Boolean(user.mustChangePassword),
    tokenVersion: user.tokenVersion
  };

  return rejectIfPasswordChangeRequired(req, res);
}

/**
 * Middleware: Verify Bearer JWT Token.
 * App tokens must verify against the application secret. Legacy Supabase access
 * tokens are confirmed with Supabase (never via jwt.decode). req.user is loaded
 * from the database RBAC record, never from unverified claims.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Authentication required. Please provide a valid Bearer token.'
    });
  }

  const token = authHeader.split(' ')[1];
  if (!token || token === 'undefined' || token === 'null') {
    return res.status(401).json({
      error: 'Authentication required. No token found in authorization header.'
    });
  }

  try {
    let decoded: jwt.JwtPayload | null = null;
    try {
      decoded = verifyAppToken(token);
    } catch (verifyErr: any) {
      if (isTokenExpiredError(verifyErr)) {
        return res.status(401).json({
          error: 'Session expired. Please sign in again.'
        });
      }

      // Compatibility: a Supabase access token may still be in localStorage.
      // Verify it with Supabase (never via jwt.decode) and map to the local user.
      const supabaseIdentity = await verifySupabaseAccessToken(token);
      if (!supabaseIdentity) {
        return res.status(401).json({
          error: 'Invalid authentication token.'
        });
      }

      const synced = await syncOrGetSupabaseProfile({
        id: supabaseIdentity.id,
        email: supabaseIdentity.email,
        fullName: supabaseIdentity.fullName,
        userMetadata: supabaseIdentity.userMetadata
      });

      if (await applySessionGuards(req, res, synced)) return;
      return next();
    }

    if (!decoded || (!decoded.sub && !(decoded as any).userId && !(decoded as any).id)) {
      return res.status(401).json({
        error: 'Invalid authentication token: missing user identifier.'
      });
    }

    const userId = String(decoded.sub || (decoded as any).userId || (decoded as any).id);
    const dbUser = await getActiveUserRecord(userId);

    if (!dbUser) {
      return res.status(401).json({
        error: 'Invalid authentication token.'
      });
    }

    const presentedVersion = Number((decoded as any).tokenVersion ?? 1);
    const currentVersion = Number(dbUser.tokenVersion || 1);
    if (presentedVersion !== currentVersion) {
      return res.status(401).json({
        error: 'Session has been revoked. Please sign in again.'
      });
    }

    if (await applySessionGuards(req, res, dbUser)) return;
    next();
  } catch (err: any) {
    if (isTokenExpiredError(err)) {
      return res.status(401).json({
        error: 'Session expired. Please sign in again.'
      });
    }
    return res.status(401).json({
      error: 'Invalid authentication token.'
    });
  }
}

/**
 * Load an existing user by primary key only. Username/email from JWT claims are never used.
 */
async function getActiveUserRecord(
  userId: string
): Promise<(AuthUserPayload & { isActive: boolean }) | null> {
  const userDbResult = await pool.query(
    `SELECT id, username, full_name, is_active, token_version, role, must_change_password, last_activity_at
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  );

  if (userDbResult.rows.length === 0) {
    return null;
  }

  const dbUser = userDbResult.rows[0];
  return {
    id: dbUser.id,
    username: dbUser.username,
    fullName: dbUser.full_name || dbUser.username,
    role: dbUser.role as UserRole,
    isActive: Boolean(dbUser.is_active),
    mustChangePassword: Boolean(dbUser.must_change_password),
    tokenVersion: dbUser.token_version || 1,
    lastActivityAt: dbUser.last_activity_at || null
  };
}

/**
 * Retrieve or auto-provision a user after a *verified* Supabase identity.
 * Lookup is by subject id only. New identities are always GUEST — never ADMIN.
 */
export async function syncOrGetSupabaseProfile(userPayload: {
  id: string;
  email?: string;
  username?: string;
  fullName?: string;
  role?: UserRole;
  userMetadata?: any;
}): Promise<AuthUserPayload & { isActive: boolean }> {
  const userId = String(userPayload.id).trim();
  if (!userId || userId.length > 64) {
    throw Object.assign(new Error('Invalid user identifier.'), { expose: true, status: 400 });
  }

  const usernameOrEmail = (userPayload.email || userPayload.username || userPayload.userMetadata?.email || '')
    .toLowerCase()
    .trim()
    .slice(0, 255);
  const metaFullName = String(
    userPayload.fullName || userPayload.userMetadata?.full_name || userPayload.userMetadata?.name || (usernameOrEmail ? usernameOrEmail.split('@')[0] : 'User')
  ).slice(0, 255);

  const userDbResult = await pool.query(
    `SELECT id, username, full_name, is_active, token_version, role, must_change_password, last_activity_at
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  );

  let dbUser;

  if (userDbResult.rows.length > 0) {
    dbUser = userDbResult.rows[0];
    await pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP, last_activity_at = CURRENT_TIMESTAMP WHERE id = $1', [dbUser.id]).catch(() => {});
  } else {
    const assignedUsername = usernameOrEmail || `user_${userId.slice(0, 8)}`;
    const assignedRole: UserRole = 'GUEST';

    try {
      const insertRes = await pool.query(`
        INSERT INTO users (id, username, password_hash, role, full_name, is_active, must_change_password, token_version, last_login_at, last_activity_at)
        VALUES ($1, $2, 'SUPABASE_AUTH_MANAGED', $3, $4, TRUE, FALSE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO UPDATE SET
          last_login_at = CURRENT_TIMESTAMP,
          last_activity_at = CURRENT_TIMESTAMP
        RETURNING id, username, full_name, is_active, token_version, role, must_change_password, last_activity_at;
      `, [userId, assignedUsername, assignedRole, metaFullName]);

      dbUser = insertRes.rows[0];
    } catch (insertErr) {
      const fallbackQuery = await pool.query(
        'SELECT id, username, full_name, is_active, token_version, role, must_change_password, last_activity_at FROM users WHERE id = $1 LIMIT 1',
        [userId]
      );
      if (fallbackQuery.rows.length > 0) {
        dbUser = fallbackQuery.rows[0];
      } else {
        const uniqueUsername = `${assignedUsername.replace(/@.*/, '')}_${userId.slice(0, 8)}`.slice(0, 100);
        const retryRes = await pool.query(`
          INSERT INTO users (id, username, password_hash, role, full_name, is_active, must_change_password, token_version, last_login_at, last_activity_at)
          VALUES ($1, $2, 'SUPABASE_AUTH_MANAGED', $3, $4, TRUE, FALSE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT (id) DO NOTHING
          RETURNING id, username, full_name, is_active, token_version, role, must_change_password, last_activity_at;
        `, [userId, uniqueUsername, assignedRole, metaFullName]);
        if (retryRes.rows.length > 0) {
          dbUser = retryRes.rows[0];
        } else {
          throw insertErr;
        }
      }
    }
  }

  return {
    id: dbUser.id,
    username: dbUser.username,
    fullName: dbUser.full_name || dbUser.username,
    role: dbUser.role as UserRole,
    isActive: Boolean(dbUser.is_active),
    mustChangePassword: Boolean(dbUser.must_change_password),
    tokenVersion: dbUser.token_version || 1,
    lastActivityAt: dbUser.last_activity_at || null
  };
}

/**
 * Block write operations until a forced password change is completed.
 */
export function requirePasswordChanged(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  if (req.user.mustChangePassword) {
    return res.status(403).json({
      error: 'Password update required before you can perform this action.',
      code: 'PASSWORD_CHANGE_REQUIRED'
    });
  }
  next();
}

/**
 * Middleware: Enforce Server-Side Role-Based Access Control (RBAC)
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required.'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      console.warn(`[SECURITY AUDIT] Unauthorized access attempt by ${req.user.username} (${req.user.role}) on ${req.method} ${req.originalUrl}`);
      return res.status(403).json({
        error: `Access denied: Your role (${req.user.role}) does not have permission to perform this action.`
      });
    }

    next();
  };
}
