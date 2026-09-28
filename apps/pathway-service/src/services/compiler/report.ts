// apps/pathway-service/src/services/compiler/report.ts
import type { ValidationResult } from '../import/types';
import type { CompileResult } from './model';

/** Import stays lenient for drafts; compile problems are reported, and enforced at activation (Task 8). */
export function withCompileReport(validation: ValidationResult, compiled: CompileResult): ValidationResult {
  if (compiled.ok === false) {
    return { ...validation, warnings: [...validation.warnings, ...compiled.errors.map((e) => `Not evaluable until fixed: ${e.message}`)] };
  }
  return validation;
}
