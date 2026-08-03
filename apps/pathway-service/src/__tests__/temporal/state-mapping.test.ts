import {
  deriveConditionState, deriveMedicationState, deriveAllergyState, deriveValidity,
} from '../../services/resolution/temporal/state-mapping';

test('condition: recurrence/relapse are active; missing → fail-open active', () => {
  expect(deriveConditionState({ clinicalStatus: 'relapse', hasAbatement: false }).clinicalState).toBe('ACTIVE');
  expect(deriveConditionState({ clinicalStatus: null, hasAbatement: false }))
    .toEqual({ clinicalState: 'ACTIVE', stateBasis: 'MISSING_STATUS_FAIL_OPEN' });
});
test('condition: abatement resolves; abatement + active status is CONFLICT', () => {
  expect(deriveConditionState({ clinicalStatus: 'resolved', hasAbatement: true }))
    .toEqual({ clinicalState: 'INACTIVE', stateBasis: 'ABATEMENT' });
  expect(deriveConditionState({ clinicalStatus: 'active', hasAbatement: true }).clinicalState).toBe('CONFLICT');
});
test('medication: on-hold/draft distinct; MISSING required status → UNKNOWN (not fail-open)', () => {
  expect(deriveMedicationState({ status: 'on-hold' }).clinicalState).toBe('ON_HOLD');
  expect(deriveMedicationState({ status: 'draft' }).clinicalState).toBe('UNKNOWN');
  expect(deriveMedicationState({ status: null }).clinicalState).toBe('UNKNOWN');
});
test('allergy: missing status → fail-open active; resolved → inactive', () => {
  expect(deriveAllergyState({ clinicalStatus: null }).stateBasis).toBe('MISSING_STATUS_FAIL_OPEN');
  expect(deriveAllergyState({ clinicalStatus: 'resolved' }).clinicalState).toBe('INACTIVE');
});
test('validity: refuted/entered-in-error → INVALID; uncertain verification → UNKNOWN; confirmed/absent → VALID', () => {
  expect(deriveValidity({ kind: 'condition', verificationStatus: 'refuted' }).recordValidity).toBe('INVALID');
  expect(deriveValidity({ kind: 'condition', verificationStatus: 'provisional' }).recordValidity).toBe('UNKNOWN');
  expect(deriveValidity({ kind: 'condition', verificationStatus: 'differential' }).recordValidity).toBe('UNKNOWN');
  expect(deriveValidity({ kind: 'condition', verificationStatus: 'confirmed' }).recordValidity).toBe('VALID');
  expect(deriveValidity({ kind: 'condition', verificationStatus: null }).recordValidity).toBe('VALID');
});
test('validity: observation status tri-state; missing med status → UNKNOWN', () => {
  expect(deriveValidity({ kind: 'lab', observationStatus: 'entered-in-error' }).recordValidity).toBe('INVALID');
  expect(deriveValidity({ kind: 'lab', observationStatus: 'preliminary' }).recordValidity).toBe('UNKNOWN');
  expect(deriveValidity({ kind: 'lab', observationStatus: 'corrected' }).recordValidity).toBe('VALID');
  expect(deriveValidity({ kind: 'medication_order', medStatus: null }).recordValidity).toBe('UNKNOWN');
});
