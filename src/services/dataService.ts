import { InventoryItem, PurchaseOrder, Category, StockMovement, AppUser, SecurityAuditLog, ActivityLog } from '../types';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

export function getStoredAuthToken(): string | null {
  try {
    return localStorage.getItem('saka_auth_token');
  } catch {
    return null;
  }
}

export function getStoredUser(): AppUser | null {
  try {
    const stored = localStorage.getItem('saka_app_user');
    if (stored) {
      return JSON.parse(stored) as AppUser;
    }
  } catch {}
  return null;
}

export const authService = {
  login: async (username: string, password: string): Promise<AppUser> => {
    const trimmed = username.trim();

    // If Supabase is configured and the user entered an email, try Supabase Auth first
    if (supabase && isSupabaseConfigured && trimmed.includes('@') && !trimmed.endsWith('@sakainventory')) {
      try {
        return await authService.loginWithSupabase(trimmed, password);
      } catch (supabaseErr: any) {
        const msg = (supabaseErr.message || '').toLowerCase();
        // If Supabase Auth gave an explicit failure like email unconfirmed or bad password, don't silently swallow
        if (msg.includes('email not confirmed')) {
          throw supabaseErr;
        }
        // If credentials failed on Supabase, still attempt fallback to local database
      }
    }

    const res = await fetchApi<{ success: boolean; token: string; user: AppUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: trimmed, password }),
    });
    
    if (res.token) {
      localStorage.setItem('saka_auth_token', res.token);
    }
    if (res.user) {
      localStorage.setItem('saka_app_user', JSON.stringify(res.user));
    }
    return res.user;
  },

  changePassword: async (newPassword: string, currentPassword?: string): Promise<{ success: boolean; message: string; user: AppUser; token: string }> => {
    const res = await fetchApi<{ success: boolean; message: string; user: AppUser; token: string }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ newPassword, currentPassword }),
    });

    if (res.token) {
      localStorage.setItem('saka_auth_token', res.token);
    }
    if (res.user) {
      localStorage.setItem('saka_app_user', JSON.stringify(res.user));
    }
    return res;
  },

  getCurrentUser: (): AppUser | null => {
    return getStoredUser();
  },

  verifySession: async (): Promise<AppUser | null> => {
    const token = getStoredAuthToken();
    if (!token) return null;
    try {
      const user = await fetchApi<AppUser>('/api/auth/me');
      localStorage.setItem('saka_app_user', JSON.stringify(user));
      return user;
    } catch {
      authService.logout();
      return null;
    }
  },

  logout: async () => {
    try {
      if (supabase && isSupabaseConfigured) {
        await supabase.auth.signOut();
      }
    } catch (e) {
      console.warn('Supabase signOut notice:', e);
    }
    localStorage.removeItem('saka_auth_token');
    localStorage.removeItem('saka_app_user');
    localStorage.removeItem('saka_last_activity_timestamp');
    window.dispatchEvent(new CustomEvent('saka:logout'));
  },

  loginWithSupabase: async (email: string, password: string): Promise<AppUser> => {
    if (!supabase || !isSupabaseConfigured) {
      throw new Error('Supabase is not configured yet. Please configure valid VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Settings or .env file.');
    }
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        const lowerMsg = (error.message || '').toLowerCase();
        if (lowerMsg.includes('invalid login credentials')) {
          throw new Error('Invalid login credentials. Please verify your email and password, and ensure this user exists in your Supabase Authentication dashboard.');
        }
        if (lowerMsg.includes('email not confirmed')) {
          throw new Error('Email not confirmed in Supabase. Please confirm your email address or disable "Confirm email" in your Supabase Authentication dashboard (Authentication -> Providers -> Email).');
        }
        throw new Error(error.message || 'Supabase authentication failed.');
      }
      if (!data.session) {
        throw new Error('No active session returned from Supabase Auth.');
      }

      const token = data.session.access_token;
      localStorage.setItem('saka_auth_token', token);

      // Synchronize session with backend to register/retrieve local PostgreSQL profile
      const syncRes = await fetchApi<{ success: boolean; user: AppUser; token?: string }>('/api/auth/supabase-sync', {
        method: 'POST',
        body: JSON.stringify({
          accessToken: token,
          user: data.user
        })
      });

      const user = syncRes.user;
      if (syncRes.token) {
        localStorage.setItem('saka_auth_token', syncRes.token);
      }
      localStorage.setItem('saka_app_user', JSON.stringify(user));
      return user;
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes('Invalid path') || msg.includes('Failed to construct') || msg.includes('fetch')) {
        throw new Error('Could not connect to Supabase. Please verify that your VITE_SUPABASE_URL is in the format "https://your-project-id.supabase.co" without trailing slashes or subpaths.');
      }
      throw err;
    }
  },

  getUsers: async (): Promise<AppUser[]> => {
    return await fetchApi<AppUser[]>('/api/users');
  },

  createUser: async (user: { username: string; role: string; fullName: string }): Promise<{ user: AppUser; temporaryPassword: string; message: string }> => {
    return await fetchApi<{ user: AppUser; temporaryPassword: string; message: string }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(user),
    });
  },

  updateUserRole: async (id: string, role: string, fullName?: string): Promise<AppUser> => {
    return await fetchApi<AppUser>(`/api/users/${id}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role, fullName }),
    });
  },

  updateUserStatus: async (id: string, isActive: boolean): Promise<AppUser> => {
    return await fetchApi<AppUser>(`/api/users/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    });
  },

  resetUserPassword: async (id: string): Promise<{ success: boolean; temporaryPassword: string; message: string }> => {
    return await fetchApi<{ success: boolean; temporaryPassword: string; message: string }>(`/api/users/${id}/reset-password`, {
      method: 'POST',
    });
  },

  deleteUser: async (id: string): Promise<{ success: boolean; message: string }> => {
    return await fetchApi<{ success: boolean; message: string }>(`/api/users/${id}`, {
      method: 'DELETE',
    });
  },

  getAuditLogs: async (): Promise<SecurityAuditLog[]> => {
    return await fetchApi<SecurityAuditLog[]>('/api/users/audit-logs');
  }
};


async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const token = getStoredAuthToken();
  const existingHeaders = options?.headers || {};

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(existingHeaders as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else if (endpoint !== '/api/auth/login' && endpoint !== '/api/health') {
    // If no token exists and requesting a protected endpoint, throw informative auth error
    throw new Error('Authentication required. Please sign in with your credentials.');
  }

  const res = await fetch(endpoint, {
    ...options,
    headers,
  });

  const contentType = res.headers.get('content-type');
  
  if (!res.ok) {
    let errMsg = `API Request failed (${res.status})`;
    if (contentType && contentType.includes('application/json')) {
      try {
        const errData = await res.json();
        errMsg = errData.error || errData.message || errMsg;
      } catch {}
    } else {
      const text = await res.text();
      errMsg = `Server error (${res.status}): ${text.substring(0, 100)}`;
    }

    if (res.status === 401) {
      if (endpoint === '/api/auth/login' || endpoint === '/api/auth/supabase-sync') {
        errMsg = errMsg || 'Unauthorized (401): Invalid username or password. If you created this user in your Supabase Dashboard, please check your credentials and ensure the user email is verified.';
      } else {
        authService.logout();
        const sessionErrMsg = errMsg || 'Session expired or unauthorized (401). Please sign in again.';
        window.dispatchEvent(new CustomEvent('saka:auth_expired', { detail: { message: sessionErrMsg } }));
        throw new Error(sessionErrMsg);
      }
    } else if (res.status === 403) {
      window.dispatchEvent(new CustomEvent('saka:access_denied', { detail: { message: errMsg } }));
    }

    throw new Error(errMsg);
  }

  if (!contentType || !contentType.includes('application/json')) {
    const text = await res.text();
    throw new Error(`Expected JSON response from ${endpoint}, but received: ${text.substring(0, 100)}`);
  }

  return res.json();
}

export const inventoryService = {
  subscribe: (callback: (items: InventoryItem[]) => void) => {
    let isCancelled = false;

    const fetchInventory = async () => {
      const token = getStoredAuthToken();
      if (!token) return; // Do not fetch if user has not authenticated yet

      try {
        const items = await fetchApi<InventoryItem[]>('/api/inventory');
        if (!isCancelled) {
          callback(items);
        }
      } catch (err: any) {
        if (!err?.message?.includes('Authentication required')) {
          console.warn('Notice fetching inventory:', err?.message || err);
        }
      }
    };

    fetchInventory();
    const interval = setInterval(fetchInventory, 4000);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  },

  addItem: async (item: Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>) => {
    const created = await fetchApi<InventoryItem>('/api/inventory', {
      method: 'POST',
      body: JSON.stringify(item),
    });
    return created.id;
  },

  updateItem: async (id: string, item: Partial<InventoryItem>) => {
    await fetchApi<InventoryItem>(`/api/inventory/${id}`, {
      method: 'PUT',
      body: JSON.stringify(item),
    });
  },

  deleteItem: async (id: string) => {
    await fetchApi<{ success: boolean; id: string }>(`/api/inventory/${id}`, {
      method: 'DELETE',
    });
  }
};

export const stockMovementService = {
  subscribe: (callback: (movements: StockMovement[]) => void) => {
    let isCancelled = false;

    const fetchMovements = async () => {
      const token = getStoredAuthToken();
      if (!token) return;

      try {
        const movements = await fetchApi<StockMovement[]>('/api/stock-movements');
        if (!isCancelled) {
          callback(movements);
        }
      } catch (err: any) {
        if (!err?.message?.includes('Authentication required')) {
          console.warn('Notice fetching stock movements:', err?.message || err);
        }
      }
    };

    fetchMovements();
    const interval = setInterval(fetchMovements, 4000);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  },

  addMovement: async (movement: Omit<StockMovement, 'id' | 'createdAt' | 'updatedAt'>) => {
    const created = await fetchApi<StockMovement>('/api/stock-movements', {
      method: 'POST',
      body: JSON.stringify(movement),
    });
    return created.id;
  },

  deleteMovement: async (id: string) => {
    await fetchApi<{ success: boolean; id: string }>(`/api/stock-movements/${id}`, {
      method: 'DELETE',
    });
  }
};

export const poService = {
  subscribe: (callback: (pos: PurchaseOrder[]) => void) => {
    let isCancelled = false;

    const fetchPOs = async () => {
      const token = getStoredAuthToken();
      if (!token) return;

      try {
        const pos = await fetchApi<PurchaseOrder[]>('/api/purchase-orders');
        if (!isCancelled) {
          callback(pos);
        }
      } catch (err: any) {
        if (!err?.message?.includes('Authentication required')) {
          console.warn('Notice fetching purchase orders:', err?.message || err);
        }
      }
    };

    fetchPOs();
    const interval = setInterval(fetchPOs, 4000);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  },

  addPO: async (po: Omit<PurchaseOrder, 'id' | 'createdAt' | 'updatedAt'>) => {
    const created = await fetchApi<PurchaseOrder>('/api/purchase-orders', {
      method: 'POST',
      body: JSON.stringify(po),
    });
    return created.id;
  },

  updatePOStatus: async (id: string, newStatus: PurchaseOrder['status']) => {
    await fetchApi<PurchaseOrder>(`/api/purchase-orders/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus }),
    });
  },

  deletePO: async (id: string) => {
    await fetchApi<{ success: boolean; id: string }>(`/api/purchase-orders/${id}`, {
      method: 'DELETE',
    });
  }
};

export const categoryService = {
  subscribe: (callback: (categories: Category[]) => void) => {
    let isCancelled = false;

    const fetchCategories = async () => {
      const token = getStoredAuthToken();
      if (!token) return;

      try {
        const categories = await fetchApi<Category[]>('/api/categories');
        if (!isCancelled) {
          callback(categories);
        }
      } catch (err: any) {
        if (!err?.message?.includes('Authentication required')) {
          console.warn('Notice fetching categories:', err?.message || err);
        }
      }
    };

    fetchCategories();
    const interval = setInterval(fetchCategories, 4000);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  },

  addCategory: async (category: Omit<Category, 'id' | 'createdAt' | 'updatedAt' | 'itemCount'>) => {
    const created = await fetchApi<Category>('/api/categories', {
      method: 'POST',
      body: JSON.stringify(category),
    });
    return created.id;
  },

  deleteCategory: async (id: string) => {
    await fetchApi<{ success: boolean; id: string }>(`/api/categories/${id}`, {
      method: 'DELETE',
    });
  },

  syncItemCount: async (categoryName: string) => {
    // Handled automatically on backend
  }
};

export interface ActivityLogFilters {
  module?: string;
  eventType?: string;
  actorUsername?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export interface ActivityStatsResponse {
  totalLogs: number;
  actionsLast24h: number;
  moduleBreakdown: { module: string; count: number }[];
  topActors: {
    actor_username: string;
    actor_name: string;
    actor_role: string;
    actions_count: number;
    last_action_at: string;
  }[];
}

export interface ActivityRetentionInfo {
  retentionPolicyDays: number;
  autoDeleteEnabled: boolean;
  oldestLogDate: string | null;
  activityLogsEligible: number;
  securityLogsEligible: number;
  policyDescription: string;
}

export const activityLogService = {
  getLogs: async (filters: ActivityLogFilters = {}): Promise<{
    logs: ActivityLog[];
    pagination: { total: number; limit: number; offset: number; hasMore: boolean };
  }> => {
    const params = new URLSearchParams();
    if (filters.module && filters.module !== 'ALL') params.append('module', filters.module);
    if (filters.eventType && filters.eventType !== 'ALL') params.append('eventType', filters.eventType);
    if (filters.actorUsername && filters.actorUsername !== 'ALL') params.append('actorUsername', filters.actorUsername);
    if (filters.search) params.append('search', filters.search);
    if (filters.startDate) params.append('startDate', filters.startDate);
    if (filters.endDate) params.append('endDate', filters.endDate);
    if (filters.limit) params.append('limit', String(filters.limit));
    if (filters.offset !== undefined) params.append('offset', String(filters.offset));

    const queryString = params.toString() ? `?${params.toString()}` : '';
    return await fetchApi<{
      logs: ActivityLog[];
      pagination: { total: number; limit: number; offset: number; hasMore: boolean };
    }>(`/api/activity-logs${queryString}`);
  },

  getStats: async (): Promise<ActivityStatsResponse> => {
    return await fetchApi<ActivityStatsResponse>('/api/activity-logs/stats');
  },

  getRetentionInfo: async (): Promise<ActivityRetentionInfo> => {
    return await fetchApi<ActivityRetentionInfo>('/api/activity-logs/retention-info');
  },

  cleanupOldLogs: async (retentionDays: number = 90): Promise<{
    success: boolean;
    activityLogsDeleted: number;
    securityLogsDeleted: number;
    retentionDays: number;
    message: string;
  }> => {
    return await fetchApi<{
      success: boolean;
      activityLogsDeleted: number;
      securityLogsDeleted: number;
      retentionDays: number;
      message: string;
    }>('/api/activity-logs/cleanup', {
      method: 'POST',
      body: JSON.stringify({ retentionDays })
    });
  }
};
