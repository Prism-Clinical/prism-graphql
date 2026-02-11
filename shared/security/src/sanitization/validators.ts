/**
 * Input Validators
 *
 * Validation utilities for various input types.
 */

import { ValidationResult, ValidationError, ValidationWarning } from '../types';

/**
 * UUID v4 pattern
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Email pattern (simplified RFC 5322)
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Phone pattern (international)
 */
const PHONE_PATTERN = /^\+?[1-9]\d{1,14}$/;

/**
 * Date pattern (ISO 8601)
 */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * MRN pattern (alphanumeric, configurable)
 */
const MRN_PATTERN = /^[A-Z0-9]{4,20}$/i;

/**
 * Validate UUID
 */
export function validateUUID(value: string, fieldName: string): ValidationResult {
  const errors: ValidationError[] = [];

  if (!value) {
    errors.push({
      field: fieldName,
      code: 'REQUIRED',
      message: `${fieldName} is required`,
    });
  } else if (!UUID_PATTERN.test(value)) {
    errors.push({
      field: fieldName,
      code: 'INVALID_UUID',
      message: `${fieldName} must be a valid UUID`,
      rejectedValue: value.substring(0, 50),
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings: [],
    sanitizedValue: value?.toLowerCase(),
  };
}

/**
 * Validate email
 */
export function validateEmail(value: string, fieldName: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!value) {
    errors.push({
      field: fieldName,
      code: 'REQUIRED',
      message: `${fieldName} is required`,
    });
  } else if (!EMAIL_PATTERN.test(value)) {
    errors.push({
      field: fieldName,
      code: 'INVALID_EMAIL',
      message: `${fieldName} must be a valid email address`,
    });
  } else if (value.length > 254) {
    errors.push({
      field: fieldName,
      code: 'TOO_LONG',
      message: `${fieldName} must be 254 characters or less`,
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    sanitizedValue: value?.toLowerCase().trim(),
  };
}

/**
 * Validate phone number
 */
export function validatePhone(value: string, fieldName: string): ValidationResult {
  const errors: ValidationError[] = [];

  // Remove common formatting
  const normalized = value?.replace(/[\s\-().]/g, '');

  if (!normalized) {
    errors.push({
      field: fieldName,
      code: 'REQUIRED',
      message: `${fieldName} is required`,
    });
  } else if (!PHONE_PATTERN.test(normalized)) {
    errors.push({
      field: fieldName,
      code: 'INVALID_PHONE',
      message: `${fieldName} must be a valid phone number`,
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings: [],
    sanitizedValue: normalized,
  };
}

/**
 * Validate date
 */
export function validateDate(value: string, fieldName: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!value) {
    errors.push({
      field: fieldName,
      code: 'REQUIRED',
      message: `${fieldName} is required`,
    });
  } else if (!DATE_PATTERN.test(value)) {
    errors.push({
      field: fieldName,
      code: 'INVALID_DATE',
      message: `${fieldName} must be a valid ISO 8601 date`,
    });
  } else {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      errors.push({
        field: fieldName,
        code: 'INVALID_DATE',
        message: `${fieldName} is not a valid date`,
      });
    } else {
      // Check for reasonable date range
      const now = new Date();
      const minDate = new Date('1900-01-01');
      const maxDate = new Date(now.getFullYear() + 100, 11, 31);

      if (date < minDate || date > maxDate) {
        warnings.push({
          field: fieldName,
          code: 'DATE_OUT_OF_RANGE',
          message: `${fieldName} appears to be outside a reasonable date range`,
        });
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    sanitizedValue: value,
  };
}

/**
 * Validate MRN (Medical Record Number)
 */
export function validateMRN(value: string, fieldName: string): ValidationResult {
  const errors: ValidationError[] = [];

  // Normalize: uppercase, remove common separators
  const normalized = value?.toUpperCase().replace(/[\s\-]/g, '');

  if (!normalized) {
    errors.push({
      field: fieldName,
      code: 'REQUIRED',
      message: `${fieldName} is required`,
    });
  } else if (!MRN_PATTERN.test(normalized)) {
    errors.push({
      field: fieldName,
      code: 'INVALID_MRN',
      message: `${fieldName} must be 4-20 alphanumeric characters`,
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings: [],
    sanitizedValue: normalized,
  };
}

/**
 * Validate required string
 */
export function validateRequiredString(
  value: string,
  fieldName: string,
  options?: { minLength?: number; maxLength?: number }
): ValidationResult {
  const errors: ValidationError[] = [];
  const minLength = options?.minLength || 1;
  const maxLength = options?.maxLength || 10000;

  const trimmed = value?.trim();

  if (!trimmed) {
    errors.push({
      field: fieldName,
      code: 'REQUIRED',
      message: `${fieldName} is required`,
    });
  } else if (trimmed.length < minLength) {
    errors.push({
      field: fieldName,
      code: 'TOO_SHORT',
      message: `${fieldName} must be at least ${minLength} characters`,
    });
  } else if (trimmed.length > maxLength) {
    errors.push({
      field: fieldName,
      code: 'TOO_LONG',
      message: `${fieldName} must be ${maxLength} characters or less`,
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings: [],
    sanitizedValue: trimmed,
  };
}

/**
 * Validate optional string
 */
export function validateOptionalString(
  value: string | undefined | null,
  fieldName: string,
  options?: { maxLength?: number }
): ValidationResult {
  const maxLength = options?.maxLength || 10000;

  if (!value) {
    return { isValid: true, errors: [], warnings: [] };
  }

  const trimmed = value.trim();
  const errors: ValidationError[] = [];

  if (trimmed.length > maxLength) {
    errors.push({
      field: fieldName,
      code: 'TOO_LONG',
      message: `${fieldName} must be ${maxLength} characters or less`,
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings: [],
    sanitizedValue: trimmed || undefined,
  };
}

/**
 * Validate enum value
 */
export function validateEnum<T extends string>(
  value: string,
  fieldName: string,
  allowedValues: T[]
): ValidationResult {
  const errors: ValidationError[] = [];

  if (!value) {
    errors.push({
      field: fieldName,
      code: 'REQUIRED',
      message: `${fieldName} is required`,
    });
  } else if (!allowedValues.includes(value as T)) {
    errors.push({
      field: fieldName,
      code: 'INVALID_ENUM',
      message: `${fieldName} must be one of: ${allowedValues.join(', ')}`,
      rejectedValue: value,
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings: [],
    sanitizedValue: value,
  };
}

/**
 * Validate array
 */
export function validateArray<T>(
  value: T[],
  fieldName: string,
  options?: {
    minLength?: number;
    maxLength?: number;
    itemValidator?: (item: T, index: number) => ValidationResult;
  }
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const minLength = options?.minLength || 0;
  const maxLength = options?.maxLength || 1000;

  if (!Array.isArray(value)) {
    errors.push({
      field: fieldName,
      code: 'INVALID_TYPE',
      message: `${fieldName} must be an array`,
    });
    return { isValid: false, errors, warnings };
  }

  if (value.length < minLength) {
    errors.push({
      field: fieldName,
      code: 'TOO_SHORT',
      message: `${fieldName} must have at least ${minLength} items`,
    });
  }

  if (value.length > maxLength) {
    errors.push({
      field: fieldName,
      code: 'TOO_LONG',
      message: `${fieldName} must have at most ${maxLength} items`,
    });
  }

  // Validate items if validator provided
  if (options?.itemValidator) {
    const validatedItems: T[] = [];
    for (let i = 0; i < Math.min(value.length, maxLength); i++) {
      const result = options.itemValidator(value[i], i);
      if (!result.isValid) {
        errors.push(...result.errors.map((e) => ({
          ...e,
          field: `${fieldName}[${i}].${e.field}`,
        })));
      }
      warnings.push(...result.warnings.map((w) => ({
        ...w,
        field: `${fieldName}[${i}].${w.field}`,
      })));
      validatedItems.push((result.sanitizedValue as T | undefined) ?? value[i]);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      sanitizedValue: validatedItems,
    };
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    sanitizedValue: value.slice(0, maxLength),
  };
}

/**
 * Combine multiple validation results
 */
export function combineValidationResults(...results: ValidationResult[]): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  for (const result of results) {
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}
