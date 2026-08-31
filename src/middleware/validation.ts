import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { sanitizeText, sanitizeMultiline, isSafeDateString } from '../lib/sanitize';

// Middleware generator for Zod request validation
export function validateRequest(schema: {
  body?: z.ZodSchema<any>;
  query?: z.ZodSchema<any>;
  params?: z.ZodSchema<any>;
}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schema.body) {
        req.body = await schema.body.parseAsync(req.body);
      }
      if (schema.query) {
        req.query = await schema.query.parseAsync(req.query) as any;
      }
      if (schema.params) {
        req.params = await schema.params.parseAsync(req.params) as any;
      }
      next();
    } catch (error: any) {
      if (error instanceof z.ZodError || error?.issues || error?.errors) {
        const issues: any[] = error.issues || error.errors || [];
        const errorMessages = issues.map((err: any) => `${err.path?.join('.') || 'field'}: ${err.message}`).join(', ');
        return res.status(400).json({
          error: `Validation error: ${errorMessages || 'Invalid payload'}`,
          details: issues.map((err: any) => ({
            path: err.path,
            message: err.message
          }))
        });
      }
      return res.status(400).json({ error: 'Malformed request payload.' });
    }
  };
}

const sanitized = (max: number, min = 1) =>
  z.string().trim().min(min, 'This field is required').max(max).transform(sanitizeText);

const sanitizedOptional = (max: number) =>
  z.string().trim().max(max).nullish().transform(v => sanitizeText(v ?? ''));

const sanitizedNotes = (max = 2000) =>
  z.string().max(max).nullish().transform(v => sanitizeMultiline(v ?? ''));

const optionalDateField = z
  .string()
  .trim()
  .max(100)
  .nullish()
  .transform(v => v ?? '')
  .refine(v => isSafeDateString(v), { message: 'Invalid date format' });

// Common ID Param validation (alphanumeric, underscores, hyphens)
export const idParamSchema = z.object({
  id: z.string().trim().min(1, 'Resource ID is required').max(100).regex(/^[a-zA-Z0-9_\-\.]+$/, 'Invalid ID format')
});

// Auth Login Schema
export const loginSchema = z.object({
  username: z.string().trim().min(2, 'Username is required').max(255).transform(sanitizeText),
  password: z.string().min(1, 'Password is required').max(255)
});

export const supabaseSyncSchema = z.object({
  accessToken: z.string().min(20).max(8192).optional(),
  user: z.object({
    id: z.string().max(64).optional(),
    email: z.string().max(255).optional(),
    user_metadata: z.record(z.string(), z.unknown()).optional()
  }).passthrough().optional()
});

// Change Password Schema (for first-login or self password reset)
export const changePasswordSchema = z.object({
  currentPassword: z.string().max(255).optional(),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .max(128, 'Password must not exceed 128 characters')
    .regex(/[A-Za-z]/, 'Password must contain at least one letter')
    .regex(/\d/, 'Password must contain at least one number')
});

// User Management Schemas (Admin only)
export const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters')
    .max(100)
    .regex(/^[a-zA-Z0-9._@+-]+$/, 'Username contains invalid characters')
    .transform(v => sanitizeText(v).toLowerCase()),
  role: z.enum(['ADMIN', 'MANAGER', 'GUEST', 'VIEWER']),
  fullName: sanitized(255)
});

export const updateUserRoleSchema = z.object({
  role: z.enum(['ADMIN', 'MANAGER', 'GUEST', 'VIEWER']),
  fullName: z.string().trim().min(1).max(255).transform(sanitizeText).optional()
});

export const updateUserStatusSchema = z.object({
  isActive: z.boolean()
});


// Inventory Item Schemas
export const createInventoryItemSchema = z.object({
  itemCode: sanitized(100),
  itemName: sanitized(255),
  category: sanitized(255),
  unitOfMeasure: sanitized(100),
  minStockLevel: z.coerce.number().min(0, 'Minimum stock must be >= 0').max(1000000).default(0),
  maxStockLevel: z.coerce.number().min(1, 'Maximum stock must be >= 1').max(10000000).optional().default(1000),
  quantity: z.coerce.number().min(0, 'Quantity must be >= 0').max(10000000).optional(),
  reorderQty: z.coerce.number().min(0).max(1000000).optional(),
  currentStock: z.coerce.number().min(0).max(10000000).optional(),
  unitCost: z.coerce.number().min(0, 'Unit cost must be >= 0').max(10000000).default(0),
  supplier: sanitizedOptional(255),
  dateReceived: optionalDateField,
  lastRestocked: optionalDateField,
  nextReviewDate: optionalDateField,
  notes: sanitizedNotes(2000)
});

export const updateInventoryItemSchema = z.object({
  itemCode: z.string().trim().min(1).max(100).transform(sanitizeText).optional(),
  itemName: z.string().trim().min(1).max(255).transform(sanitizeText).optional(),
  category: z.string().trim().min(1).max(255).transform(sanitizeText).optional(),
  unitOfMeasure: z.string().trim().min(1).max(100).transform(sanitizeText).optional(),
  minStockLevel: z.coerce.number().min(0).max(1000000).optional(),
  maxStockLevel: z.coerce.number().min(1).max(10000000).optional(),
  quantity: z.coerce.number().min(0).max(10000000).optional(),
  reorderQty: z.coerce.number().min(0).max(1000000).optional(),
  currentStock: z.coerce.number().min(0).max(10000000).optional(),
  unitCost: z.coerce.number().min(0).max(10000000).optional(),
  supplier: sanitizedOptional(255),
  dateReceived: optionalDateField,
  lastRestocked: optionalDateField,
  nextReviewDate: optionalDateField,
  notes: z.string().trim().min(1, 'Notes are required when editing an inventory item (please provide a reason for the edit)').max(2000).transform(sanitizeMultiline)
});

// Stock Movement Schema
export const createStockMovementSchema = z.object({
  movementCode: z.string().trim().max(100).transform(sanitizeText).optional(),
  movementType: z.enum(['ISSUED_OUT', 'RESTOCKED', 'ADJUSTMENT']),
  itemId: z.string().trim().max(100).regex(/^[a-zA-Z0-9_\-\.]*$/).optional(),
  itemCode: z.string().trim().max(100).transform(sanitizeText).optional(),
  itemName: z.string().trim().max(255).transform(sanitizeText).optional(),
  category: z.string().trim().max(255).transform(sanitizeText).optional(),
  quantity: z.coerce.number().int('Quantity must be an integer').positive('Quantity must be greater than 0').max(1000000),
  unitOfMeasure: z.string().trim().max(100).nullish().transform(v => sanitizeText(v ?? 'Units') || 'Units'),
  recipient: sanitizedOptional(255),
  issuedBy: sanitizedOptional(255),
  date: z.string().trim().max(100).nullish().transform(v => v || new Date().toISOString().split('T')[0]).refine(v => isSafeDateString(v), { message: 'Invalid date format' }),
  notes: sanitizedNotes(2000)
});

// Purchase Order Schemas — status on create is always forced to PENDING server-side
export const createPOSchema = z.object({
  poNumber: sanitized(100),
  itemId: z.string().trim().max(100).regex(/^[a-zA-Z0-9_\-\.]*$/).optional(),
  itemCode: sanitized(100),
  itemName: sanitized(255),
  supplier: sanitizedOptional(255),
  qtyOrdered: z.coerce.number().int('Quantity must be an integer').positive('Ordered quantity must be greater than 0').max(1000000),
  unitCost: z.coerce.number().min(0, 'Unit cost must be >= 0').max(10000000).default(0),
  orderDate: z.string().trim().max(100).nullish().transform(v => v || new Date().toISOString().split('T')[0]).refine(v => isSafeDateString(v), { message: 'Invalid date format' }),
  expectedDate: optionalDateField,
  status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED']).optional(),
  notes: sanitizedNotes(2000)
});

export const updatePOStatusSchema = z.object({
  status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED'])
});

// Category Schema
export const createCategorySchema = z.object({
  categoryName: sanitized(255),
  description: sanitizedOptional(1000),
  primarySupplier: sanitizedOptional(255),
  reviewFrequency: sanitizedOptional(100)
});

export const activityLogsQuerySchema = z.object({
  module: z.string().trim().max(50).optional(),
  eventType: z.string().trim().max(64).optional(),
  actorUsername: z.string().trim().max(255).optional(),
  search: z.string().trim().max(200).optional(),
  startDate: z.string().trim().max(40).optional(),
  endDate: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(300).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional()
});

export const cleanupLogsSchema = z.object({
  retentionDays: z.coerce.number().int().min(7).max(3650).optional().default(90)
});
