import { createClient, SupabaseClient } from '@supabase/supabase-js';

function sanitizeUrl(rawUrl?: string): string {
  if (!rawUrl) return '';
  let cleaned = String(rawUrl).trim().replace(/^["']|["']$/g, '');
  if (!cleaned) return '';
  
  // Ensure protocol
  if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
    cleaned = `https://${cleaned}`;
  }

  try {
    const parsed = new URL(cleaned);
    // Ignore placeholder domain names
    if (
      parsed.hostname === 'your-project-id.supabase.co' ||
      parsed.hostname === 'yourprojectid.supabase.co' ||
      parsed.hostname === 'example.com' ||
      parsed.hostname.includes('your-project')
    ) {
      return '';
    }
    // Return origin only (e.g. https://abcdefgh.supabase.co) to avoid nested path issues in GoTrue
    return parsed.origin;
  } catch {
    return '';
  }
}

function sanitizeKey(rawKey?: string): string {
  if (!rawKey) return '';
  const cleaned = String(rawKey).trim().replace(/^["']|["']$/g, '');
  if (
    !cleaned ||
    cleaned.startsWith('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...') ||
    cleaned.includes('replace_with')
  ) {
    return '';
  }
  return cleaned;
}

const rawSupabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';
const rawSupabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

const supabaseUrl = sanitizeUrl(rawSupabaseUrl);
const supabaseAnonKey = sanitizeKey(rawSupabaseAnonKey);

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    })
  : null;
