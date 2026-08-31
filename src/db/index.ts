import 'dotenv/config';
import pg, { PoolConfig } from 'pg';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const { Pool } = pg;

const BCRYPT_SALT_ROUNDS = 12;

/**
 * Strong password hashing using bcrypt with 10 salt rounds.
 * Passwords are never logged or stored in plaintext.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(BCRYPT_SALT_ROUNDS);
  return bcrypt.hash(password, salt);
}

/**
 * Secure password comparison against stored bcrypt hash.
 * Also supports graceful backwards compatibility for any legacy pbkdf2 hash.
 */
export async function comparePassword(password: string, storedHash: string): Promise<boolean> {
  if (!password || !storedHash) return false;
  
  // Standard bcrypt hash starts with $2a$, $2b$, or $2y$
  if (storedHash.startsWith('$2')) {
    try {
      const match = await bcrypt.compare(password, storedHash);
      if (match) return true;
    } catch (e) {
      console.warn('bcrypt.compare error:', e);
    }
  }

  // Legacy fallback for previous PBKDF2 hash (auto-migrated upon successful login/password change)
  try {
    const legacyHash = crypto.pbkdf2Sync(password, 'saka_homes_salt_2026', 10000, 64, 'sha512').toString('hex');
    const storedBuf = Buffer.from(String(storedHash), 'hex');
    const computedBuf = Buffer.from(legacyHash, 'hex');
    if (storedBuf.length > 0 && storedBuf.length === computedBuf.length && crypto.timingSafeEqual(storedBuf, computedBuf)) {
      return true;
    }
  } catch {}

  return false;
}

/**
 * Generates a high-entropy, cryptographically random temporary password.
 * Format: 12 characters combining uppercase, lowercase, numbers, and special characters.
 */
export function generateTemporaryPassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const symbols = '!@#$%^&*';
  
  const allChars = letters + uppers + digits + symbols;
  let result = '';

  // Guarantee at least one from each character class
  result += letters.charAt(crypto.randomInt(0, letters.length));
  result += uppers.charAt(crypto.randomInt(0, uppers.length));
  result += digits.charAt(crypto.randomInt(0, digits.length));
  result += symbols.charAt(crypto.randomInt(0, symbols.length));

  for (let i = 4; i < 12; i++) {
    result += allChars.charAt(crypto.randomInt(0, allChars.length));
  }

  const chars = result.split('');
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/**
 * Cryptographically strong resource IDs (replaces Math.random-based identifiers).
 */
export function generateSecureId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * Helper to record security-sensitive events in the database audit log.
 * Passwords and secret keys must NEVER be passed to this function.
 */
export async function recordSecurityAudit(
  clientOrPool: pg.Pool | pg.PoolClient,
  eventType: 'USER_CREATED' | 'USER_DEACTIVATED' | 'USER_ACTIVATED' | 'USER_DELETED' | 'ROLE_CHANGED' | 'PASSWORD_RESET' | 'PASSWORD_CHANGED' | 'LOGIN_SUCCESS' | 'LOGIN_FAILURE',
  params: {
    actorId?: string;
    actorUsername?: string;
    targetUserId?: string;
    targetUsername?: string;
    details?: string;
    ipAddress?: string;
  }
) {
  try {
    const id = `sec_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    await clientOrPool.query(`
      INSERT INTO security_audit_logs (
        id, event_type, actor_id, actor_username, target_user_id, target_username, details, ip_address, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP);
    `, [
      id,
      eventType,
      params.actorId || null,
      params.actorUsername || null,
      params.targetUserId || null,
      params.targetUsername || null,
      params.details || null,
      params.ipAddress || null
    ]);
  } catch (err: any) {
    console.error('[SECURITY AUDIT] Failed to record audit log:', err.message);
  }
}

/**
 * Universal Activity & Change Logger.
 * Records every operational action (inventory changes, stock movements, PO approvals, user changes)
 * with the actor who performed it, previous/new values, and metadata.
 */
export async function recordActivityLog(
  clientOrPool: pg.Pool | pg.PoolClient,
  params: {
    eventType: string;
    module: 'INVENTORY' | 'STOCK_MOVEMENTS' | 'PURCHASE_ORDERS' | 'CATEGORIES' | 'USER_MANAGEMENT' | 'AUTHENTICATION';
    actorId?: string;
    actorUsername: string;
    actorName?: string;
    actorRole?: string;
    targetId?: string;
    targetName?: string;
    actionSummary: string;
    details?: string;
    metadata?: Record<string, any>;
    ipAddress?: string;
  }
) {
  try {
    const id = `act_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    await clientOrPool.query(`
      INSERT INTO activity_logs (
        id, event_type, module, actor_id, actor_username, actor_name, actor_role,
        target_id, target_name, action_summary, details, metadata, ip_address, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP);
    `, [
      id,
      params.eventType,
      params.module,
      params.actorId || null,
      params.actorUsername,
      params.actorName || null,
      params.actorRole || 'ADMIN',
      params.targetId || null,
      params.targetName || null,
      params.actionSummary,
      params.details || null,
      params.metadata ? JSON.stringify(params.metadata) : null,
      params.ipAddress || null
    ]);
  } catch (err: any) {
    console.error('[ACTIVITY AUDIT] Failed to record activity log:', err.message);
  }
}

function buildPoolConfig(): PoolConfig {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (databaseUrl) {
    let url = databaseUrl;
    // Supabase session pooler on 5432 has a hard 15 connection ceiling. Convert pooler 5432 to 6543 transaction mode.
    if (url.includes('pooler.supabase.com:5432')) {
      url = url.replace(':5432', ':6543');
    }

    const isLocalhost = url.includes('localhost') || url.includes('127.0.0.1') || url.includes('::1');
    const isRemote = !isLocalhost || process.env.NODE_ENV === 'production' || process.env.PGSSLMODE === 'require';
    const rejectUnauthorized = process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false';

    return {
      connectionString: url,
      ...(isRemote ? { ssl: { rejectUnauthorized } } : {}),
      max: 10,
      idleTimeoutMillis: 15000,
      connectionTimeoutMillis: 10000,
    };
  }

  // Fallback parameters if DATABASE_URL is not provided directly
  const host = process.env.PGHOST || 'localhost';
  const port = process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432;
  const user = process.env.PGUSER || 'postgres';
  const password = process.env.PGPASSWORD || undefined;
  const database = process.env.PGDATABASE || 'postgres';

  const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const isRemote = (!isLocalhost && Boolean(process.env.PGHOST)) || process.env.NODE_ENV === 'production' || process.env.PGSSLMODE === 'require';
  const rejectUnauthorized = process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false';

  return {
    host,
    port,
    user,
    password,
    database,
    ...(isRemote ? { ssl: { rejectUnauthorized } } : {}),
    max: 10,
    idleTimeoutMillis: 15000,
    connectionTimeoutMillis: 10000,
  };
}

export const pool = new Pool(buildPoolConfig());

// Guard against uncaughtException crashes when idle clients disconnect from the pool
pool.on('error', (err) => {
  console.warn('PostgreSQL pool background client error (handled):', err.message);
});

// Helper to initialize database schema tables & indexes on application launch
export async function initializeDatabase() {
  const client = await pool.connect();
  try {
    console.log('Initializing PostgreSQL database schema...');

    await client.query('BEGIN');

    // 0. Users Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'VIEWER',
        full_name VARCHAR(255),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
        token_version INT NOT NULL DEFAULT 1,
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure columns exist on already created tables
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 1;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;`);

    // 0.1 Security Audit Logs Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS security_audit_logs (
        id VARCHAR(64) PRIMARY KEY,
        event_type VARCHAR(50) NOT NULL,
        actor_id VARCHAR(64),
        actor_username VARCHAR(255),
        target_user_id VARCHAR(64),
        target_username VARCHAR(255),
        details TEXT,
        ip_address VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Bootstrap initial accounts only when they do not already exist.
    // Existing password hashes, roles, and must_change_password flags are never overwritten.
    const initialAdminUsername = (process.env.INITIAL_ADMIN_USERNAME || 'admin@sakainventory').toLowerCase().trim();
    const initialAdminName = process.env.INITIAL_ADMIN_NAME || 'System Administrator';
    const isProduction = process.env.NODE_ENV === 'production';

    const existingAdmin = await client.query(
      'SELECT id FROM users WHERE LOWER(username) = LOWER($1) OR id = $2 LIMIT 1',
      [initialAdminUsername, 'usr_admin_01']
    );

    if (existingAdmin.rows.length === 0) {
      let initialAdminPassword = process.env.INITIAL_ADMIN_PASSWORD;
      let forcePasswordChange = true;
      if (!initialAdminPassword) {
        if (isProduction) {
          initialAdminPassword = crypto.randomBytes(18).toString('base64url');
          console.warn('[BOOTSTRAP] INITIAL_ADMIN_PASSWORD was not set. Generated a one-time admin password. Store it securely; it will not be shown again.');
          console.warn(`[BOOTSTRAP] Admin username: ${initialAdminUsername}`);
          console.warn(`[BOOTSTRAP] One-time admin password: ${initialAdminPassword}`);
        } else {
          initialAdminPassword = 'admin123';
          console.warn('[BOOTSTRAP] Using development default admin password. Set INITIAL_ADMIN_PASSWORD before deploying.');
        }
      }
      const adminHash = await hashPassword(initialAdminPassword);
      await client.query(`
        INSERT INTO users (id, username, password_hash, role, full_name, is_active, must_change_password, token_version)
        VALUES ('usr_admin_01', $1, $2, 'ADMIN', $3, TRUE, $4, 1)
      `, [initialAdminUsername, adminHash, initialAdminName, forcePasswordChange]);
      console.log(`[BOOTSTRAP] Created initial admin account (${initialAdminUsername}). Password change required on first login.`);
    }

    const existingGuest = await client.query(
      "SELECT id FROM users WHERE LOWER(username) = 'guest@sakainventory' OR id = 'usr_guest_01' LIMIT 1"
    );
    const initialGuestPassword = process.env.INITIAL_GUEST_PASSWORD || (isProduction ? '' : 'guest123');
    if (existingGuest.rows.length === 0 && initialGuestPassword) {
      const guestHash = await hashPassword(initialGuestPassword);
      await client.query(`
        INSERT INTO users (id, username, password_hash, role, full_name, is_active, must_change_password, token_version)
        VALUES ('usr_guest_01', 'guest@sakainventory', $1, 'GUEST', 'Guest User', TRUE, FALSE, 1)
      `, [guestHash]);
      console.log('[BOOTSTRAP] Created guest@sakainventory account.');
    }

    console.log(`[BOOTSTRAP] System accounts verified (${initialAdminUsername}). Existing credentials were not modified.`);

    // 1. Categories Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id VARCHAR(64) PRIMARY KEY,
        category_name VARCHAR(255) UNIQUE NOT NULL,
        description TEXT,
        primary_supplier VARCHAR(255),
        review_frequency VARCHAR(100),
        item_count INT DEFAULT 0,
        created_by VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Inventory Items Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_items (
        id VARCHAR(64) PRIMARY KEY,
        item_code VARCHAR(100) UNIQUE NOT NULL,
        item_name VARCHAR(255) NOT NULL,
        category VARCHAR(255) NOT NULL,
        unit_of_measure VARCHAR(100) NOT NULL,
        min_stock_level INT NOT NULL DEFAULT 0,
        max_stock_level INT NOT NULL DEFAULT 1000,
        reorder_qty INT NOT NULL DEFAULT 0,
        current_stock INT NOT NULL DEFAULT 0,
        unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        total_value NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
        status VARCHAR(50) NOT NULL DEFAULT 'IN STOCK',
        supplier VARCHAR(255),
        last_restocked VARCHAR(100),
        next_review_date VARCHAR(100),
        notes TEXT,
        created_by VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Stock Movements Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_movements (
        id VARCHAR(64) PRIMARY KEY,
        movement_code VARCHAR(100) UNIQUE NOT NULL,
        movement_type VARCHAR(50) NOT NULL,
        item_id VARCHAR(64) REFERENCES inventory_items(id) ON DELETE SET NULL,
        item_code VARCHAR(100) NOT NULL,
        item_name VARCHAR(255) NOT NULL,
        category VARCHAR(255) NOT NULL,
        quantity INT NOT NULL,
        unit_of_measure VARCHAR(100),
        previous_stock INT NOT NULL,
        new_stock INT NOT NULL,
        recipient VARCHAR(255),
        issued_by VARCHAR(255),
        date VARCHAR(100),
        notes TEXT,
        created_by VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Purchase Orders Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id VARCHAR(64) PRIMARY KEY,
        po_number VARCHAR(100) UNIQUE NOT NULL,
        item_id VARCHAR(64) REFERENCES inventory_items(id) ON DELETE SET NULL,
        item_code VARCHAR(100) NOT NULL,
        item_name VARCHAR(255) NOT NULL,
        supplier VARCHAR(255),
        qty_ordered INT NOT NULL,
        unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        total_cost NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
        order_date VARCHAR(100),
        expected_date VARCHAR(100),
        status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
        inventory_updated BOOLEAN DEFAULT FALSE,
        notes TEXT,
        created_by VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 5. Immutable Inventory Audit Ledger Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_transactions (
        id VARCHAR(64) PRIMARY KEY,
        transaction_code VARCHAR(100) UNIQUE NOT NULL,
        item_id VARCHAR(64) NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
        change_qty INT NOT NULL,
        stock_before INT NOT NULL,
        stock_after INT NOT NULL,
        transaction_type VARCHAR(50) NOT NULL,
        reference_id VARCHAR(100),
        notes TEXT,
        performed_by VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 6. Comprehensive Activity & Change Audit Trail Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id VARCHAR(64) PRIMARY KEY,
        event_type VARCHAR(64) NOT NULL,
        module VARCHAR(50) NOT NULL,
        actor_id VARCHAR(64),
        actor_username VARCHAR(255) NOT NULL,
        actor_name VARCHAR(255),
        actor_role VARCHAR(50) NOT NULL DEFAULT 'ADMIN',
        target_id VARCHAR(64),
        target_name VARCHAR(255),
        action_summary TEXT NOT NULL,
        details TEXT,
        metadata JSONB,
        ip_address VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Indexes for high performance & query optimization
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_item_code ON inventory_items(item_code);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_category ON inventory_items(category);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_status ON inventory_items(status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_movements_item_id ON stock_movements(item_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_movements_created_at ON stock_movements(created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_item_id ON inventory_transactions(item_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_created_at ON inventory_transactions(created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity_logs(created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_activity_module ON activity_logs(module);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_activity_actor ON activity_logs(actor_username);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_activity_event_type ON activity_logs(event_type);`);

    await client.query('COMMIT');
    console.log('PostgreSQL database schema initialized successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error initializing PostgreSQL database schema:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Automated Log Retention Purge:
 * Deletes activity logs and security audit logs older than the specified retention window (default 90 days).
 */
export async function purgeOldLogs(
  clientOrPool: pg.Pool | pg.PoolClient,
  retentionDays: number = 90
): Promise<{ activityLogsDeleted: number; securityLogsDeleted: number; retentionDays: number }> {
  try {
    const days = Math.max(1, parseInt(String(retentionDays), 10) || 90);
    
    // Purge activity_logs older than retentionDays
    const actRes = await clientOrPool.query(
      `DELETE FROM activity_logs WHERE created_at < NOW() - ($1 || ' days')::INTERVAL RETURNING id`,
      [days]
    );

    // Purge security_audit_logs older than retentionDays
    const secRes = await clientOrPool.query(
      `DELETE FROM security_audit_logs WHERE created_at < NOW() - ($1 || ' days')::INTERVAL RETURNING id`,
      [days]
    );

    const activityLogsDeleted = actRes.rowCount || 0;
    const securityLogsDeleted = secRes.rowCount || 0;

    console.log(`[RETENTION POLICY] Purged ${activityLogsDeleted} activity logs and ${securityLogsDeleted} security audit logs older than ${days} days.`);
    return { activityLogsDeleted, securityLogsDeleted, retentionDays: days };
  } catch (err: any) {
    console.error('[RETENTION POLICY] Error executing log purge:', err.message);
    throw err;
  }
}
