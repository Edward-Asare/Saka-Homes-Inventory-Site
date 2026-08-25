import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

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
          details: issues
        });
      }
      return res.status(400).json({ error: 'Malformed request payload.' });
    }
  };
}

// Common ID Param validation (alphanumeric, underscores, hyphens)
export const idParamSchema = z.object({
  id: z.string().trim().min(1, 'Resource ID is required').max(100).regex(/^[a-zA-Z0-9_\-\.]+$/, 'Invalid ID format')
});

// Auth Login Schema
export const loginSchema = z.object({
  username: z.string().trim().min(2, 'Username is required').max(255),
  password: z.string().min(1, 'Password is required').max(255)
});

// Change Password Schema (for first-login or self password reset)
export const changePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .max(128, 'Password must not exceed 128 characters')
    .regex(/[A-Za-z]/, 'Password must contain at least one letter')
    .regex(/\d/, 'Password must contain at least one number')
});

// User Management Schemas (Admin only)
export const createUserSchema = z.object({
  username: z.string().trim().min(3, 'Username must be at least 3 characters').max(100),
  role: z.enum(['ADMIN', 'MANAGER', 'GUEST', 'VIEWER']),
  fullName: z.string().trim().min(1, 'Full name is required').max(255)
});

export const updateUserRoleSchema = z.object({
  role: z.enum(['ADMIN', 'MANAGER', 'GUEST', 'VIEWER']),
  fullName: z.string().trim().min(1).max(255).optional()
});

export const updateUserStatusSchema = z.object({
  isActive: z.boolean()
});


// Inventory Item Schemas
export const createInventoryItemSchema = z.object({
  itemCode: z.string().trim().min(1, 'Item Code is required').max(100),
  itemName: z.string().trim().min(1, 'Item Name is required').max(255),
  category: z.string().trim().min(1, 'Category is required').max(255),
  unitOfMeasure: z.string().trim().min(1, 'Unit of Measure is required').max(100),
  minStockLevel: z.coerce.number().min(0, 'Minimum stock must be >= 0').max(1000000).default(0),
  maxStockLevel: z.coerce.number().min(1, 'Maximum stock must be >= 1').max(10000000).optional().default(1000),
  quantity: z.coerce.number().min(0, 'Quantity must be >= 0').max(10000000).optional(),
  reorderQty: z.coerce.number().min(0).max(1000000).optional(),
  currentStock: z.coerce.number().min(0).max(10000000).optional(),
  unitCost: z.coerce.number().min(0, 'Unit cost must be >= 0').max(10000000).default(0),
  supplier: z.string().trim().max(255).nullish().transform(v => v ?? ''),
  dateReceived: z.string().trim().max(100).nullish().transform(v => v ?? ''),
  lastRestocked: z.string().trim().max(100).nullish().transform(v => v ?? ''),
  nextReviewDate: z.string().trim().max(100).nullish().transform(v => v ?? ''),
  notes: z.string().max(2000).nullish().transform(v => v ?? '')
});

export const updateInventoryItemSchema = z.object({
  itemCode: z.string().trim().min(1).max(100).optional(),
  itemName: z.string().trim().min(1).max(255).optional(),
  category: z.string().trim().min(1).max(255).optional(),
  unitOfMeasure: z.string().trim().min(1).max(100).optional(),
  minStockLevel: z.coerce.number().min(0).max(1000000).optional(),
  maxStockLevel: z.coerce.number().min(1).max(10000000).optional(),
  quantity: z.coerce.number().min(0).max(10000000).optional(),
  reorderQty: z.coerce.number().min(0).max(1000000).optional(),
  currentStock: z.coerce.number().min(0).max(10000000).optional(),
  unitCost: z.coerce.number().min(0).max(10000000).optional(),
  status: z.enum(['IN STOCK', 'LOW STOCK', 'OUT OF STOCK']).optional(),
  supplier: z.string().trim().max(255).nullish().transform(v => v ?? ''),
  dateReceived: z.string().trim().max(100).nullish().transform(v => v ?? ''),
  lastRestocked: z.string().trim().max(100).nullish().transform(v => v ?? ''),
  nextReviewDate: z.string().trim().max(100).nullish().transform(v => v ?? ''),
  notes: z.string().trim().min(1, 'Notes are required when editing an inventory item (please provide a reason for the edit)').max(2000)
});

// Stock Movement Schema
export const createStockMovementSchema = z.object({
  movementCode: z.string().trim().max(100).optional(),
  movementType: z.enum(['ISSUED_OUT', 'RESTOCKED', 'ADJUSTMENT']),
  itemId: z.string().trim().max(100).optional(),
  itemCode: z.string().trim().max(100).optional(),
  itemName: z.string().trim().max(255).optional(),
  category: z.string().trim().max(255).optional(),
  quantity: z.coerce.number().int('Quantity must be an integer').positive('Quantity must be greater than 0').max(1000000),
  unitOfMeasure: z.string().trim().max(100).nullish().transform(v => v ?? 'Units'),
  recipient: z.string().trim().max(255).nullish().transform(v => v ?? ''),
  issuedBy: z.string().trim().max(255).nullish().transform(v => v ?? ''),
  date: z.string().trim().max(100).nullish().transform(v => v || new Date().toISOString().split('T')[0]),
  notes: z.string().max(2000).nullish().transform(v => v ?? '')
});

// Purchase Order Schemas
export const createPOSchema = z.object({
  poNumber: z.string().trim().min(1, 'PO Number is required').max(100),
  itemId: z.string().trim().max(100).optional(),
  itemCode: z.string().trim().min(1, 'Item Code is required').max(100),
  itemName: z.string().trim().min(1, 'Item Name is required').max(255),
  supplier: z.string().trim().max(255).nullish().transform(v => v ?? ''),
  qtyOrdered: z.coerce.number().int('Quantity must be an integer').positive('Ordered quantity must be greater than 0').max(1000000),
  unitCost: z.coerce.number().min(0, 'Unit cost must be >= 0').max(10000000).default(0),
  orderDate: z.string().trim().max(100).nullish().transform(v => v || new Date().toISOString().split('T')[0]),
  expectedDate: z.string().trim().max(100).nullish().transform(v => v ?? ''),
  status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED']).default('PENDING'),
  notes: z.string().max(2000).nullish().transform(v => v ?? '')
});

export const updatePOStatusSchema = z.object({
  status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED'])
});

// Category Schema
export const createCategorySchema = z.object({
  categoryName: z.string().trim().min(1, 'Category name is required').max(255),
  description: z.string().trim().max(1000).nullish().transform(v => v ?? ''),
  primarySupplier: z.string().trim().max(255).nullish().transform(v => v ?? ''),
  reviewFrequency: z.string().trim().max(100).nullish().transform(v => v ?? '')
});
