import crypto from 'crypto';

// Email validation
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function getEmailDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() || '';
}

export function isPrismClinicalEmail(email: string): boolean {
  return email.toLowerCase().endsWith('@prism-clinical.com');
}

// NPI validation using Luhn algorithm
export function isValidNPIFormat(npi: string): boolean {
  // NPI must be exactly 10 digits
  if (!/^\d{10}$/.test(npi)) {
    return false;
  }

  // Apply Luhn algorithm with NPI prefix
  // NPI uses prefix 80840 for the check digit calculation
  const prefixedNpi = '80840' + npi;

  let sum = 0;
  let alternate = false;

  for (let i = prefixedNpi.length - 1; i >= 0; i--) {
    let digit = parseInt(prefixedNpi[i], 10);

    if (alternate) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    alternate = !alternate;
  }

  return sum % 10 === 0;
}

// Generate secure random token
export function generateToken(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomBytes = crypto.randomBytes(length);

  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % chars.length];
  }

  return result;
}

// Generate a cryptographically secure hash
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
