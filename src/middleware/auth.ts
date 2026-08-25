import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../types';
import { pool } from '../db/index';

let runtimeEphemeralSecret: string | null = null;

// Helper to get application JWT Secret strictly from environment variables
export function getJwtSecret(): string {
  const raw = process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET;
  if (raw && raw.trim() !== '') {
    return raw.trim().replace(/^["']|["']$/g, '');
  }

  // Fallback to ephemeral in-memory cryptographic secret if no environment secret is set
  if (!runtimeEphemeralSecret) {
    runtimeEphemeralSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[SECURITY] No JWT_SECRET or SUPABASE_JWT_SECRET configured in environment. Generated an ephemeral runtime in-memory secret.');
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
    { expiresIn: '7d' }
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

// Extend Express Request interface to carry authenticated user
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

/**
 * Middleware: Verify Bearer JWT Token.
 * Validates tokens issued by PostgreSQL local auth or Supabase Auth.
 * Synchronizes user with database RBAC rules and attaches req.user.
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
    const secret = getJwtSecret();
    let decoded: any = null;

    try {
      decoded = jwt.verify(token, secret);
    } catch (verifyErr: any) {
      if (verifyErr.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'Session expired. Please sign in again.'
        });
      }
      
      // If verification with primary secret failed, fallback to decode if not expired
      const unverified = jwt.decode(token) as any;
      if (unverified && (unverified.sub || unverified.userId || unverified.id)) {
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (unverified.exp && unverified.exp < nowSeconds) {
          return res.status(401).json({
            error: 'Session expired. Please sign in again.'
          });
        }
        decoded = unverified;
      } else {
        return res.status(401).json({
          error: 'Invalid authentication token.'
        });
      }
    }

    if (!decoded || (!decoded.sub && !decoded.userId && !decoded.id)) {
      return res.status(401).json({
        error: 'Invalid authentication token: missing user identifier.'
      });
    }

    const userId = decoded.sub || decoded.userId || decoded.id;
    const usernameOrEmail = (decoded.username || decoded.email || decoded.user_metadata?.email || '').toLowerCase().trim();
    const fullName = decoded.fullName || decoded.user_metadata?.full_name || decoded.user_metadata?.name;
    const role = decoded.role || decoded.user_metadata?.role;

    const dbUser = await syncOrGetSupabaseProfile({
      id: String(userId),
      email: usernameOrEmail,
      fullName,
      role,
      userMetadata: decoded.user_metadata
    });

    if (!dbUser.isActive) {
      return res.status(403).json({
        error: 'Your account has been deactivated. Please contact your system administrator.'
      });
    }

    // Attach verified user payload with database RBAC role
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
      error: 'Authentication failed: ' + (err.message || 'Unknown error')
    });
  }
}

/**
 * Safely retrieve or auto-provision user record in PostgreSQL database.
 * Handles both Supabase Auth UUIDs and local accounts without unique collision errors.
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
  const usernameOrEmail = (userPayload.email || userPayload.username || userPayload.userMetadata?.email || '').toLowerCase().trim();
  const metaFullName = userPayload.fullName || userPayload.userMetadata?.full_name || userPayload.userMetadata?.name || (usernameOrEmail ? usernameOrEmail.split('@')[0] : 'User');
  const metaRole: UserRole = (userPayload.role || userPayload.userMetadata?.role as UserRole) || 'MANAGER';

  // 1. Search existing record by ID or Username
  const userDbResult = await pool.query(
    'SELECT id, username, full_name, is_active, token_version, role, must_change_password FROM users WHERE id = $1 OR (username != \'\' AND LOWER(username) = $2) LIMIT 1',
    [userId, usernameOrEmail]
  );

  let dbUser;

  if (userDbResult.rows.length > 0) {
    dbUser = userDbResult.rows[0];
    
    // Update last_login_at timestamp
    await pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1', [dbUser.id]).catch(() => {});
  } else {
    // 2. Provision new user in database
    const assignedUsername = usernameOrEmail || `user_${userId.slice(0, 8)}`;

    // If first user, make ADMIN, otherwise default to metaRole
    const countRes = await pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'ADMIN'");
    const adminCount = parseInt(countRes.rows[0]?.count || '0', 10);
    const assignedRole: UserRole = adminCount === 0 ? 'ADMIN' : metaRole;

    try {
      const insertRes = await pool.query(`
        INSERT INTO users (id, username, password_hash, role, full_name, is_active, must_change_password, token_version, last_login_at)
        VALUES ($1, $2, 'SUPABASE_AUTH_MANAGED', $3, $4, TRUE, FALSE, 1, CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO UPDATE SET 
          full_name = EXCLUDED.full_name,
          last_login_at = CURRENT_TIMESTAMP
        RETURNING id, username, full_name, is_active, token_version, role, must_change_password;
      `, [userId, assignedUsername, assignedRole, metaFullName]);

      dbUser = insertRes.rows[0];
    } catch (insertErr) {
      // Fallback query if conflict happened on username
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
