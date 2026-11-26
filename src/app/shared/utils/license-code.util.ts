import { EditionTier } from '../../../environments/edition.types';

export const LICENSE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export interface LicenseCodeValidationResult {
  valid: boolean;
  normalizedCode: string;
  tier: 'professional' | 'enterprise' | null;
  error: string | null;
}

export function normalizeSubscriptionTier(raw?: string | null): EditionTier {
  const clean = (raw || '').trim().toLowerCase();
  if (clean === 'enterprise') return 'enterprise';
  if (clean === 'professional' || clean === 'pro') return 'professional';
  return 'community';
}

export function normalizeLicenseType(raw?: string | null): string | null {
  const clean = (raw || '').trim().toLowerCase();
  return clean || null;
}

export function normalizeIndividualType(raw?: string | null): string | null {
  const clean = (raw || '').trim().toLowerCase();
  return clean || null;
}

export function isPersonalIndividualLicense(input: {
  tier?: string | null;
  licenseType?: string | null;
  individualType?: string | null;
}): boolean {
  const ind = normalizeIndividualType(input.individualType);
  if (ind === 'personal') return true;
  const lic = normalizeLicenseType(input.licenseType);
  if (lic === 'individual' && !ind) return true;
  const tier = normalizeSubscriptionTier(input.tier);
  return tier === 'professional' && ind !== 'organization';
}

export function enforceNonEnterpriseForIndividual(input: {
  tier?: string | null;
  licenseType?: string | null;
  individualType?: string | null;
}): EditionTier {
  const tier = normalizeSubscriptionTier(input.tier);
  if (isPersonalIndividualLicense(input) && tier === 'enterprise') {
    return 'professional';
  }
  return tier;
}

/**
 * Formats user input live into canonical ONST-{PRO|ENT}-XXXX-XXXX-XXXX-XXXX shape
 * while preserving caller formatting for custom database-inserted license keys.
 */
export function formatRegistrationCodeInput(raw: string): string {
  const trimmed = (raw || '').toUpperCase().trimStart();
  const compact = trimmed.replace(/[^A-Z0-9]/g, '');
  if (!compact) return '';

  if ('ONST'.startsWith(compact) || compact.startsWith('ONST')) {
    const sliced = compact.slice(0, 23);
    const widths = [4, 3, 4, 4, 4, 4];
    const parts: string[] = [];
    let cursor = 0;
    for (const w of widths) {
      if (cursor >= sliced.length) break;
      parts.push(sliced.slice(cursor, cursor + w));
      cursor += w;
    }
    return parts.join('-');
  }

  return trimmed.replace(/[^A-Z0-9-]/g, '').slice(0, 64);
}

export function validateRegistrationCodeFormat(raw: string): LicenseCodeValidationResult {
  const compact = (raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  if (compact.length !== 23 || !compact.startsWith('ONST')) {
    return {
      valid: false,
      normalizedCode: formatRegistrationCodeInput(raw),
      tier: null,
      error: 'Expected format: ONST-PRO-XXXX-XXXX-XXXX-XXXX or ONST-ENT-XXXX-XXXX-XXXX-XXXX.',
    };
  }

  const tag = compact.slice(4, 7);
  if (tag !== 'PRO' && tag !== 'ENT') {
    return {
      valid: false,
      normalizedCode: formatRegistrationCodeInput(raw),
      tier: null,
      error: 'Invalid plan prefix. Registration code must contain -PRO- or -ENT-.',
    };
  }

  const g1 = compact.slice(7, 11);
  const g2 = compact.slice(11, 15);
  const g3 = compact.slice(15, 19);
  const g4 = compact.slice(19, 23);
  const tail = g1 + g2 + g3 + g4;

  for (const ch of tail) {
    if (!LICENSE_ALPHABET.includes(ch)) {
      return {
        valid: false,
        normalizedCode: `ONST-${tag}-${g1}-${g2}-${g3}-${g4}`,
        tier: null,
        error: `Character "${ch}" is not used in OnSteroid registration keys (avoid 0, O, 1, I).`,
      };
    }
  }

  return {
    valid: true,
    normalizedCode: `ONST-${tag}-${g1}-${g2}-${g3}-${g4}`,
    tier: tag === 'ENT' ? 'enterprise' : 'professional',
    error: null,
  };
}

export function validateLicenseActivationInput(raw: string): LicenseCodeValidationResult {
  const clean = (raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!clean) {
    return {
      valid: false,
      normalizedCode: '',
      tier: null,
      error: 'Please enter your registration code or license key.',
    };
  }

  if (clean.startsWith('ONST')) {
    return validateRegistrationCodeFormat(raw);
  }

  if (clean.length < 8 || !/^[A-Z0-9-]+$/.test(clean)) {
    return {
      valid: false,
      normalizedCode: clean,
      tier: null,
      error: 'License keys must be at least 8 alphanumeric/hyphen characters.',
    };
  }

  return {
    valid: true,
    normalizedCode: clean,
    tier: null,
    error: null,
  };
}

export async function validateRegistrationCodeWithChecksum(raw: string): Promise<LicenseCodeValidationResult> {
  const clean = (raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!clean.startsWith('ONST')) {
    return validateLicenseActivationInput(raw);
  }

  const formatResult = validateRegistrationCodeFormat(raw);
  if (!formatResult.valid) {
    return formatResult;
  }

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return formatResult;
  }

  const parts = formatResult.normalizedCode.split('-');
  const body = parts.slice(0, 5).join('-');
  const checksum = parts[5];

  const encoded = new TextEncoder().encode(`OnSteroidLicense::${body}`);
  const digest = await subtle.digest('SHA-256', encoded);
  const bytes = new Uint8Array(digest);
  let expected = '';
  for (let i = 0; i < 4; i++) {
    expected += LICENSE_ALPHABET[bytes[i] % LICENSE_ALPHABET.length];
  }

  if (expected !== checksum) {
    return {
      valid: false,
      normalizedCode: formatResult.normalizedCode,
      tier: null,
      error: 'Registration code checksum failed. Please check for typos and try again.',
    };
  }

  return formatResult;
}
