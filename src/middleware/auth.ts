import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../types';
import { pool } from '../db/index';

let runtimeEphemeralSecret: string | null = null;

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
  const raw = process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET;
  if (raw && raw.trim() !== '') {
    return raw.trim().replace(/^["']|["']$/g, '');
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
  const rawSupabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const rawAnonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();

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

      if (res.ok) {
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

/**
 * Middleware: Verify Bearer JWT Token.
 * Only accepts tokens whose signature verifies against the application secret.
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
    let decoded: jwt.JwtPayload;
    try {
      decoded = verifyAppToken(token);
    } catch (verifyErr: any) {
      if (isTokenExpiredError(verifyErr)) {
        return res.status(401).json({
          error: 'Session expired. Please sign in again.'
        });
      }
      return res.status(401).json({
        error: 'Invalid authentication token.'
      });
    }

    if (!decoded || (!decoded.sub && !(decoded as any).userId && !(decoded as any).id)) {
      return res.status(401).json({
        error: 'Invalid authentication token: missing user identifier.'
      });
    }

    const userId = String(decoded.sub || (decoded as any).userId || (decoded as any).id);
    const usernameOrEmail = String(
      (decoded as any).username || (decoded as any).email || (decoded as any).user_metadata?.email || ''
    ).toLowerCase().trim();

    const dbUser = await getActiveUserRecord(userId, usernameOrEmail);

    if (!dbUser) {
      return res.status(401).json({
        error: 'Invalid authentication token.'
      });
    }

    if (!dbUser.isActive) {
      return res.status(403).json({
        error: 'Your account has been deactivated. Please contact your system administrator.'
      });
    }

    const presentedVersion = Number((decoded as any).tokenVersion ?? 1);
    const currentVersion = Number(dbUser.tokenVersion || 1);
    if (presentedVersion !== currentVersion) {
      return res.status(401).json({
        error: 'Session has been revoked. Please sign in again.'
      });
    }

    req.user = {
      id: dbUser.id,
      username: dbUser.username,
      fullName: dbUser.fullName,
      role: dbUser.role as UserRole,
      mustChangePassword: Boolean(dbUser.mustChangePassword),
      tokenVersion: dbUser.tokenVersion
    };

    next();
  } catch (err: any) {
    if (isTokenExpiredError(err)) {
      return res.status(401).json({
        error: 'Session expired. Please sign in again.'
      });
    }
    return res.status(401).json({
      error: 'Authentication failed.'
    });
  }
}

/**
 * Load an existing user. Does not auto-provision from untrusted JWT claims.
 */
async function getActiveUserRecord(
  userId: string,
  usernameOrEmail: string
): Promise<(AuthUserPayload & { isActive: boolean }) | null> {
  const userDbResult = await pool.query(
    `SELECT id, username, full_name, is_active, token_version, role, must_change_password
     FROM users
     WHERE id = $1 OR ($2 <> '' AND LOWER(username) = $2)
     LIMIT 1`,
    [userId, usernameOrEmail]
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
    tokenVersion: dbUser.token_version || 1
  };
}

const ALLOWED_PROVISION_ROLES: UserRole[] = ['GUEST', 'VIEWER', 'MANAGER'];

function sanitizeProvisionRole(role: unknown): UserRole {
  if (typeof role === 'string' && ALLOWED_PROVISION_ROLES.includes(role as UserRole)) {
    return role as UserRole;
  }
  return 'GUEST';
}

/**
 * Retrieve or auto-provision a user after a *verified* Supabase identity.
 * Client-supplied ADMIN roles are ignored. The first account becomes ADMIN.
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
    `SELECT id, username, full_name, is_active, token_version, role, must_change_password
     FROM users
     WHERE id = $1 OR (username != '' AND LOWER(username) = $2)
     LIMIT 1`,
    [userId, usernameOrEmail]
  );

  let dbUser;

  if (userDbResult.rows.length > 0) {
    dbUser = userDbResult.rows[0];
  } else {
    const assignedUsername = usernameOrEmail || `user_${userId.slice(0, 8)}`;
    const countRes = await pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'ADMIN'");
    const adminCount = parseInt(countRes.rows[0]?.count || '0', 10);
    const assignedRole: UserRole = adminCount === 0 ? 'ADMIN' : sanitizeProvisionRole(userPayload.role);

    try {
      const insertRes = await pool.query(`
        INSERT INTO users (id, username, password_hash, role, full_name, is_active, must_change_password, token_version, last_login_at)
        VALUES ($1, $2, 'SUPABASE_AUTH_MANAGED', $3, $4, TRUE, FALSE, 1, CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO UPDATE SET
          last_login_at = CURRENT_TIMESTAMP
        RETURNING id, username, full_name, is_active, token_version, role, must_change_password;
      `, [userId, assignedUsername, assignedRole, metaFullName]);

      dbUser = insertRes.rows[0];
    } catch (insertErr) {
      const fallbackQuery = await pool.query(
        'SELECT id, username, full_name, is_active, token_version, role, must_change_password FROM users WHERE id = $1 OR LOWER(username) = $2 LIMIT 1',
        [userId, assignedUsername]
      );
      if (fallbackQuery.rows.length > 0) {
        dbUser = fallbackQuery.rows[0];
      } else {
        throw insertErr;
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
    tokenVersion: dbUser.token_version || 1
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
