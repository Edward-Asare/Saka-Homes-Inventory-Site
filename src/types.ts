export interface InventoryItem {
  id: string;
  itemCode: string; // SKH-001
  itemName: string; // Portland Cement
  category: string; // Cement & concrete
  unitOfMeasure: string; // Boxes
  minStockLevel: number; // 50
  maxStockLevel: number; // 50,000
  reorderQty: number; // Quantity
  currentStock?: number; // Available quantity
  quantity?: number;
  unitCost: number; // 45.00
  totalValue: number; // 5,400.00
  status: 'IN STOCK' | 'LOW STOCK' | 'OUT OF STOCK';
  supplier: string; // RoofMaster Ltd
  dateReceived?: string; // Date received
  lastRestocked: string; // Date received / restocked (YYYY-MM-DD)
  nextReviewDate: string; // 18-May-2026
  notes: string;
  createdBy: string;
  createdAt: any;
  updatedAt: any;
}

export interface StockMovement {
  id: string;
  movementCode: string; // e.g. MOV-2026-001
  movementType: 'ISSUED_OUT' | 'RESTOCKED' | 'ADJUSTMENT';
  itemId: string;
  itemCode: string;
  itemName: string;
  category: string;
  quantity: number;
  unitOfMeasure?: string;
  previousStock: number;
  newStock: number;
  recipient: string; // e.g. Site A - West Wing, Site Manager John
  issuedBy: string; // User/Issuer Name
  date: string; // 2026-05-07
  notes: string;
  createdBy: string;
  createdAt: any;
  updatedAt: any;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  itemId?: string;
  itemCode: string;
  itemName: string;
  supplier: string;
  qtyOrdered: number;
  unitCost: number;
  totalCost: number;
  orderDate: string;
  expectedDate: string;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED';
  inventoryUpdated?: boolean;
  notes: string;
  createdBy: string;
  createdAt: any;
  updatedAt: any;
}

export interface Category {
  id: string;
  categoryName: string;
  description: string;
  primarySupplier: string;
  reviewFrequency: string;
  itemCount: number;
  createdBy: string;
  createdAt: any;
  updatedAt: any;
}

export type View = 'dashboard' | 'inventory' | 'orders' | 'purchase-orders' | 'categories' | 'stock-movements' | 'reports' | 'users' | 'activity-logs';

export type UserRole = 'ADMIN' | 'MANAGER' | 'GUEST' | 'VIEWER';

export interface AppUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  isActive?: boolean;
  mustChangePassword?: boolean;
  token?: string;
  createdAt?: any;
  updatedAt?: any;
  lastLoginAt?: any;
}

export interface SecurityAuditLog {
  id: string;
  eventType: 'USER_CREATED' | 'USER_DEACTIVATED' | 'USER_ACTIVATED' | 'USER_DELETED' | 'ROLE_CHANGED' | 'PASSWORD_RESET' | 'PASSWORD_CHANGED' | 'LOGIN_SUCCESS' | 'LOGIN_FAILURE';
  actorId?: string;
  actorUsername?: string;
  targetUserId?: string;
  targetUsername?: string;
  details?: string;
  ipAddress?: string;
  createdAt: any;
}

export type ActivityModule = 'INVENTORY' | 'STOCK_MOVEMENTS' | 'PURCHASE_ORDERS' | 'CATEGORIES' | 'USER_MANAGEMENT' | 'AUTHENTICATION';

export type ActivityEventType = 
  | 'INVENTORY_CREATED'
  | 'INVENTORY_UPDATED'
  | 'INVENTORY_DELETED'
  | 'STOCK_DISPATCHED'
  | 'STOCK_RESTOCKED'
  | 'STOCK_ADJUSTED'
  | 'STOCK_MOVEMENT_DELETED'
  | 'PO_CREATED'
  | 'PO_STATUS_CHANGED'
  | 'PO_DELETED'
  | 'CATEGORY_CREATED'
  | 'CATEGORY_DELETED'
  | 'USER_CREATED'
  | 'USER_DELETED'
  | 'USER_ROLE_CHANGED'
  | 'USER_STATUS_CHANGED'
  | 'USER_PASSWORD_RESET'
  | 'USER_PASSWORD_CHANGED'
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE';

export interface ActivityLog {
  id: string;
  eventType: ActivityEventType;
  module: ActivityModule;
  actorId?: string;
  actorUsername: string;
  actorName?: string;
  actorRole: UserRole;
  targetId?: string;
  targetName?: string;
  actionSummary: string;
  details?: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  createdAt: any;
}

