import jwt, { JwtPayload } from 'jsonwebtoken';
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../types';
import { pool } from '../db/index';

let runtimeEphemeralSecret: string | null = null;

function sanitizeSecret(raw?: string): string {
  return (raw || '').trim().replace(/^["']|["']$/g, '');
}

/**
 * Signing secret for application-issued JWTs.
 * Production must set JWT_SECRET; development may fall back to an ephemeral secret.
 */
export function getJwtSecret(): string {
  const appSecret = sanitizeSecret(process.env.JWT_SECRET);
  if (appSecret) {
    return appSecret;
  }

  const supabaseSecret = sanitizeSecret(process.env.SUPABASE_JWT_SECRET);
  if (supabaseSecret && process.env.NODE_ENV !== 'production') {
    return supabaseSecret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required when NODE_ENV=production.');
  }

  if (!runtimeEphemeralSecret) {
    runtimeEphemeralSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[SECURITY] No JWT_SECRET configured. Generated an ephemeral in-memory secret. Sessions will not survive process restarts.');
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
  if (process.env.NODE_ENV === 'production') {
    const secret = sanitizeSecret(process.env.JWT_SECRET);
    if (!secret || secret.length < 32) {
      throw new Error('JWT_SECRET must be set to a strong value (32+ characters) when NODE_ENV=production.');
    }
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
    { expiresIn: '24h' }
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
}

function requestPath(req: Request): string {
  return `${req.baseUrl || ''}${req.path || ''}`;
}

function isAllowedDuringForcedPasswordChange(req: Request): boolean {
  const path = requestPath(req);
  if (req.method === 'GET' && path.endsWith('/auth/me')) return true;
  if (req.method === 'POST' && path.endsWith('/auth/change-password')) return true;
  return false;
}

/**
 * Middleware: Verify Bearer JWT Token.
 * Validates tokens issued by the app or by Supabase Auth (when SUPABASE_JWT_SECRET is set).
 * Attaches req.user from the database RBAC record, never from unverified claims.
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
    const decoded = verifySignedToken(token);

    if (!decoded || (!decoded.sub && !decoded.userId && !(decoded as any).id)) {
      return res.status(401).json({
        error: 'Invalid authentication token: missing user identifier.'
      });
    }

    const userId = String(decoded.sub || decoded.userId || (decoded as any).id);
    const usernameOrEmail = String(
      decoded.username || decoded.email || (decoded as any).user_metadata?.email || ''
    ).toLowerCase().trim();
    const fullName =
      (decoded as any).fullName ||
      (decoded as any).user_metadata?.full_name ||
      (decoded as any).user_metadata?.name;

    const dbUser = await syncOrGetSupabaseProfile({
      id: userId,
      email: usernameOrEmail,
      fullName
    });

    if (!dbUser.isActive) {
      return res.status(403).json({
        error: 'Your account has been deactivated. Please contact your system administrator.'
      });
    }

    if (
      typeof decoded.tokenVersion === 'number' &&
      decoded.tokenVersion !== (dbUser.tokenVersion || 1)
    ) {
      return res.status(401).json({
        error: 'Session has been revoked. Please sign in again.'
      });
    }

    if (dbUser.mustChangePassword && !isAllowedDuringForcedPasswordChange(req)) {
      return res.status(403).json({
        error: 'Password change required before you can access this resource.',
        mustChangePassword: true
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
    if (err.name === 'TokenExpiredError') {
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
 * Retrieve or auto-provision a GUEST profile for a cryptographically verified identity.
 * Role is never taken from client or JWT metadata. Existing users are matched by id only.
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
  if (!userId) {
    throw new Error('User identifier is required.');
  }

  const usernameOrEmail = (userPayload.email || userPayload.username || userPayload.userMetadata?.email || '').toLowerCase().trim();
  const metaFullName = userPayload.fullName || userPayload.userMetadata?.full_name || userPayload.userMetadata?.name || (usernameOrEmail ? usernameOrEmail.split('@')[0] : 'User');

  const userDbResult = await pool.query(
    'SELECT id, username, full_name, is_active, token_version, role, must_change_password FROM users WHERE id = $1 LIMIT 1',
    [userId]
  );

  let dbUser;

  if (userDbResult.rows.length > 0) {
    dbUser = userDbResult.rows[0];
    await pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1', [dbUser.id]).catch(() => {});
  } else {
    const assignedUsername = usernameOrEmail || `user_${userId.slice(0, 8)}`;
    const assignedRole: UserRole = 'GUEST';

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
        'SELECT id, username, full_name, is_active, token_version, role, must_change_password FROM users WHERE id = $1 LIMIT 1',
        [userId]
      );
      if (fallbackQuery.rows.length > 0) {
        dbUser = fallbackQuery.rows[0];
      } else {
        const uniqueUsername = `${assignedUsername.replace(/@.*/, '')}_${userId.slice(0, 8)}`.slice(0, 100);
        const retryRes = await pool.query(`
          INSERT INTO users (id, username, password_hash, role, full_name, is_active, must_change_password, token_version, last_login_at)
          VALUES ($1, $2, 'SUPABASE_AUTH_MANAGED', $3, $4, TRUE, FALSE, 1, CURRENT_TIMESTAMP)
          ON CONFLICT (id) DO NOTHING
          RETURNING id, username, full_name, is_active, token_version, role, must_change_password;
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
    tokenVersion: dbUser.token_version || 1
  };
}

/**
 * Middleware: Enforce Server-Side Role-Based Access Control (RBAC)
 * Rejects unauthorized users with 403 Forbidden
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
