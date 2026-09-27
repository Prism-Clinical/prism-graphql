// apps/pathway-service/src/__tests__/compiler-report.test.ts
import { withCompileReport } from '../services/compiler/report';

describe('withCompileReport', () => {
  const validation = { valid: true, errors: [], warnings: ['existing'] };
  it('leaves a compiling pathway untouched', () => {
    expect(withCompileReport(validation, { ok: true, model: {} as never })).toBe(validation);
  });
  it('adds compile errors as warnings; the import is still valid', () => {
    const r = withCompileReport(validation, { ok: false, errors: [{ code: 'UNMAPPED_ATTRIBUTE', nodeId: 'g', message: 'Gate "g": attribute "lab.hemoglobin" has no pathway_attribute_code_map row, so it cannot be read' }] });
    expect(r).toEqual({ valid: true, errors: [], warnings: ['existing', 'Not evaluable until fixed: Gate "g": attribute "lab.hemoglobin" has no pathway_attribute_code_map row, so it cannot be read'] });
  });
});
