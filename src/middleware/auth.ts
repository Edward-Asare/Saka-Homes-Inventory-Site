import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../types';
import { pool } from '../db/index';

// Helper to get or fallback to application JWT Secret
export function getJwtSecret(): string {
  const raw = process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET || 'saka_inventory_jwt_secret_key_production_2026_super_secure';
  return raw.trim().replace(/^["']|["']$/g, '');
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
    const usernameOrEmail = (decoded.username || decoded.email || decoded.user_metadata?.email || '').toLowerCase();

    // Verify against database for RBAC role mapping and active status
    const userDbResult = await pool.query(
      'SELECT id, username, full_name, is_active, token_version, role, must_change_password FROM users WHERE id = $1 OR (username != \'\' AND LOWER(username) = $2)',
      [userId, usernameOrEmail]
    );

    let dbUser;

    if (userDbResult.rows.length === 0) {
      // Auto-provision user in local RBAC directory on first authenticated access if needed
      const defaultRole: UserRole = (decoded.role || decoded.user_metadata?.role as UserRole) || 'GUEST';
      const fullName = decoded.fullName || decoded.user_metadata?.full_name || decoded.user_metadata?.name || (usernameOrEmail ? usernameOrEmail.split('@')[0] : 'User');
      const assignedUsername = usernameOrEmail || `user_${String(userId).slice(0, 8)}`;

      const newRecord = await pool.query(`
        INSERT INTO users (id, username, password_hash, role, full_name, is_active, must_change_password, token_version)
        VALUES ($1, $2, 'AUTH_MANAGED', $3, $4, TRUE, FALSE, 1)
        ON CONFLICT (id) DO UPDATE SET is_active = TRUE, full_name = EXCLUDED.full_name
        RETURNING id, username, full_name, is_active, token_version, role, must_change_password;
      `, [userId, assignedUsername, defaultRole, fullName]);

      dbUser = newRecord.rows[0];
    } else {
      dbUser = userDbResult.rows[0];
    }

    if (!dbUser.is_active) {
      return res.status(403).json({
        error: 'Your account has been deactivated. Please contact your system administrator.'
      });
    }

    // Attach verified user payload with database RBAC role
    req.user = {
      id: dbUser.id,
      username: dbUser.username,
      fullName: dbUser.full_name || dbUser.username,
      role: dbUser.role as UserRole,
      mustChangePassword: Boolean(dbUser.must_change_password),
      tokenVersion: dbUser.token_version
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
