/**
 * CORS origin resolution. Production never reflects arbitrary origins.
 */
export function resolveCorsOriginOption(
  isProduction: boolean,
  corsOriginEnv: string
): boolean | string[] {
  const corsOrigins = (corsOriginEnv || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const explicit = corsOrigins.filter((origin) => origin !== '*');
  const hasWildcard = corsOrigins.includes('*');

  if (hasWildcard && isProduction) {
    console.error('[SECURITY] CORS_ORIGIN=* is not allowed in production. Using the explicit allow-list or same-origin only.');
    return explicit.length > 0 ? explicit : false;
  }

  if (hasWildcard) {
    return true;
  }

  if (explicit.length > 0) {
    return explicit;
  }

  return !isProduction;
}

export function parseManagerWhatsAppContact(env: NodeJS.ProcessEnv = process.env): {
  managerPhoneDisplay: string;
  managerPhoneClean: string;
} | null {
  const clean = String(env.MANAGER_WHATSAPP_E164 || '').replace(/\D/g, '').slice(0, 16);
  if (!clean) {
    return null;
  }
  const display = String(env.MANAGER_WHATSAPP_DISPLAY || '').trim().slice(0, 32);
  return {
    managerPhoneDisplay: display || `+${clean}`,
    managerPhoneClean: clean
  };
}
