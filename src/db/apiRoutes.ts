import { Router, Request, Response } from 'express';
import { pool, hashPassword, comparePassword, generateTemporaryPassword, recordSecurityAudit, recordActivityLog, purgeOldLogs } from './index';
import { requireAuth, requireRole, generateAuthToken } from '../middleware/auth';
import { 
  validateRequest, 
  idParamSchema, 
  loginSchema, 
  changePasswordSchema,
  createUserSchema,
  updateUserRoleSchema,
  updateUserStatusSchema,
  createInventoryItemSchema, 
  updateInventoryItemSchema, 
  createStockMovementSchema, 
  createPOSchema, 
  updatePOStatusSchema, 
  createCategorySchema 
} from '../middleware/validation';

const router = Router();


// Helper to get client IP from Express
function getClientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
}

// ==================== AUTHENTICATION & LOGIN ====================

// POST /api/auth/login - Rate limited at server level
router.post('/auth/login', validateRequest({ body: loginSchema }), async (req: Request, res: Response) => {
  const clientIp = getClientIp(req);
  try {
    const { username, password } = req.body;
    let trimmedUsername = String(username).trim().toLowerCase();

    // Map common aliases
    if (trimmedUsername === 'admin') trimmedUsername = 'admin@sakainventory';
    if (trimmedUsername === 'guest') trimmedUsername = 'guest@sakainventory';
    if (trimmedUsername === 'viewer') trimmedUsername = 'guest@sakainventory';

    // Query user by parameterized username or alias
    let result = await pool.query(
      'SELECT id, username, password_hash, role, full_name, is_active, must_change_password, token_version FROM users WHERE LOWER(username) = $1 OR LOWER(username) = $2',
      [trimmedUsername, String(username).trim().toLowerCase()]
    );

    if (result.rows.length === 0) {
      const initialAdminUser = (process.env.INITIAL_ADMIN_USERNAME || 'admin@sakainventory').toLowerCase().trim();
      const initialAdminPass = process.env.INITIAL_ADMIN_PASSWORD;
      const initialAdminName = process.env.INITIAL_ADMIN_NAME || 'System Administrator';

      // If user not found, check if it's the configured initial admin trying to connect before DB bootstrap finishes
      if (initialAdminPass && trimmedUsername === initialAdminUser && password === initialAdminPass) {
        const adminHash = await hashPassword(initialAdminPass);
        const existingAdmin = await pool.query("SELECT id FROM users WHERE id = 'usr_admin_01' OR LOWER(username) = $1 LIMIT 1", [initialAdminUser]);
        if (existingAdmin.rows.length > 0) {
          await pool.query(`
            UPDATE users SET username = $1, password_hash = $2, is_active = TRUE, role = 'ADMIN'
            WHERE id = $3
          `, [initialAdminUser, adminHash, existingAdmin.rows[0].id]);
        } else {
          await pool.query(`
            INSERT INTO users (id, username, password_hash, role, full_name, is_active, must_change_password, token_version)
            VALUES ('usr_admin_01', $1, $2, 'ADMIN', $3, TRUE, FALSE, 1)
          `, [initialAdminUser, adminHash, initialAdminName]);
        }
        result = await pool.query('SELECT id, username, password_hash, role, full_name, is_active, must_change_password, token_version FROM users WHERE LOWER(username) = $1', [initialAdminUser]);
      } else {
        await recordSecurityAudit(pool, 'LOGIN_FAILURE', {
          targetUsername: trimmedUsername,
          details: 'User not found in system',
          ipAddress: clientIp
        });
        return res.status(401).json({ error: 'Invalid username or password.' });
      }
    }

    const user = result.rows[0];

    // Check account active status
    if (!user.is_active) {
      await recordSecurityAudit(pool, 'LOGIN_FAILURE', {
        targetUserId: user.id,
        targetUsername: user.username,
        details: 'Login rejected: account is deactivated',
        ipAddress: clientIp
      });
      return res.status(403).json({
        error: 'Your account has been deactivated. Please contact your system administrator.'
      });
    }

    // Secure password comparison via bcrypt
    const passwordMatch = await comparePassword(password, user.password_hash);

    if (!passwordMatch) {
      await recordSecurityAudit(pool, 'LOGIN_FAILURE', {
        targetUserId: user.id,
        targetUsername: user.username,
        details: 'Invalid password provided',
        ipAddress: clientIp
      });
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    // Auto-upgrade legacy hash if needed
    if (!user.password_hash.startsWith('$2')) {
      const upgradedHash = await hashPassword(password);
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [upgradedHash, user.id]);
    }

    // Record last login timestamp
    await pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

    const userPayload = {
      id: user.id,
      username: user.username,
      fullName: user.full_name || user.username,
      role: user.role || 'GUEST',
      isActive: Boolean(user.is_active),
      mustChangePassword: Boolean(user.must_change_password),
      tokenVersion: user.token_version || 1
    };

    await recordSecurityAudit(pool, 'LOGIN_SUCCESS', {
      actorId: user.id,
      actorUsername: user.username,
      details: `Successful login as ${user.role} (mustChangePassword: ${user.must_change_password})`,
      ipAddress: clientIp
    });

    await recordActivityLog(pool, {
      eventType: 'LOGIN_SUCCESS',
      module: 'AUTHENTICATION',
      actorId: user.id,
      actorUsername: user.username,
      actorName: user.full_name || user.username,
      actorRole: user.role,
      actionSummary: `User "${user.username}" logged in successfully as ${user.role}`,
      details: `Role: ${user.role} | First Login Flag: ${user.must_change_password}`,
      ipAddress: clientIp
    });

    const token = generateAuthToken({
      id: userPayload.id,
      username: userPayload.username,
      role: userPayload.role,
      fullName: userPayload.fullName,
      tokenVersion: userPayload.tokenVersion
    });

    res.json({
      success: true,
      token,
      user: {
        id: userPayload.id,
        username: userPayload.username,
        fullName: userPayload.fullName,
        role: userPayload.role,
        isActive: userPayload.isActive,
        mustChangePassword: userPayload.mustChangePassword
      }
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Authentication server error.' });
  }
});

// POST /api/auth/change-password - Forced first-login or self password change
router.post('/auth/change-password', requireAuth, validateRequest({ body: changePasswordSchema }), async (req: Request, res: Response) => {
  const clientIp = getClientIp(req);
  try {
    const userId = req.user!.id;
    const { currentPassword, newPassword } = req.body;

    const userResult = await pool.query(
      'SELECT id, username, password_hash, role, full_name, must_change_password, token_version FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    const user = userResult.rows[0];

    // If password change is NOT forced by admin, require current password verification
    if (!user.must_change_password && currentPassword) {
      const match = await comparePassword(currentPassword, user.password_hash);
      if (!match) {
        return res.status(400).json({ error: 'Current password does not match.' });
      }
    }

    const newHash = await hashPassword(newPassword);
    const newTokenVersion = (user.token_version || 1) + 1;

    await pool.query(`
      UPDATE users
      SET password_hash = $1, must_change_password = FALSE, token_version = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `, [newHash, newTokenVersion, userId]);

    await recordSecurityAudit(pool, 'PASSWORD_CHANGED', {
      actorId: user.id,
      actorUsername: user.username,
      targetUserId: user.id,
      targetUsername: user.username,
      details: 'User successfully updated password (mustChangePassword cleared)',
      ipAddress: clientIp
    });

    await recordActivityLog(pool, {
      eventType: 'USER_PASSWORD_CHANGED',
      module: 'AUTHENTICATION',
      actorId: user.id,
      actorUsername: user.username,
      actorName: user.full_name || user.username,
      actorRole: user.role,
      targetId: user.id,
      targetName: user.username,
      actionSummary: `User "${user.username}" updated their account password`,
      details: 'User initiated password update; mustChangePassword requirement satisfied',
      ipAddress: clientIp
    });

    const updatedUserPayload = {
      id: user.id,
      username: user.username,
      fullName: user.full_name || user.username,
      role: user.role,
      isActive: true,
      mustChangePassword: false,
      tokenVersion: newTokenVersion
    };

    const updatedToken = generateAuthToken({
      id: updatedUserPayload.id,
      username: updatedUserPayload.username,
      role: updatedUserPayload.role,
      fullName: updatedUserPayload.fullName,
      tokenVersion: updatedUserPayload.tokenVersion
    });

    res.json({
      success: true,
      token: updatedToken,
      message: 'Password updated successfully. You now have full access to the application.',
      user: {
        id: updatedUserPayload.id,
        username: updatedUserPayload.username,
        fullName: updatedUserPayload.fullName,
        role: updatedUserPayload.role,
        isActive: true,
        mustChangePassword: false
      }
    });
  } catch (error: any) {
    console.error('Password change error:', error);
    res.status(500).json({ error: 'Failed to update password.' });
  }
});

// GET /api/auth/me - Verify active JWT token
router.get('/auth/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const result = await pool.query(
      'SELECT id, username, role, full_name, is_active, must_change_password, created_at, updated_at, last_login_at FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    const u = result.rows[0];
    res.json({
      id: u.id,
      username: u.username,
      fullName: u.full_name || u.username,
      role: u.role,
      isActive: Boolean(u.is_active),
      mustChangePassword: Boolean(u.must_change_password),
      createdAt: u.created_at,
      updatedAt: u.updated_at,
      lastLoginAt: u.last_login_at
    });
  } catch (error: any) {
    console.error('Auth verification error:', error);
    res.status(500).json({ error: 'Failed to verify authentication session.' });
  }
});

// ==================== USER MANAGEMENT (ADMIN ONLY) ====================

// GET /api/users - List users (ADMIN only)
router.get('/users', requireAuth, requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, username, role, full_name, is_active, must_change_password, created_at, updated_at, last_login_at FROM users ORDER BY created_at ASC'
    );
    res.json(result.rows.map(r => ({
      id: r.id,
      username: r.username,
      role: r.role,
      fullName: r.full_name,
      isActive: Boolean(r.is_active),
      mustChangePassword: Boolean(r.must_change_password),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastLoginAt: r.last_login_at
    })));
  } catch (error: any) {
    console.error('Fetch users error:', error);
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

// GET /api/users/audit-logs - View security audit logs (ADMIN only)
router.get('/users/audit-logs', requireAuth, requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT id, event_type, actor_id, actor_username, target_user_id, target_username, details, ip_address, created_at
      FROM security_audit_logs
      ORDER BY created_at DESC
      LIMIT 100;
    `);
    res.json(result.rows.map(r => ({
      id: r.id,
      eventType: r.event_type,
      actorId: r.actor_id,
      actorUsername: r.actor_username,
      targetUserId: r.target_user_id,
      targetUsername: r.target_username,
      details: r.details,
      ipAddress: r.ip_address,
      createdAt: r.created_at
    })));
  } catch (error: any) {
    console.error('Fetch audit logs error:', error);
    res.status(500).json({ error: 'Failed to fetch security audit logs.' });
  }
});

// POST /api/users - Create new user with generated temporary password (ADMIN only)
router.post('/users', requireAuth, requireRole('ADMIN'), validateRequest({ body: createUserSchema }), async (req: Request, res: Response) => {
  const clientIp = getClientIp(req);
  try {
    const { username, role, fullName } = req.body;
    const cleanUsername = username.trim().toLowerCase();

    const existing = await pool.query('SELECT id FROM users WHERE LOWER(username) = $1', [cleanUsername]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: `Username "${cleanUsername}" already exists.` });
    }

    const id = `usr_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    // Generate secure random temporary password on server
    const temporaryPassword = generateTemporaryPassword();
    const passHash = await hashPassword(temporaryPassword);

    const result = await pool.query(`
      INSERT INTO users (id, username, password_hash, role, full_name, is_active, must_change_password, token_version, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, TRUE, TRUE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id, username, role, full_name, is_active, must_change_password, created_at, updated_at;
    `, [id, cleanUsername, passHash, role, fullName]);

    const u = result.rows[0];

    await recordSecurityAudit(pool, 'USER_CREATED', {
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      targetUserId: u.id,
      targetUsername: u.username,
      details: `Created new user ${u.username} with role ${role} (Temporary password issued)`,
      ipAddress: clientIp
    });

    await recordActivityLog(pool, {
      eventType: 'USER_CREATED',
      module: 'USER_MANAGEMENT',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorName: req.user!.fullName,
      actorRole: req.user!.role,
      targetId: u.id,
      targetName: `${u.username} (${u.full_name || u.username})`,
      actionSummary: `Admin created user account "${u.username}" with role ${role}`,
      details: `Full Name: ${fullName} | Role: ${role} | Temporary password generated`,
      metadata: { username: u.username, role, fullName },
      ipAddress: clientIp
    });

    res.status(201).json({
      user: {
        id: u.id,
        username: u.username,
        role: u.role,
        fullName: u.full_name,
        isActive: Boolean(u.is_active),
        mustChangePassword: Boolean(u.must_change_password),
        createdAt: u.created_at,
        updatedAt: u.updated_at
      },
      temporaryPassword,
      message: 'User created successfully. Provide this temporary password to the user. It will not be displayed again.'
    });
  } catch (error: any) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user.' });
  }
});

// PATCH /api/users/:id/role - Update user role (ADMIN only)
router.patch('/users/:id/role', requireAuth, requireRole('ADMIN'), validateRequest({ params: idParamSchema, body: updateUserRoleSchema }), async (req: Request, res: Response) => {
  const clientIp = getClientIp(req);
  try {
    const { id } = req.params;
    const { role, fullName } = req.body;

    // A user must never be able to change their own role
    if (id === req.user!.id) {
      return res.status(400).json({
        error: 'You cannot modify your own role. Another administrator must change your permissions.'
      });
    }

    const existing = await pool.query('SELECT id, username, role FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const u = existing.rows[0];

    const result = await pool.query(`
      UPDATE users 
      SET role = $1, full_name = COALESCE($2, full_name), updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING id, username, role, full_name, is_active, must_change_password, created_at, updated_at, last_login_at;
    `, [role, fullName || null, id]);

    const updated = result.rows[0];

    await recordSecurityAudit(pool, 'ROLE_CHANGED', {
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      targetUserId: u.id,
      targetUsername: u.username,
      details: `Role updated from ${u.role} to ${role}`,
      ipAddress: clientIp
    });

    await recordActivityLog(pool, {
      eventType: 'USER_ROLE_CHANGED',
      module: 'USER_MANAGEMENT',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorName: req.user!.fullName,
      actorRole: req.user!.role,
      targetId: u.id,
      targetName: `${u.username} (${updated.full_name || u.username})`,
      actionSummary: `Changed role of user "${u.username}" from ${u.role} to ${role}`,
      details: `Previous Role: ${u.role} | New Role: ${role}`,
      metadata: { targetUsername: u.username, previousRole: u.role, newRole: role },
      ipAddress: clientIp
    });

    res.json({
      id: updated.id,
      username: updated.username,
      role: updated.role,
      fullName: updated.full_name,
      isActive: Boolean(updated.is_active),
      mustChangePassword: Boolean(updated.must_change_password),
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
      lastLoginAt: updated.last_login_at
    });
  } catch (error: any) {
    console.error('Update user role error:', error);
    res.status(500).json({ error: 'Failed to update user role.' });
  }
});

// PATCH /api/users/:id/status - Activate or Deactivate user (ADMIN only)
router.patch('/users/:id/status', requireAuth, requireRole('ADMIN'), validateRequest({ params: idParamSchema, body: updateUserStatusSchema }), async (req: Request, res: Response) => {
  const clientIp = getClientIp(req);
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    // Prevent deactivating own account
    if (id === req.user!.id && !isActive) {
      return res.status(400).json({
        error: 'You cannot deactivate your own active account.'
      });
    }

    const existing = await pool.query('SELECT id, username, role, is_active FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const u = existing.rows[0];

    // Invalidate existing sessions if deactivating
    const result = await pool.query(`
      UPDATE users 
      SET is_active = $1, token_version = token_version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, username, role, full_name, is_active, must_change_password, created_at, updated_at, last_login_at;
    `, [Boolean(isActive), id]);

    const updated = result.rows[0];
    const eventType = isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED';

    await recordSecurityAudit(pool, eventType, {
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      targetUserId: u.id,
      targetUsername: u.username,
      details: `Account ${isActive ? 'activated' : 'deactivated'} by administrator (sessions invalidated)`,
      ipAddress: clientIp
    });

    await recordActivityLog(pool, {
      eventType: 'USER_STATUS_CHANGED',
      module: 'USER_MANAGEMENT',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorName: req.user!.fullName,
      actorRole: req.user!.role,
      targetId: u.id,
      targetName: `${u.username} (${updated.full_name || u.username})`,
      actionSummary: `Admin ${isActive ? 'activated' : 'deactivated'} user account "${u.username}"`,
      details: `Status: ${isActive ? 'Active' : 'Suspended / Deactivated'}`,
      metadata: { targetUsername: u.username, isActive },
      ipAddress: clientIp
    });

    res.json({
      id: updated.id,
      username: updated.username,
      role: updated.role,
      fullName: updated.full_name,
      isActive: Boolean(updated.is_active),
      mustChangePassword: Boolean(updated.must_change_password),
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
      lastLoginAt: updated.last_login_at
    });
  } catch (error: any) {
    console.error('Update user status error:', error);
    res.status(500).json({ error: 'Failed to update user status.' });
  }
});

// POST /api/users/:id/reset-password - Reset password to a new temporary password (ADMIN only)
router.post('/users/:id/reset-password', requireAuth, requireRole('ADMIN'), validateRequest({ params: idParamSchema }), async (req: Request, res: Response) => {
  const clientIp = getClientIp(req);
  try {
    const { id } = req.params;

    const existing = await pool.query('SELECT id, username, role FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const u = existing.rows[0];

    // Generate new secure random temporary password
    const temporaryPassword = generateTemporaryPassword();
    const passHash = await hashPassword(temporaryPassword);

    // Invalidate existing sessions and require password change on next login
    await pool.query(`
      UPDATE users 
      SET password_hash = $1, must_change_password = TRUE, token_version = token_version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [passHash, id]);

    await recordSecurityAudit(pool, 'PASSWORD_RESET', {
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      targetUserId: u.id,
      targetUsername: u.username,
      details: `Password reset by administrator (mustChangePassword set to true, existing sessions invalidated)`,
      ipAddress: clientIp
    });

    await recordActivityLog(pool, {
      eventType: 'USER_PASSWORD_RESET',
      module: 'USER_MANAGEMENT',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorName: req.user!.fullName,
      actorRole: req.user!.role,
      targetId: u.id,
      targetName: `${u.username} (${u.full_name || u.username})`,
      actionSummary: `Admin reset temporary password for user "${u.username}"`,
      details: 'A fresh secure temporary password was generated. User must change password on next sign-in.',
      metadata: { targetUsername: u.username },
      ipAddress: clientIp
    });

    res.json({
      success: true,
      temporaryPassword,
      message: 'Password reset successfully. Provide this temporary password to the user. It will not be shown again.'
    });
  } catch (error: any) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset user password.' });
  }
});

// DELETE /api/users/:id - Permanently delete a user account (ADMIN only)
router.delete('/users/:id', requireAuth, requireRole('ADMIN'), validateRequest({ params: idParamSchema }), async (req: Request, res: Response) => {
  const clientIp = getClientIp(req);
  try {
    const { id } = req.params;

    // Self-deletion protection
    if (id === req.user!.id) {
      return res.status(400).json({ error: 'You cannot delete your own active administrator account.' });
    }

    const existing = await pool.query('SELECT id, username, full_name, role, is_active FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    const targetUser = existing.rows[0];

    // If deleting an admin, ensure at least one other active admin remains
    if (targetUser.role === 'ADMIN') {
      const adminCountResult = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'ADMIN' AND id != $1 AND is_active = TRUE", [id]);
      const remainingAdmins = parseInt(adminCountResult.rows[0].count, 10);
      if (remainingAdmins < 1) {
        return res.status(400).json({ error: 'Cannot delete this administrator. The system requires at least one active administrator.' });
      }
    }

    // Delete user from database
    await pool.query('DELETE FROM users WHERE id = $1', [id]);

    await recordSecurityAudit(pool, 'USER_DELETED', {
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      targetUserId: targetUser.id,
      targetUsername: targetUser.username,
      details: `User account "${targetUser.username}" (${targetUser.role}) permanently deleted by administrator`,
      ipAddress: clientIp
    });

    await recordActivityLog(pool, {
      eventType: 'USER_DELETED',
      module: 'USER_MANAGEMENT',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorName: req.user!.fullName,
      actorRole: req.user!.role,
      targetId: targetUser.id,
      targetName: `${targetUser.username} (${targetUser.full_name || targetUser.username})`,
      actionSummary: `Admin deleted user account "${targetUser.username}" (${targetUser.role})`,
      details: `Permanent deletion of user account: ${targetUser.full_name || targetUser.username} [${targetUser.username}] with role ${targetUser.role}.`,
      metadata: { deletedUsername: targetUser.username, deletedRole: targetUser.role },
      ipAddress: clientIp
    });

    res.json({
      success: true,
      message: `User account "${targetUser.username}" has been permanently deleted.`
    });
  } catch (error: any) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user account.' });
  }
});


// ==================== ROW MAPPING HELPERS ====================

function mapInventoryRow(row: any) {
  if (!row) return null;
  const currentStock = Number(row.current_stock ?? 0);
  const unitCost = Number(row.unit_cost ?? 0);
  return {
    id: row.id,
    itemCode: row.item_code,
    itemName: row.item_name,
    category: row.category,
    unitOfMeasure: row.unit_of_measure,
    minStockLevel: Number(row.min_stock_level ?? 0),
    maxStockLevel: Number(row.max_stock_level ?? 0),
    reorderQty: Number(row.reorder_qty ?? 0),
    currentStock,
    unitCost,
    totalValue: Number(row.total_value ?? currentStock * unitCost),
    status: row.status,
    supplier: row.supplier || '',
    lastRestocked: row.last_restocked || '',
    nextReviewDate: row.next_review_date || '',
    notes: row.notes || '',
    createdBy: row.created_by || 'system',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMovementRow(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    movementCode: row.movement_code,
    movementType: row.movement_type,
    itemId: row.item_id,
    itemCode: row.item_code,
    itemName: row.item_name,
    category: row.category,
    quantity: Number(row.quantity ?? 0),
    unitOfMeasure: row.unit_of_measure,
    previousStock: Number(row.previous_stock ?? 0),
    newStock: Number(row.new_stock ?? 0),
    recipient: row.recipient || '',
    issuedBy: row.issued_by || '',
    date: row.date || '',
    notes: row.notes || '',
    createdBy: row.created_by || 'system',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPORow(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    poNumber: row.po_number,
    itemId: row.item_id,
    itemCode: row.item_code,
    itemName: row.item_name,
    supplier: row.supplier || '',
    qtyOrdered: Number(row.qty_ordered ?? 0),
    unitCost: Number(row.unit_cost ?? 0),
    totalCost: Number(row.total_cost ?? 0),
    orderDate: row.order_date || '',
    expectedDate: row.expected_date || '',
    status: row.status,
    inventoryUpdated: Boolean(row.inventory_updated),
    notes: row.notes || '',
    createdBy: row.created_by || 'system',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCategoryRow(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    categoryName: row.category_name,
    description: row.description || '',
    primarySupplier: row.primary_supplier || '',
    reviewFrequency: row.review_frequency || '',
    itemCount: Number(row.item_count ?? 0),
    createdBy: row.created_by || 'system',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapActivityLogRow(row: any) {
  if (!row) return null;
  let metadata = null;
  if (row.metadata) {
    try {
      metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
    } catch {}
  }
  return {
    id: row.id,
    eventType: row.event_type,
    module: row.module,
    actorId: row.actor_id,
    actorUsername: row.actor_username,
    actorName: row.actor_name || row.actor_username,
    actorRole: row.actor_role || 'ADMIN',
    targetId: row.target_id,
    targetName: row.target_name,
    actionSummary: row.action_summary,
    details: row.details || '',
    metadata,
    ipAddress: row.ip_address || '',
    createdAt: row.created_at,
  };
}

async function syncCategoryCount(client: any, categoryName: string) {
  if (!categoryName) return;
  const countRes = await client.query(
    'SELECT COUNT(*)::int as count FROM inventory_items WHERE category = $1',
    [categoryName]
  );
  const count = countRes.rows[0]?.count || 0;
  await client.query(
    'UPDATE categories SET item_count = $1, updated_at = CURRENT_TIMESTAMP WHERE category_name = $2',
    [count, categoryName]
  );
}

// ==================== INVENTORY ROUTES ====================

// GET /api/inventory (ADMIN, GUEST)
router.get('/inventory', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM inventory_items ORDER BY updated_at DESC');
    res.json(result.rows.map(mapInventoryRow));
  } catch (error: any) {
    console.error('Fetch inventory error:', error);
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

// POST /api/inventory (ADMIN & MANAGER)
router.post('/inventory', requireAuth, requireRole('ADMIN', 'MANAGER'), validateRequest({ body: createInventoryItemSchema }), async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {
      itemCode,
      itemName,
      category,
      unitOfMeasure,
      minStockLevel,
      maxStockLevel,
      quantity,
      reorderQty,
      currentStock,
      unitCost,
      supplier,
      dateReceived,
      lastRestocked,
      nextReviewDate,
      notes
    } = req.body;

    const cleanItemCode = itemCode.trim();

    // Check for duplicate item code (case-insensitive)
    const existingCode = await client.query(
      'SELECT id, item_name FROM inventory_items WHERE LOWER(TRIM(item_code)) = LOWER($1)',
      [cleanItemCode]
    );
    if (existingCode.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Item Code "${cleanItemCode}" is already in use by "${existingCode.rows[0].item_name}". Please enter or generate a unique Item Code.`
      });
    }

    const id = `item_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    // Support quantity parameter, falling back to currentStock or reorderQty
    const parsedQty = quantity !== undefined ? Number(quantity) : (currentStock !== undefined ? Number(currentStock) : Number(reorderQty || 0));
    const finalStock = parsedQty;
    const finalReorderQty = parsedQty;
    const finalMinStock = Number(minStockLevel || 0);
    const finalMaxStock = maxStockLevel !== undefined ? Number(maxStockLevel) : Math.max(1000, finalMinStock * 10, finalStock * 5);
    const finalDateReceived = dateReceived || lastRestocked || new Date().toISOString().split('T')[0];

    const totalValue = Number(finalStock) * Number(unitCost || 0);

    let status = 'IN STOCK';
    if (Number(finalStock) <= 0) {
      status = 'OUT OF STOCK';
    } else if (Number(finalStock) <= Number(finalMinStock)) {
      status = 'LOW STOCK';
    }

    const createdBy = req.user?.username || 'system';

    const insertQuery = `
      INSERT INTO inventory_items (
        id, item_code, item_name, category, unit_of_measure, min_stock_level, max_stock_level,
        reorder_qty, current_stock, unit_cost, total_value, status, supplier, last_restocked,
        next_review_date, notes, created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *;
    `;

    const result = await client.query(insertQuery, [
      id, cleanItemCode, itemName, category, unitOfMeasure, finalMinStock, finalMaxStock,
      finalReorderQty, finalStock, unitCost, totalValue, status, supplier, finalDateReceived,
      nextReviewDate, notes || '', createdBy
    ]);

    // Insert into immutable audit ledger if initial stock > 0
    if (Number(currentStock) > 0) {
      const txCode = `TX-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
      await client.query(`
        INSERT INTO inventory_transactions (
          id, transaction_code, item_id, change_qty, stock_before, stock_after,
          transaction_type, reference_id, notes, performed_by, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
      `, [
        `tx_${Date.now()}`, txCode, id, currentStock, 0, currentStock,
        'INITIAL_STOCK', id, 'Initial stock entry upon creation', createdBy
      ]);
    }

    await syncCategoryCount(client, category);

    // Record universal activity log
    const clientIp = getClientIp(req);
    await recordActivityLog(client, {
      eventType: 'INVENTORY_CREATED',
      module: 'INVENTORY',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorName: req.user!.fullName,
      actorRole: req.user!.role,
      targetId: id,
      targetName: `${cleanItemCode} - ${itemName}`,
      actionSummary: `Created new material item "${cleanItemCode}" (${itemName}) with initial stock of ${currentStock} ${unitOfMeasure}`,
      details: `Category: ${category} | Unit Cost: GHS ${Number(unitCost).toFixed(2)} | Supplier: ${supplier || 'N/A'} | Min Stock: ${minStockLevel}`,
      metadata: {
        itemCode: cleanItemCode,
        itemName,
        category,
        currentStock: Number(currentStock),
        unitCost: Number(unitCost),
        unitOfMeasure,
        supplier,
        minStockLevel: Number(minStockLevel)
      },
      ipAddress: clientIp
    });

    await client.query('COMMIT');

    console.log(`[SECURITY AUDIT] Item created: ${cleanItemCode} by ${req.user!.username} (${req.user!.role})`);
    res.status(201).json(mapInventoryRow(result.rows[0]));
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Add inventory error:', error);
    res.status(500).json({ error: error.code === '23505' ? 'Duplicate item code constraint violation' : 'Failed to add inventory item' });
  } finally {
    client.release();
  }
});

// PUT /api/inventory/:id (ADMIN & MANAGER)
router.put('/inventory/:id', requireAuth, requireRole('ADMIN', 'MANAGER'), validateRequest({ params: idParamSchema, body: updateInventoryItemSchema }), async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    
    // Lock row for update
    const existing = await client.query('SELECT * FROM inventory_items WHERE id = $1 FOR UPDATE', [id]);
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item not found' });
    }

    const prev = existing.rows[0];
    const body = req.body;

    const itemCode = body.itemCode ? body.itemCode.trim() : prev.item_code;
    const itemName = body.itemName ?? prev.item_name;

    // Check if new itemCode collides with another existing item
    if (itemCode && itemCode.toLowerCase() !== prev.item_code.toLowerCase()) {
      const existingCode = await client.query(
        'SELECT id, item_name FROM inventory_items WHERE LOWER(TRIM(item_code)) = LOWER($1) AND id != $2',
        [itemCode, id]
      );
      if (existingCode.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Item Code "${itemCode}" is already in use by "${existingCode.rows[0].item_name}". Please enter or generate a unique Item Code.`
        });
      }
    }

    const category = body.category ?? prev.category;
    const unitOfMeasure = body.unitOfMeasure ?? prev.unit_of_measure;
    const minStockLevel = body.minStockLevel !== undefined ? Number(body.minStockLevel) : Number(prev.min_stock_level);
    const maxStockLevel = body.maxStockLevel !== undefined ? Number(body.maxStockLevel) : Number(prev.max_stock_level);
    
    // Support quantity property directly
    const currentStock = body.quantity !== undefined 
      ? Number(body.quantity) 
      : (body.currentStock !== undefined ? Number(body.currentStock) : (body.reorderQty !== undefined ? Number(body.reorderQty) : Number(prev.current_stock)));
    const reorderQty = currentStock;

    const unitCost = body.unitCost !== undefined ? Number(body.unitCost) : Number(prev.unit_cost);
    const supplier = body.supplier ?? prev.supplier;
    const lastRestocked = body.dateReceived ?? (body.lastRestocked ?? prev.last_restocked);
    const nextReviewDate = body.nextReviewDate ?? prev.next_review_date;
    const notes = String(body.notes || '').trim();

    if (!notes) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Notes are required when updating an inventory item. Please provide a reason for the modification.' });
    }

    const totalValue = currentStock * unitCost;
    let status = 'IN STOCK';
    if (currentStock <= 0) {
      status = 'OUT OF STOCK';
    } else if (currentStock <= minStockLevel) {
      status = 'LOW STOCK';
    }

    const updateQuery = `
      UPDATE inventory_items SET
        item_code = $1, item_name = $2, category = $3, unit_of_measure = $4,
        min_stock_level = $5, max_stock_level = $6, reorder_qty = $7, current_stock = $8,
        unit_cost = $9, total_value = $10, status = $11, supplier = $12,
        last_restocked = $13, next_review_date = $14, notes = $15, updated_at = CURRENT_TIMESTAMP
      WHERE id = $16
      RETURNING *;
    `;

    const result = await client.query(updateQuery, [
      itemCode, itemName, category, unitOfMeasure,
      minStockLevel, maxStockLevel, reorderQty, currentStock,
      unitCost, totalValue, status, supplier,
      lastRestocked, nextReviewDate, notes, id
    ]);

    // If currentStock was modified directly, log transaction
    if (currentStock !== Number(prev.current_stock)) {
      const changeQty = currentStock - Number(prev.current_stock);
      const txCode = `TX-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
      await client.query(`
        INSERT INTO inventory_transactions (
          id, transaction_code, item_id, change_qty, stock_before, stock_after,
          transaction_type, reference_id, notes, performed_by, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
      `, [
        `tx_${Date.now()}`, txCode, id, changeQty, prev.current_stock, currentStock,
        'MANUAL_UPDATE', id, 'Direct stock adjustment via inventory edit', req.user?.username || 'system'
      ]);
    }

    if (category !== prev.category) {
      await syncCategoryCount(client, prev.category);
      await syncCategoryCount(client, category);
    }

    // Build human-readable field changes for audit
    const changes: string[] = [];
    if (prev.item_name !== itemName) changes.push(`Name: "${prev.item_name}" → "${itemName}"`);
    if (prev.item_code !== itemCode) changes.push(`Code: "${prev.item_code}" → "${itemCode}"`);
    if (Number(prev.current_stock) !== currentStock) changes.push(`Stock: ${prev.current_stock} → ${currentStock} ${unitOfMeasure}`);
    if (Number(prev.unit_cost) !== unitCost) changes.push(`Unit Cost: GHS ${Number(prev.unit_cost).toFixed(2)} → GHS ${unitCost.toFixed(2)}`);
    if (prev.category !== category) changes.push(`Category: "${prev.category}" → "${category}"`);
    if (prev.supplier !== supplier) changes.push(`Supplier: "${prev.supplier || 'None'}" → "${supplier || 'None'}"`);
    if (Number(prev.min_stock_level) !== minStockLevel) changes.push(`Min Stock: ${prev.min_stock_level} → ${minStockLevel}`);
    if (prev.unit_of_measure !== unitOfMeasure) changes.push(`Unit: "${prev.unit_of_measure}" → "${unitOfMeasure}"`);
    if (prev.status !== status) changes.push(`Status: ${prev.status} → ${status}`);

    const summary = changes.length > 0
      ? `Updated item "${itemCode}" (${itemName}): ${changes.join('; ')}`
      : `Updated material attributes for "${itemCode}" (${itemName})`;

    const clientIp = getClientIp(req);
    await recordActivityLog(client, {
      eventType: 'INVENTORY_UPDATED',
      module: 'INVENTORY',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorName: req.user!.fullName,
      actorRole: req.user!.role,
      targetId: id,
      targetName: `${itemCode} - ${itemName}`,
      actionSummary: summary,
      details: changes.join('\n') || 'Inventory properties modified.',
      metadata: {
        itemCode,
        itemName,
        changes,
        before: {
          stock: Number(prev.current_stock),
          cost: Number(prev.unit_cost),
          category: prev.category,
          supplier: prev.supplier,
          status: prev.status
        },
        after: {
          stock: currentStock,
          cost: unitCost,
          category,
          supplier,
          status
        }
      },
      ipAddress: clientIp
    });

    await client.query('COMMIT');
    console.log(`[SECURITY AUDIT] Item updated: ${itemCode} by ${req.user!.username} (${req.user!.role})`);
    res.json(mapInventoryRow(result.rows[0]));
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Update inventory error:', error);
    res.status(500).json({ error: error.code === '23505' ? 'Duplicate constraint violation' : 'Failed to update inventory item' });
  } finally {
    client.release();
  }
});

// DELETE /api/inventory/:id (ADMIN & MANAGER)
router.delete('/inventory/:id', requireAuth, requireRole('ADMIN', 'MANAGER'), validateRequest({ params: idParamSchema }), async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const existing = await client.query('SELECT category, item_code, item_name, current_stock FROM inventory_items WHERE id = $1', [id]);
    
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item not found' });
    }

    const item = existing.rows[0];
    await client.query('DELETE FROM inventory_items WHERE id = $1', [id]);
    await syncCategoryCount(client, item.category);

    const clientIp = getClientIp(req);
    await recordActivityLog(client, {
      eventType: 'INVENTORY_DELETED',
      module: 'INVENTORY',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorName: req.user!.fullName,
      actorRole: req.user!.role,
      targetId: id,
      targetName: `${item.item_code} - ${item.item_name}`,
      actionSummary: `Permanently deleted inventory item "${item.item_code}" (${item.item_name})`,
      details: `Category: ${item.category} | Final Stock Level: ${item.current_stock || 0}`,
      metadata: {
        itemCode: item.item_code,
        itemName: item.item_name,
        category: item.category,
        lastStock: item.current_stock
      },
      ipAddress: clientIp
    });

    await client.query('COMMIT');
    console.log(`[SECURITY AUDIT] Item deleted: ${item.item_code} (${item.item_name}) by admin ${req.user!.username}`);
    res.json({ success: true, id });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Delete inventory error:', error);
    res.status(500).json({ error: 'Failed to delete inventory item' });
  } finally {
    client.release();
  }
});

// ==================== STOCK MOVEMENTS & DISPATCHES ====================

// GET /api/stock-movements (ADMIN, GUEST)
router.get('/stock-movements', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM stock_movements ORDER BY updated_at DESC');
    res.json(result.rows.map(mapMovementRow));
  } catch (error: any) {
    console.error('Fetch movements error:', error);
    res.status(500).json({ error: 'Failed to fetch stock movements' });
  }
});

// POST /api/stock-movements (ADMIN & MANAGER)
// ACID Transaction with Row-Level Locking (`FOR UPDATE`) to prevent negative inventory & race conditions
router.post('/stock-movements', requireAuth, requireRole('ADMIN', 'MANAGER'), validateRequest({ body: createStockMovementSchema }), async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      movementCode,
      movementType,
      itemId,
      itemCode,
      itemName,
      quantity,
      unitOfMeasure,
      recipient,
      issuedBy,
      date,
      notes
    } = req.body;

    const reqQty = Number(quantity);

    let targetItemId = itemId;
    let itemRow: any = null;

    // Find item & LOCK ROW FOR UPDATE
    if (targetItemId) {
      const itemRes = await client.query('SELECT * FROM inventory_items WHERE id = $1 FOR UPDATE', [targetItemId]);
      if (itemRes.rows.length > 0) {
        itemRow = itemRes.rows[0];
      }
    }

    if (!itemRow && itemCode) {
      const itemRes = await client.query('SELECT * FROM inventory_items WHERE LOWER(TRIM(item_code)) = LOWER(TRIM($1)) FOR UPDATE', [itemCode]);
      if (itemRes.rows.length > 0) {
        itemRow = itemRes.rows[0];
        targetItemId = itemRow.id;
      }
    }

    if (!itemRow && itemName) {
      const itemRes = await client.query('SELECT * FROM inventory_items WHERE LOWER(TRIM(item_name)) = LOWER(TRIM($1)) FOR UPDATE', [itemName]);
      if (itemRes.rows.length > 0) {
        itemRow = itemRes.rows[0];
        targetItemId = itemRow.id;
      }
    }

    if (!itemRow) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `Inventory item not found for code: ${itemCode || itemName}` });
    }

    const prevStock = Number(itemRow.current_stock ?? 0);
    const minLevel = Number(itemRow.min_stock_level ?? 0);
    const unitCost = Number(itemRow.unit_cost ?? 0);

    let newStock = prevStock;
    let changeQty = 0;

    if (movementType === 'ISSUED_OUT') {
      // PREVENT NEGATIVE INVENTORY
      if (prevStock < reqQty) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Insufficient stock! Requested ${reqQty} units, but only ${prevStock} units are currently available.`
        });
      }
      newStock = prevStock - reqQty;
      changeQty = -reqQty;
    } else if (movementType === 'RESTOCKED') {
      newStock = prevStock + reqQty;
      changeQty = reqQty;
    } else { // ADJUSTMENT
      newStock = reqQty;
      changeQty = reqQty - prevStock;
    }

    let status = 'IN STOCK';
    if (newStock <= 0) {
      status = 'OUT OF STOCK';
    } else if (newStock <= minLevel) {
      status = 'LOW STOCK';
    }

    const newTotalValue = newStock * unitCost;

    // 1. Update inventory item stock & status
    const updatePayload: any[] = [newStock, status, newTotalValue, targetItemId];
    let updateSql = `UPDATE inventory_items SET current_stock = $1, status = $2, total_value = $3, updated_at = CURRENT_TIMESTAMP`;
    
    if (movementType === 'RESTOCKED') {
      updateSql += `, last_restocked = $5 WHERE id = $4`;
      updatePayload.push(date);
    } else {
      updateSql += ` WHERE id = $4`;
    }

    await client.query(updateSql, updatePayload);

    // 2. Insert Movement Record
    const movId = `mov_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const finalMovCode = movementCode || `MOV-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;
    const createdBy = req.user?.username || 'system';

    const movRes = await client.query(`
      INSERT INTO stock_movements (
        id, movement_code, movement_type, item_id, item_code, item_name, category,
        quantity, unit_of_measure, previous_stock, new_stock, recipient, issued_by,
        date, notes, created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *;
    `, [
      movId, finalMovCode, movementType, targetItemId, itemRow.item_code, itemRow.item_name, itemRow.category,
      reqQty, unitOfMeasure || itemRow.unit_of_measure, prevStock, newStock, recipient, issuedBy || req.user?.fullName,
      date, notes, createdBy
    ]);

    // 3. Insert into Immutable Audit Ledger (inventory_transactions)
    const txId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const txCode = `TX-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

    await client.query(`
      INSERT INTO inventory_transactions (
        id, transaction_code, item_id, change_qty, stock_before, stock_after,
        transaction_type, reference_id, notes, performed_by, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
    `, [
      txId, txCode, targetItemId, changeQty, prevStock, newStock,
      movementType, movId, `Movement ${finalMovCode}: ${movementType} (${recipient || 'Warehouse'})`, req.user?.username || createdBy
    ]);

    // Record universal activity log
    const clientIp = getClientIp(req);
    let eventType: 'STOCK_DISPATCHED' | 'STOCK_RESTOCKED' | 'STOCK_ADJUSTED' = 'STOCK_DISPATCHED';
    let actionSummary = '';
    const uom = unitOfMeasure || itemRow.unit_of_measure || 'units';

    if (movementType === 'ISSUED_OUT') {
      eventType = 'STOCK_DISPATCHED';
      actionSummary = `Dispatched ${reqQty} ${uom} of "${itemRow.item_code}" (${itemRow.item_name}) to ${recipient || 'Destination'} (Stock: ${prevStock} → ${newStock})`;
    } else if (movementType === 'RESTOCKED') {
      eventType = 'STOCK_RESTOCKED';
      actionSummary = `Restocked ${reqQty} ${uom} of "${itemRow.item_code}" (${itemRow.item_name}) into inventory (Stock: ${prevStock} → ${newStock})`;
    } else {
      eventType = 'STOCK_ADJUSTED';
      actionSummary = `Adjusted inventory stock for "${itemRow.item_code}" (${itemRow.item_name}) from ${prevStock} to ${newStock} ${uom}`;
    }

    await recordActivityLog(client, {
      eventType,
      module: 'STOCK_MOVEMENTS',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorName: req.user!.fullName,
      actorRole: req.user!.role,
      targetId: movId,
      targetName: `${finalMovCode} - ${itemRow.item_code}`,
      actionSummary,
      details: `Type: ${movementType} | Quantity: ${reqQty} ${uom} | Recipient/Site: ${recipient || 'N/A'} | Dispatched By: ${issuedBy || req.user?.fullName} | Notes: ${notes || 'None'}`,
      metadata: {
        movementCode: finalMovCode,
        movementType,
        itemCode: itemRow.item_code,
        itemName: itemRow.item_name,
        quantity: reqQty,
        unitOfMeasure: uom,
        previousStock: prevStock,
        newStock,
        recipient,
        issuedBy
      },
      ipAddress: clientIp
    });

    await client.query('COMMIT');
    console.log(`[SECURITY AUDIT] Stock movement recorded: ${finalMovCode} (${movementType} qty:${reqQty}) by ${req.user!.username}`);
    res.status(201).json(mapMovementRow(movRes.rows[0]));
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Stock movement transaction error:', error);
    res.status(500).json({ error: error.message || 'Failed to execute stock movement transaction' });
  } finally {
    client.release();
  }
});

// DELETE /api/stock-movements/:id (ADMIN & MANAGER)
router.delete('/stock-movements/:id', requireAuth, requireRole('ADMIN', 'MANAGER'), validateRequest({ params: idParamSchema }), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await pool.query('SELECT movement_code, item_code, item_name, quantity, movement_type FROM stock_movements WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Stock movement not found' });
    }
    const mov = existing.rows[0];
    await pool.query('DELETE FROM stock_movements WHERE id = $1', [id]);
    
    const clientIp = getClientIp(req);
    await recordActivityLog(pool, {
      eventType: 'STOCK_MOVEMENT_DELETED',
      module: 'STOCK_MOVEMENTS',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorName: req.user!.fullName,
      actorRole: req.user!.role,
      targetId: id,
      targetName: mov.movement_code,
      actionSummary: `Deleted stock movement log "${mov.movement_code}" (${mov.movement_type}: ${mov.quantity} units of ${mov.item_code})`,
      details: `Deleted movement ID: ${id} | Code: ${mov.movement_code}`,
      ipAddress: clientIp
    });

    console.log(`[SECURITY AUDIT] Stock movement record deleted: ${mov.movement_code} by admin ${req.user!.username}`);
    res.json({ success: true, id });
  } catch (error: any) {
    console.error('Delete movement error:', error);
    res.status(500).json({ error: 'Failed to delete stock movement' });
  }
});

// ==================== PURCHASE ORDERS ====================

// GET /api/purchase-orders (ADMIN, GUEST)
router.get('/purchase-orders', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM purchase_orders ORDER BY updated_at DESC');
    res.json(result.rows.map(mapPORow));
  } catch (error: any) {
    console.error('Fetch POs error:', error);
    res.status(500).json({ error: 'Failed to fetch purchase orders' });
  }
});

// POST /api/purchase-orders (ADMIN & MANAGER)
router.post('/purchase-orders', requireAuth, requireRole('ADMIN', 'MANAGER'), validateRequest({ body: createPOSchema }), async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      poNumber,
      itemId,
      itemCode,
      itemName,
      supplier,
      qtyOrdered,
      unitCost,
      orderDate,
      expectedDate,
      status,
      notes
    } = req.body;

    const numQty = Number(qtyOrdered);
    const numUnitCost = Number(unitCost);
    const totalCost = numQty * numUnitCost;

    let targetItemId = itemId;
    let itemRow: any = null;

    if (targetItemId) {
      const itemRes = await client.query('SELECT * FROM inventory_items WHERE id = $1 FOR UPDATE', [targetItemId]);
      if (itemRes.rows.length > 0) itemRow = itemRes.rows[0];
    }

    if (!itemRow && itemCode) {
      const itemRes = await client.query('SELECT * FROM inventory_items WHERE LOWER(TRIM(item_code)) = LOWER(TRIM($1)) FOR UPDATE', [itemCode]);
      if (itemRes.rows.length > 0) {
        itemRow = itemRes.rows[0];
        targetItemId = itemRow.id;
      }
    }

    if (!itemRow && itemName) {
      const itemRes = await client.query('SELECT * FROM inventory_items WHERE LOWER(TRIM(item_name)) = LOWER(TRIM($1)) FOR UPDATE', [itemName]);
      if (itemRes.rows.length > 0) {
        itemRow = itemRes.rows[0];
        targetItemId = itemRow.id;
      }
    }

    let inventoryUpdated = false;
    const isCompleted = status === 'COMPLETED';
    const createdBy = req.user?.username || 'system';

    if (itemRow && targetItemId) {
      if (isCompleted) {
        const prevStock = Number(itemRow.current_stock ?? 0);
        const newStock = prevStock + numQty;
        const minLevel = Number(itemRow.min_stock_level ?? 10);
        
        let newStatus = 'IN STOCK';
        if (newStock <= 0) newStatus = 'OUT OF STOCK';
        else if (newStock <= minLevel) newStatus = 'LOW STOCK';

        const finalUnitCost = numUnitCost || Number(itemRow.unit_cost ?? 0);

        await client.query(`
          UPDATE inventory_items SET
            current_stock = $1, status = $2, unit_cost = $3, total_value = $4,
            supplier = $5, last_restocked = $6, updated_at = CURRENT_TIMESTAMP
          WHERE id = $7
        `, [newStock, newStatus, finalUnitCost, newStock * finalUnitCost, supplier || itemRow.supplier, orderDate, targetItemId]);

        // Stock movement entry
        const movCode = `MOV-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;
        const movId = `mov_${Date.now()}`;
        await client.query(`
          INSERT INTO stock_movements (
            id, movement_code, movement_type, item_id, item_code, item_name, category,
            quantity, unit_of_measure, previous_stock, new_stock, recipient, issued_by,
            date, notes, created_by, created_at, updated_at
          ) VALUES ($1, $2, 'RESTOCKED', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `, [
          movId, movCode, targetItemId, itemCode || itemRow.item_code, itemName || itemRow.item_name, itemRow.category || 'General Materials',
          numQty, itemRow.unit_of_measure || 'Units', prevStock, newStock, `Store Restock (PO: ${poNumber})`, supplier || 'Supplier',
          orderDate, `Auto-restocked via Purchase Order ${poNumber}`, createdBy
        ]);

        // Immutable Audit Entry
        const txCode = `TX-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
        await client.query(`
          INSERT INTO inventory_transactions (
            id, transaction_code, item_id, change_qty, stock_before, stock_after,
            transaction_type, reference_id, notes, performed_by, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, 'PO_FULFILLMENT', $7, $8, $9, CURRENT_TIMESTAMP)
        `, [
          `tx_${Date.now()}`, txCode, targetItemId, numQty, prevStock, newStock,
          poNumber, `PO ${poNumber} fulfilled`, createdBy
        ]);

        inventoryUpdated = true;
      }
    } else {
      // Auto-create material item if it doesn't exist yet
      const initialStock = isCompleted ? numQty : 0;
      const category = 'General Materials';
      const unitOfMeasure = 'Units';
      const minStockLevel = 10;
      let initialStatus = initialStock <= 0 ? 'OUT OF STOCK' : (initialStock <= minStockLevel ? 'LOW STOCK' : 'IN STOCK');

      targetItemId = `item_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      
      await client.query(`
        INSERT INTO inventory_items (
          id, item_code, item_name, category, unit_of_measure, min_stock_level, max_stock_level,
          reorder_qty, current_stock, unit_cost, total_value, status, supplier, last_restocked,
          next_review_date, notes, created_by, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [
        targetItemId, itemCode || 'SKH-ITEM', itemName, category, unitOfMeasure, minStockLevel,
        Math.max(100, numQty * 2), numQty, initialStock, numUnitCost, initialStock * numUnitCost, initialStatus,
        supplier, isCompleted ? orderDate : '', expectedDate, `Auto-created from PO ${poNumber}`, createdBy
      ]);

      if (isCompleted) {
        const movCode = `MOV-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;
        await client.query(`
          INSERT INTO stock_movements (
            id, movement_code, movement_type, item_id, item_code, item_name, category,
            quantity, unit_of_measure, previous_stock, new_stock, recipient, issued_by,
            date, notes, created_by, created_at, updated_at
          ) VALUES ($1, $2, 'RESTOCKED', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `, [
          `mov_${Date.now()}`, movCode, targetItemId, itemCode || 'SKH-ITEM', itemName, category,
          numQty, unitOfMeasure, 0, initialStock, `Store Restock (PO: ${poNumber})`, supplier || 'Supplier',
          orderDate, `Auto-restocked via Purchase Order ${poNumber}`, createdBy
        ]);

        const txCode = `TX-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
        await client.query(`
          INSERT INTO inventory_transactions (
            id, transaction_code, item_id, change_qty, stock_before, stock_after,
            transaction_type, reference_id, notes, performed_by, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, 'PO_FULFILLMENT', $7, $8, $9, CURRENT_TIMESTAMP)
        `, [
          `tx_${Date.now()}`, txCode, targetItemId, numQty, 0, initialStock,
          poNumber, `PO ${poNumber} fulfilled for new item`, createdBy
        ]);

        inventoryUpdated = true;
      }

      await syncCategoryCount(client, category);
    }

    const poId = `po_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const poRes = await client.query(`
      INSERT INTO purchase_orders (
        id, po_number, item_id, item_code, item_name, supplier, qty_ordered, unit_cost,
        total_cost, order_date, expected_date, status, inventory_updated, notes, created_by,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *;
    `, [
      poId, poNumber, targetItemId, itemCode, itemName, supplier, numQty, numUnitCost,
      totalCost, orderDate, expectedDate, status, inventoryUpdated, notes, createdBy
    ]);

    const clientIp = getClientIp(req);
    await recordActivityLog(client, {
      eventType: 'PO_CREATED',
      module: 'PURCHASE_ORDERS',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorName: req.user!.fullName,
      actorRole: req.user!.role,
      targetId: poId,
      targetName: `${poNumber} - ${supplier || 'Supplier'}`,
      actionSummary: `Created purchase order "${poNumber}" for ${numQty} units of ${itemCode || itemName} (Total: GHS ${totalCost.toFixed(2)})`,
      details: `Supplier: ${supplier || 'N/A'} | Status: ${status} | Unit Cost: GHS ${numUnitCost.toFixed(2)} | Expected: ${expectedDate || 'TBD'}`,
      metadata: {
        poNumber,
        itemCode,
        itemName,
        supplier,
        qtyOrdered: numQty,
        unitCost: numUnitCost,
        totalCost,
        status,
        inventoryUpdated
      },
      ipAddress: clientIp
    });

    await client.query('COMMIT');
    console.log(`[SECURITY AUDIT] Purchase order created: ${poNumber} by ${req.user!.username}`);
    res.status(201).json(mapPORow(poRes.rows[0]));
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Create PO error:', error);
    res.status(500).json({ error: 'Failed to create purchase order' });
  } finally {
    client.release();
  }
});

// PATCH /api/purchase-orders/:id/status (ADMIN & MANAGER)
router.patch('/purchase-orders/:id/status', requireAuth, requireRole('ADMIN', 'MANAGER'), validateRequest({ params: idParamSchema, body: updatePOStatusSchema }), async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { status: newStatus } = req.body;

    const poRes = await client.query('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [id]);
    if (poRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Purchase Order not found' });
    }

    const poData = poRes.rows[0];
    const currentlyUpdated = Boolean(poData.inventory_updated);
    let inventoryUpdated = currentlyUpdated;

    if (newStatus === 'COMPLETED' && !currentlyUpdated) {
      let targetItemId = poData.item_id;
      let itemRow: any = null;

      if (targetItemId) {
        const itemRes = await client.query('SELECT * FROM inventory_items WHERE id = $1 FOR UPDATE', [targetItemId]);
        if (itemRes.rows.length > 0) itemRow = itemRes.rows[0];
      }

      if (!itemRow) {
        const itemRes = await client.query('SELECT * FROM inventory_items WHERE LOWER(TRIM(item_code)) = LOWER(TRIM($1)) FOR UPDATE', [poData.item_code]);
        if (itemRes.rows.length > 0) {
          itemRow = itemRes.rows[0];
          targetItemId = itemRow.id;
        }
      }

      if (itemRow && targetItemId) {
        const prevStock = Number(itemRow.current_stock ?? 0);
        const qtyOrdered = Number(poData.qty_ordered ?? 0);
        const newStock = prevStock + qtyOrdered;
        const minLevel = Number(itemRow.min_stock_level ?? 10);

        let newInvStatus = 'IN STOCK';
        if (newStock <= 0) newInvStatus = 'OUT OF STOCK';
        else if (newStock <= minLevel) newInvStatus = 'LOW STOCK';

        const unitCost = Number(poData.unit_cost) || Number(itemRow.unit_cost) || 0;

        await client.query(`
          UPDATE inventory_items SET
            current_stock = $1, status = $2, unit_cost = $3, total_value = $4,
            supplier = $5, last_restocked = $6, updated_at = CURRENT_TIMESTAMP
          WHERE id = $7
        `, [newStock, newInvStatus, unitCost, newStock * unitCost, poData.supplier || itemRow.supplier, poData.order_date, targetItemId]);

        const movCode = `MOV-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;
        await client.query(`
          INSERT INTO stock_movements (
            id, movement_code, movement_type, item_id, item_code, item_name, category,
            quantity, unit_of_measure, previous_stock, new_stock, recipient, issued_by,
            date, notes, created_by, created_at, updated_at
          ) VALUES ($1, $2, 'RESTOCKED', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `, [
          `mov_${Date.now()}`, movCode, targetItemId, poData.item_code, poData.item_name, itemRow.category || 'General Materials',
          qtyOrdered, itemRow.unit_of_measure || 'Units', prevStock, newStock, `Store Restock (PO: ${poData.po_number})`,
          poData.supplier || 'Supplier', poData.order_date, `Auto-restocked on PO fulfillment (${poData.po_number})`, req.user?.username || poData.created_by
        ]);

        const txCode = `TX-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
        await client.query(`
          INSERT INTO inventory_transactions (
            id, transaction_code, item_id, change_qty, stock_before, stock_after,
            transaction_type, reference_id, notes, performed_by, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, 'PO_FULFILLMENT', $7, $8, $9, CURRENT_TIMESTAMP)
        `, [
          `tx_${Date.now()}`, txCode, targetItemId, qtyOrdered, prevStock, newStock,
          poData.po_number, `Status updated to COMPLETED for PO ${poData.po_number}`, req.user?.username || poData.created_by
        ]);

        inventoryUpdated = true;
      }
    } else if ((newStatus === 'PENDING' || newStatus === 'CANCELLED') && currentlyUpdated) {
      if (poData.item_id) {
        const itemRes = await client.query('SELECT * FROM inventory_items WHERE id = $1 FOR UPDATE', [poData.item_id]);
        if (itemRes.rows.length > 0) {
          const itemRow = itemRes.rows[0];
          const prevStock = Number(itemRow.current_stock ?? 0);
          const qtyOrdered = Number(poData.qty_ordered ?? 0);
          const newStock = Math.max(0, prevStock - qtyOrdered);
          const minLevel = Number(itemRow.min_stock_level ?? 10);

          let newInvStatus = 'IN STOCK';
          if (newStock <= 0) newInvStatus = 'OUT OF STOCK';
          else if (newStock <= minLevel) newInvStatus = 'LOW STOCK';

          await client.query(`
            UPDATE inventory_items SET
              current_stock = $1, status = $2, total_value = $3, updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
          `, [newStock, newInvStatus, newStock * Number(itemRow.unit_cost), poData.item_id]);
        }
      }
      inventoryUpdated = false;
    }

    const updatedPO = await client.query(`
      UPDATE purchase_orders SET status = $1, inventory_updated = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *;
    `, [newStatus, inventoryUpdated, id]);

    const clientIp = getClientIp(req);
    await recordActivityLog(client, {
      eventType: 'PO_STATUS_CHANGED',
      module: 'PURCHASE_ORDERS',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorName: req.user!.fullName,
      actorRole: req.user!.role,
      targetId: id,
      targetName: poData.po_number,
      actionSummary: `Updated status of purchase order "${poData.po_number}" from ${poData.status} to ${newStatus}${newStatus === 'COMPLETED' ? ' (Stock Auto-Restocked)' : ''}`,
      details: `Previous Status: ${poData.status} | New Status: ${newStatus} | Auto-Stock Synchronized: ${inventoryUpdated}`,
      metadata: {
        poNumber: poData.po_number,
        previousStatus: poData.status,
        newStatus,
        inventoryUpdated
      },
      ipAddress: clientIp
    });

    await client.query('COMMIT');
    console.log(`[SECURITY AUDIT] PO status changed: ${poData.po_number} -> ${newStatus} by ${req.user!.username}`);
    res.json(mapPORow(updatedPO.rows[0]));
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Update PO status error:', error);
    res.status(500).json({ error: 'Failed to update PO status' });
  } finally {
    client.release();
  }
});

// DELETE /api/purchase-orders/:id (ADMIN & MANAGER)
router.delete('/purchase-orders/:id', requireAuth, requireRole('ADMIN', 'MANAGER'), validateRequest({ params: idParamSchema }), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await pool.query('SELECT po_number, supplier, qty_ordered, status FROM purchase_orders WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    const po = existing.rows[0];

    await pool.query('DELETE FROM purchase_orders WHERE id = $1', [id]);

    const clientIp = getClientIp(req);
    await recordActivityLog(pool, {
      eventType: 'PO_DELETED',
      module: 'PURCHASE_ORDERS',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorName: req.user!.fullName,
      actorRole: req.user!.role,
      targetId: id,
      targetName: po.po_number,
      actionSummary: `Deleted purchase order record "${po.po_number}" (${po.supplier || 'Supplier'})`,
      details: `PO Number: ${po.po_number} | Quantity: ${po.qty_ordered} | Status: ${po.status}`,
      metadata: { poNumber: po.po_number, supplier: po.supplier, status: po.status },
      ipAddress: clientIp
    });

    console.log(`[SECURITY AUDIT] Purchase order deleted: ${po.po_number} by admin ${req.user!.username}`);
    res.json({ success: true, id });
  } catch (error: any) {
    console.error('Delete PO error:', error);
    res.status(500).json({ error: 'Failed to delete purchase order' });
  }
});

// ==================== CATEGORIES ====================

// GET /api/categories (ADMIN, GUEST)
router.get('/categories', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM categories ORDER BY category_name ASC');
    res.json(result.rows.map(mapCategoryRow));
  } catch (error: any) {
    console.error('Fetch categories error:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// POST /api/categories (ADMIN & MANAGER)
router.post('/categories', requireAuth, requireRole('ADMIN', 'MANAGER'), validateRequest({ body: createCategorySchema }), async (req: Request, res: Response) => {
  try {
    const {
      categoryName,
      description,
      primarySupplier,
      reviewFrequency
    } = req.body;

    const cleanCatName = categoryName.trim();

    const existingCat = await pool.query(
      'SELECT id, category_name FROM categories WHERE LOWER(TRIM(category_name)) = LOWER($1)',
      [cleanCatName]
    );
    if (existingCat.rows.length > 0) {
      return res.status(409).json({
        error: `Category "${cleanCatName}" already exists. Please choose a unique name.`
      });
    }

    const id = `cat_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const createdBy = req.user?.username || 'system';

    const result = await pool.query(`
      INSERT INTO categories (
        id, category_name, description, primary_supplier, review_frequency, item_count, created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, 0, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *;
    `, [id, cleanCatName, description, primarySupplier, reviewFrequency, createdBy]);

    const clientIp = getClientIp(req);
    await recordActivityLog(pool, {
      eventType: 'CATEGORY_CREATED',
      module: 'CATEGORIES',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorName: req.user!.fullName,
      actorRole: req.user!.role,
      targetId: id,
      targetName: cleanCatName,
      actionSummary: `Created new material category "${cleanCatName}"`,
      details: `Description: ${description || 'N/A'} | Supplier: ${primarySupplier || 'N/A'} | Review: ${reviewFrequency || 'N/A'}`,
      metadata: { categoryName: cleanCatName, primarySupplier, reviewFrequency },
      ipAddress: clientIp
    });

    console.log(`[SECURITY AUDIT] Category created: ${cleanCatName} by ${req.user!.username}`);
    res.status(201).json(mapCategoryRow(result.rows[0]));
  } catch (error: any) {
    console.error('Add category error:', error);
    res.status(500).json({ error: 'Failed to add category' });
  }
});

// DELETE /api/categories/:id (ADMIN & MANAGER)
router.delete('/categories/:id', requireAuth, requireRole('ADMIN', 'MANAGER'), validateRequest({ params: idParamSchema }), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await pool.query('SELECT category_name FROM categories WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    const catName = existing.rows[0].category_name;

    await pool.query('DELETE FROM categories WHERE id = $1', [id]);

    const clientIp = getClientIp(req);
    await recordActivityLog(pool, {
      eventType: 'CATEGORY_DELETED',
      module: 'CATEGORIES',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorName: req.user!.fullName,
      actorRole: req.user!.role,
      targetId: id,
      targetName: catName,
      actionSummary: `Deleted inventory category "${catName}"`,
      details: `Category ID: ${id} | Name: ${catName}`,
      ipAddress: clientIp
    });

    console.log(`[SECURITY AUDIT] Category deleted: ${catName} by admin ${req.user!.username}`);
    res.json({ success: true, id });
  } catch (error: any) {
    console.error('Delete category error:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// ==================== IMMUTABLE AUDIT LEDGER ====================

// GET /api/audit-transactions (ADMIN, GUEST)
router.get('/audit-transactions', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT t.*, i.item_name, i.item_code 
      FROM inventory_transactions t
      LEFT JOIN inventory_items i ON t.item_id = i.id
      ORDER BY t.created_at DESC
      LIMIT 150
    `);
    res.json(result.rows);
  } catch (error: any) {
    console.error('Fetch audit transactions error:', error);
    res.status(500).json({ error: 'Failed to fetch audit transactions' });
  }
});

// ==================== ADMIN & MANAGER ACTIVITY LOGS ====================

// GET /api/activity-logs (ADMIN & MANAGER)
router.get('/activity-logs', requireAuth, requireRole('ADMIN', 'MANAGER'), async (req: Request, res: Response) => {
  try {
    const {
      module,
      eventType,
      actorUsername,
      search,
      startDate,
      endDate,
      limit = '100',
      offset = '0'
    } = req.query as Record<string, string>;

    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (module && module !== 'ALL') {
      conditions.push(`module = $${paramIndex++}`);
      values.push(module);
    }

    if (eventType && eventType !== 'ALL') {
      conditions.push(`event_type = $${paramIndex++}`);
      values.push(eventType);
    }

    if (actorUsername && actorUsername !== 'ALL') {
      conditions.push(`LOWER(actor_username) = LOWER($${paramIndex++})`);
      values.push(actorUsername);
    }

    if (startDate) {
      conditions.push(`created_at >= $${paramIndex++}`);
      values.push(new Date(startDate).toISOString());
    }

    if (endDate) {
      conditions.push(`created_at <= $${paramIndex++}`);
      // End of that day
      const endDateTime = new Date(endDate);
      endDateTime.setHours(23, 59, 59, 999);
      values.push(endDateTime.toISOString());
    }

    if (search && search.trim()) {
      const term = `%${search.trim().toLowerCase()}%`;
      conditions.push(`(
        LOWER(action_summary) LIKE $${paramIndex} OR
        LOWER(actor_username) LIKE $${paramIndex} OR
        LOWER(COALESCE(actor_name, '')) LIKE $${paramIndex} OR
        LOWER(COALESCE(target_name, '')) LIKE $${paramIndex} OR
        LOWER(COALESCE(details, '')) LIKE $${paramIndex}
      )`);
      values.push(term);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Total count for pagination
    const countSql = `SELECT COUNT(*)::int as total FROM activity_logs ${whereClause}`;
    const countRes = await pool.query(countSql, values);
    const total = countRes.rows[0]?.total || 0;

    // Fetch paginated logs
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 50), 300);
    const offsetNum = Math.max(0, parseInt(offset, 10) || 0);

    const querySql = `
      SELECT * FROM activity_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    const logsRes = await pool.query(querySql, [...values, limitNum, offsetNum]);

    res.json({
      logs: logsRes.rows.map(mapActivityLogRow),
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
        hasMore: offsetNum + limitNum < total
      }
    });
  } catch (error: any) {
    console.error('Fetch activity logs error:', error);
    res.status(500).json({ error: 'Failed to retrieve administrative activity logs' });
  }
});

// GET /api/activity-logs/stats (ADMIN & MANAGER)
router.get('/activity-logs/stats', requireAuth, requireRole('ADMIN', 'MANAGER'), async (req: Request, res: Response) => {
  try {
    // Breakdown by module
    const moduleCounts = await pool.query(`
      SELECT module, COUNT(*)::int as count 
      FROM activity_logs 
      GROUP BY module 
      ORDER BY count DESC
    `);

    // Top active actors
    const topActors = await pool.query(`
      SELECT actor_username, actor_name, actor_role, COUNT(*)::int as actions_count, MAX(created_at) as last_action_at
      FROM activity_logs
      GROUP BY actor_username, actor_name, actor_role
      ORDER BY actions_count DESC
      LIMIT 10
    `);

    // Recent 24h count
    const recent24h = await pool.query(`
      SELECT COUNT(*)::int as count
      FROM activity_logs
      WHERE created_at >= NOW() - INTERVAL '24 HOURS'
    `);

    // Total logs
    const totalCount = await pool.query('SELECT COUNT(*)::int as count FROM activity_logs');

    res.json({
      totalLogs: totalCount.rows[0]?.count || 0,
      actionsLast24h: recent24h.rows[0]?.count || 0,
      moduleBreakdown: moduleCounts.rows,
      topActors: topActors.rows
    });
  } catch (error: any) {
    console.error('Fetch activity stats error:', error);
    res.status(500).json({ error: 'Failed to load activity statistics' });
  }
});

// GET /api/activity-logs/retention-info (ADMIN & MANAGER)
router.get('/activity-logs/retention-info', requireAuth, requireRole('ADMIN', 'MANAGER'), async (req: Request, res: Response) => {
  try {
    const retentionDays = 90;
    
    // Check oldest log date
    const oldestRes = await pool.query(`
      SELECT MIN(created_at) as oldest_log_date
      FROM activity_logs
    `);

    // Count logs eligible for purge (>90 days old)
    const purgeEligibleRes = await pool.query(`
      SELECT COUNT(*)::int as count
      FROM activity_logs
      WHERE created_at < NOW() - ($1 || ' days')::INTERVAL
    `, [retentionDays]);

    // Count security logs eligible for purge
    const secPurgeEligibleRes = await pool.query(`
      SELECT COUNT(*)::int as count
      FROM security_audit_logs
      WHERE created_at < NOW() - ($1 || ' days')::INTERVAL
    `, [retentionDays]);

    res.json({
      retentionPolicyDays: retentionDays,
      autoDeleteEnabled: true,
      oldestLogDate: oldestRes.rows[0]?.oldest_log_date || null,
      activityLogsEligible: purgeEligibleRes.rows[0]?.count || 0,
      securityLogsEligible: secPurgeEligibleRes.rows[0]?.count || 0,
      policyDescription: 'Logs older than 90 days are automatically deleted on a 24-hour cycle to maintain optimal performance and storage efficiency.'
    });
  } catch (error: any) {
    console.error('Retention info error:', error);
    res.status(500).json({ error: 'Failed to check log retention information' });
  }
});

// POST /api/activity-logs/cleanup (ADMIN ONLY)
router.post('/activity-logs/cleanup', requireAuth, requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.body.retentionDays, 10) || 90;
    const result = await purgeOldLogs(pool, days);
    
    await recordActivityLog(pool, {
      eventType: 'SYSTEM_MAINTENANCE',
      module: 'USER_MANAGEMENT',
      actorId: req.user!.id,
      actorUsername: req.user!.username,
      actorName: req.user!.fullName,
      actorRole: req.user!.role,
      targetId: 'LOG_PURGE',
      targetName: `${days}-Day Log Retention Purge`,
      actionSummary: `Executed automatic log retention cleanup (Purged ${result.activityLogsDeleted} activity logs and ${result.securityLogsDeleted} security audit logs older than ${days} days)`,
      details: `Purge threshold: ${days} days. Total records cleaned: ${result.activityLogsDeleted + result.securityLogsDeleted}.`,
      ipAddress: getClientIp(req)
    });

    res.json({
      success: true,
      message: `Successfully cleaned up records older than ${days} days.`,
      ...result
    });
  } catch (error: any) {
    console.error('Manual log cleanup error:', error);
    res.status(500).json({ error: 'Failed to execute log cleanup process' });
  }
});

export default router;
