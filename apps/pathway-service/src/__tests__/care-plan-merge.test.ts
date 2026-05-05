import {
  mergeResolvedCarePlans,
  ResolvedCarePlan,
  ResolvedMedication,
  ResolvedLab,
  ResolvedProcedure,
  ResolvedSchedule,
  ResolvedQualityMetric,
} from '../services/resolution/care-plan-merge';

// ─── Fixture helpers ──────────────────────────────────────────────────

let pathwayCounter = 0;

function makePathway(opts: {
  title: string;
  medications?: Partial<ResolvedMedication>[];
  labs?: Partial<ResolvedLab>[];
  procedures?: Partial<ResolvedProcedure>[];
  schedules?: Partial<ResolvedSchedule>[];
  qualityMetrics?: Partial<ResolvedQualityMetric>[];
}): ResolvedCarePlan {
  const id = `path-${++pathwayCounter}`;
  return {
    pathwayId: id,
    pathwayLogicalId: `lp-${id}`,
    pathwayTitle: opts.title,
    medications: (opts.medications ?? []).map((m) => ({
      name: 'Drug',
      role: 'first_line',
      sourcePathwayId: id,
      ...m,
    })) as ResolvedMedication[],
    labs: (opts.labs ?? []).map((l) => ({
      name: 'Lab',
      sourcePathwayId: id,
      ...l,
    })) as ResolvedLab[],
    procedures: (opts.procedures ?? []).map((p) => ({
      name: 'Proc',
      sourcePathwayId: id,
      ...p,
    })) as ResolvedProcedure[],
    schedules: (opts.schedules ?? []).map((s) => ({
      interval: '3 months',
      description: 'Follow up',
      sourcePathwayId: id,
      ...s,
    })) as ResolvedSchedule[],
    qualityMetrics: (opts.qualityMetrics ?? []).map((q) => ({
      name: 'Metric',
      measure: 'Some measure',
      sourcePathwayId: id,
      ...q,
    })) as ResolvedQualityMetric[],
  };
}

beforeEach(() => {
  pathwayCounter = 0;
});

// ─── Trivial cases ────────────────────────────────────────────────────

describe('mergeResolvedCarePlans — trivial cases', () => {
  it('returns an empty merged plan for empty input', () => {
    const merged = mergeResolvedCarePlans([]);
    expect(merged.sourcePathwayIds).toEqual([]);
    expect(merged.medications).toEqual([]);
    expect(merged.suppressed).toEqual([]);
  });

  it('passes through a single plan unchanged (no conflicts to resolve)', () => {
    const plan = makePathway({
      title: 'T2DM',
      medications: [{ name: 'Metformin', role: 'first_line', dose: '500mg' }],
      labs: [{ name: 'HbA1c', code: '4548-4', system: 'LOINC' }],
    });
    const merged = mergeResolvedCarePlans([plan]);
    expect(merged.sourcePathwayIds).toEqual([plan.pathwayId]);
    expect(merged.medications).toHaveLength(1);
    expect(merged.medications[0].recommendation.name).toBe('Metformin');
    expect(merged.medications[0].sourcePathwayIds).toEqual([plan.pathwayId]);
    expect(merged.medications[0].state).toBe('auto-included');
    expect(merged.labs).toHaveLength(1);
  });
});

// ─── Hard-constraint suppression ──────────────────────────────────────

describe('mergeResolvedCarePlans — hard-constraint suppression', () => {
  it('suppresses a drug flagged contraindicated by its own pathway', () => {
    const plan = makePathway({
      title: 'Pregnancy',
      medications: [{ name: 'Lisinopril', role: 'contraindicated' }],
    });
    const merged = mergeResolvedCarePlans([plan]);
    expect(merged.medications).toHaveLength(0);
    expect(merged.suppressed).toHaveLength(1);
    expect(merged.suppressed[0].name).toBe('Lisinopril');
    expect(merged.suppressed[0].reason).toBe('contraindicated');
    expect(merged.suppressed[0].suppressedBy.pathwayId).toBe(plan.pathwayId);
  });

  it('suppresses a drug across all pathways when ANY flags it contraindicated', () => {
    const pregnancy = makePathway({
      title: 'Pregnancy',
      medications: [{ name: 'Lisinopril', role: 'contraindicated' }],
    });
    const htn = makePathway({
      title: 'Hypertension',
      medications: [{ name: 'Lisinopril', role: 'first_line' }],
    });
    const merged = mergeResolvedCarePlans([pregnancy, htn]);
    expect(merged.medications).toHaveLength(0);
    // Both the pregnancy pathway's flag and the HTN pathway's recommendation
    // get into the suppressed list (with different `original` payloads).
    expect(merged.suppressed).toHaveLength(2);
    const fromHtn = merged.suppressed.find(
      (s) => s.original.sourcePathwayId === htn.pathwayId,
    );
    expect(fromHtn!.reason).toBe('contraindicated');
    expect(fromHtn!.suppressedBy.pathwayId).toBe(pregnancy.pathwayId);
  });

  it('treats role=avoid the same as contraindicated (suppresses across pathways)', () => {
    const oud = makePathway({
      title: 'OUD-in-remission',
      medications: [{ name: 'Tramadol', role: 'avoid' }],
    });
    const pain = makePathway({
      title: 'Chronic Pain',
      medications: [{ name: 'Tramadol', role: 'second_line' }],
    });
    const merged = mergeResolvedCarePlans([oud, pain]);
    expect(merged.medications).toHaveLength(0);
    const fromPain = merged.suppressed.find(
      (s) => s.original.sourcePathwayId === pain.pathwayId,
    );
    expect(fromPain!.reason).toBe('avoid');
    expect(fromPain!.suppressedBy.pathwayId).toBe(oud.pathwayId);
  });

  it('only suppresses the matching drug name; unrelated drugs pass through', () => {
    const pregnancy = makePathway({
      title: 'Pregnancy',
      medications: [{ name: 'Lisinopril', role: 'contraindicated' }],
    });
    const htn = makePathway({
      title: 'HTN',
      medications: [
        { name: 'Lisinopril', role: 'first_line' },
        { name: 'Methyldopa', role: 'first_line' },
      ],
    });
    const merged = mergeResolvedCarePlans([pregnancy, htn]);
    expect(merged.medications).toHaveLength(1);
    expect(merged.medications[0].recommendation.name).toBe('Methyldopa');
  });

  it('matches drug names case-insensitively when checking for hard constraints', () => {
    const a = makePathway({
      title: 'A',
      medications: [{ name: 'METFORMIN', role: 'avoid' }],
    });
    const b = makePathway({
      title: 'B',
      medications: [{ name: 'metformin', role: 'first_line' }],
    });
    const merged = mergeResolvedCarePlans([a, b]);
    expect(merged.medications).toHaveLength(0);
    expect(merged.suppressed.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Medication dedup ─────────────────────────────────────────────────

describe('mergeResolvedCarePlans — medication dedup', () => {
  it('dedupes a drug recommended by two pathways and merges provenance', () => {
    const a = makePathway({
      title: 'T2DM',
      medications: [{ name: 'Metformin', role: 'first_line' }],
    });
    const b = makePathway({
      title: 'Prediabetes',
      medications: [{ name: 'Metformin', role: 'preferred' }],
    });
    const merged = mergeResolvedCarePlans([a, b]);
    expect(merged.medications).toHaveLength(1);
    expect(merged.medications[0].sourcePathwayIds).toEqual([
      a.pathwayId,
      b.pathwayId,
    ]);
  });

  it('keeps different drugs separate (no soft-conflict resolution in v1)', () => {
    const a = makePathway({
      title: 'T2DM',
      medications: [{ name: 'Metformin', role: 'first_line' }],
    });
    const b = makePathway({
      title: 'T2DM-with-CKD',
      medications: [{ name: 'Empagliflozin', role: 'first_line' }],
    });
    const merged = mergeResolvedCarePlans([a, b]);
    expect(merged.medications).toHaveLength(2);
  });
});

// ─── Lab / procedure / schedule / quality-metric dedup ────────────────

describe('mergeResolvedCarePlans — non-medication dedup', () => {
  it('dedupes labs by (system, code)', () => {
    const a = makePathway({
      title: 'A',
      labs: [{ name: 'HbA1c', code: '4548-4', system: 'LOINC' }],
    });
    const b = makePathway({
      title: 'B',
      labs: [{ name: 'HbA1c', code: '4548-4', system: 'LOINC' }],
    });
    const merged = mergeResolvedCarePlans([a, b]);
    expect(merged.labs).toHaveLength(1);
    expect(merged.labs[0].sourcePathwayIds).toEqual([
      a.pathwayId,
      b.pathwayId,
    ]);
  });

  it('keeps labs with different codes separate', () => {
    const a = makePathway({
      title: 'A',
      labs: [{ name: 'HbA1c', code: '4548-4', system: 'LOINC' }],
    });
    const b = makePathway({
      title: 'B',
      labs: [{ name: 'CBC', code: '58410-2', system: 'LOINC' }],
    });
    const merged = mergeResolvedCarePlans([a, b]);
    expect(merged.labs).toHaveLength(2);
  });

  it('falls back to lab name when no code is present', () => {
    const a = makePathway({
      title: 'A',
      labs: [{ name: 'HbA1c' }],
    });
    const b = makePathway({
      title: 'B',
      labs: [{ name: 'hba1c' }], // case-insensitive
    });
    const merged = mergeResolvedCarePlans([a, b]);
    expect(merged.labs).toHaveLength(1);
  });

  it('dedupes procedures by code', () => {
    const a = makePathway({
      title: 'A',
      procedures: [{ name: 'ECG', code: '93000', system: 'CPT' }],
    });
    const b = makePathway({
      title: 'B',
      procedures: [{ name: 'EKG', code: '93000', system: 'CPT' }],
    });
    const merged = mergeResolvedCarePlans([a, b]);
    expect(merged.procedures).toHaveLength(1);
  });

  it('dedupes schedules by (interval, description)', () => {
    const a = makePathway({
      title: 'A',
      schedules: [{ interval: '3 months', description: 'Follow up' }],
    });
    const b = makePathway({
      title: 'B',
      schedules: [{ interval: '3 months', description: 'Follow up' }],
    });
    const merged = mergeResolvedCarePlans([a, b]);
    expect(merged.schedules).toHaveLength(1);
  });

  it('keeps schedules with different intervals (no most-frequent-wins logic in v1)', () => {
    const a = makePathway({
      title: 'A',
      schedules: [{ interval: '3 months', description: 'Follow up' }],
    });
    const b = makePathway({
      title: 'B',
      schedules: [{ interval: '6 months', description: 'Follow up' }],
    });
    const merged = mergeResolvedCarePlans([a, b]);
    expect(merged.schedules).toHaveLength(2);
  });

  it('dedupes quality metrics by name', () => {
    const a = makePathway({
      title: 'A',
      qualityMetrics: [{ name: 'BP control rate', measure: '% < 140/90' }],
    });
    const b = makePathway({
      title: 'B',
      qualityMetrics: [{ name: 'BP control rate', measure: '% < 140/90' }],
    });
    const merged = mergeResolvedCarePlans([a, b]);
    expect(merged.qualityMetrics).toHaveLength(1);
  });
});

// ─── Multi-pathway clinical scenarios ─────────────────────────────────

describe('mergeResolvedCarePlans — multi-pathway scenarios', () => {
  it('HTN-DM + general HTN: dedup HbA1c, suppress nothing, merge medications', () => {
    const htnDm = makePathway({
      title: 'HTN with T2DM',
      medications: [
        { name: 'Lisinopril', role: 'first_line' },
        { name: 'Metformin', role: 'first_line' },
      ],
      labs: [
        { name: 'HbA1c', code: '4548-4', system: 'LOINC' },
        { name: 'BP', code: '85354-9', system: 'LOINC' },
      ],
      schedules: [{ interval: '3 months', description: 'A1c + BP' }],
    });
    const merged = mergeResolvedCarePlans([htnDm]);
    expect(merged.medications).toHaveLength(2);
    expect(merged.labs).toHaveLength(2);
    expect(merged.schedules).toHaveLength(1);
    expect(merged.suppressed).toHaveLength(0);
  });

  it('Pregnancy + chronic HTN: ACE-I suppressed, methyldopa kept', () => {
    const pregnancy = makePathway({
      title: 'Pregnancy',
      medications: [
        { name: 'Lisinopril', role: 'contraindicated' },
        { name: 'Methyldopa', role: 'first_line' },
      ],
    });
    const chronicHtn = makePathway({
      title: 'Chronic HTN',
      medications: [{ name: 'Lisinopril', role: 'first_line' }],
    });
    const merged = mergeResolvedCarePlans([pregnancy, chronicHtn]);
    expect(merged.medications).toHaveLength(1);
    expect(merged.medications[0].recommendation.name).toBe('Methyldopa');
    expect(merged.suppressed.length).toBeGreaterThanOrEqual(2);
  });

  it('Three pathways with overlap: provenance correctly accumulated', () => {
    const a = makePathway({
      title: 'A',
      medications: [{ name: 'Atorvastatin', role: 'preferred' }],
    });
    const b = makePathway({
      title: 'B',
      medications: [{ name: 'Atorvastatin', role: 'first_line' }],
    });
    const c = makePathway({
      title: 'C',
      medications: [{ name: 'Atorvastatin', role: 'acceptable' }],
    });
    const merged = mergeResolvedCarePlans([a, b, c]);
    expect(merged.medications).toHaveLength(1);
    expect(merged.medications[0].sourcePathwayIds).toEqual([
      a.pathwayId,
      b.pathwayId,
      c.pathwayId,
    ]);
  });

  it('Provenance is deduplicated within a single recommendation', () => {
    // Edge case: a single pathway recommends the same drug twice (shouldn't
    // happen in practice but the merger handles it gracefully).
    const a: ResolvedCarePlan = {
      pathwayId: 'p1',
      pathwayLogicalId: 'lp',
      pathwayTitle: 'A',
      medications: [
        { name: 'Drug', role: 'first_line', sourcePathwayId: 'p1' },
        { name: 'Drug', role: 'preferred', sourcePathwayId: 'p1' },
      ],
      labs: [],
      procedures: [],
      schedules: [],
      qualityMetrics: [],
    };
    const merged = mergeResolvedCarePlans([a]);
    expect(merged.medications).toHaveLength(1);
    expect(merged.medications[0].sourcePathwayIds).toEqual(['p1']); // dedup
  });
});

// ─── clinical_role conflicts (Phase 3 commit 4) ───────────────────────

describe('mergeResolvedCarePlans — clinical_role soft conflicts', () => {
  it('passes untagged different drugs through as separate auto-included entries', () => {
    const a = makePathway({
      title: 'AF',
      medications: [{ name: 'Metoprolol', role: 'first_line' }],
    });
    const b = makePathway({
      title: 'HFrEF',
      medications: [{ name: 'Carvedilol', role: 'first_line' }],
    });
    const merged = mergeResolvedCarePlans([a, b]);
    expect(merged.conflicts).toEqual([]);
    expect(merged.medications).toHaveLength(2);
  });

  it('flags a conflict when two pathways tag different drugs with the same clinical_role', () => {
    const a = makePathway({
      title: 'AF',
      medications: [{
        name: 'Metoprolol',
        role: 'first_line',
        clinicalRole: 'first_line_beta_blocker_for_chf',
      }],
    });
    const b = makePathway({
      title: 'HFrEF',
      medications: [{
        name: 'Carvedilol',
        role: 'first_line',
        clinicalRole: 'first_line_beta_blocker_for_chf',
      }],
    });
    const merged = mergeResolvedCarePlans([a, b]);

    expect(merged.medications).toEqual([]);
    expect(merged.conflicts).toHaveLength(1);
    const c = merged.conflicts[0];
    expect(c.conflictId).toBe('first_line_beta_blocker_for_chf');
    expect(c.clinicalRole).toBe('first_line_beta_blocker_for_chf');
    expect(c.candidates).toHaveLength(2);
    expect(c.candidates.map((x) => x.recommendation.name).sort()).toEqual(['Carvedilol', 'Metoprolol']);
    expect(c.resolution).toBeNull();
  });

  it('passes through as auto-included when two pathways tag the SAME drug with the same role', () => {
    const a = makePathway({
      title: 'A',
      medications: [{ name: 'Metoprolol', role: 'first_line', clinicalRole: 'first_line_bb' }],
    });
    const b = makePathway({
      title: 'B',
      medications: [{ name: 'metoprolol', role: 'first_line', clinicalRole: 'first_line_bb' }],
    });
    const merged = mergeResolvedCarePlans([a, b]);
    expect(merged.conflicts).toEqual([]);
    expect(merged.medications).toHaveLength(1);
    expect(merged.medications[0].sourcePathwayIds.sort()).toEqual([a.pathwayId, b.pathwayId].sort());
  });

  it('does not flag a conflict if only one pathway tagged the role', () => {
    const a = makePathway({
      title: 'A',
      medications: [{ name: 'Metoprolol', role: 'first_line', clinicalRole: 'first_line_bb' }],
    });
    const b = makePathway({
      title: 'B',
      medications: [{ name: 'Carvedilol', role: 'first_line' }], // untagged
    });
    const merged = mergeResolvedCarePlans([a, b]);
    expect(merged.conflicts).toEqual([]);
    expect(merged.medications).toHaveLength(2);
  });

  it('handles multiple distinct conflicts in one merge', () => {
    const a = makePathway({
      title: 'A',
      medications: [
        { name: 'Metoprolol', role: 'first_line', clinicalRole: 'first_line_bb' },
        { name: 'Sertraline', role: 'first_line', clinicalRole: 'first_line_ssri' },
      ],
    });
    const b = makePathway({
      title: 'B',
      medications: [
        { name: 'Carvedilol', role: 'first_line', clinicalRole: 'first_line_bb' },
        { name: 'Escitalopram', role: 'first_line', clinicalRole: 'first_line_ssri' },
      ],
    });
    const merged = mergeResolvedCarePlans([a, b]);
    expect(merged.conflicts).toHaveLength(2);
    expect(merged.conflicts.map((c) => c.clinicalRole).sort()).toEqual([
      'first_line_bb',
      'first_line_ssri',
    ]);
  });

  it('handles three pathways recommending three different drugs in the same lane', () => {
    const a = makePathway({
      title: 'A',
      medications: [{ name: 'Metoprolol', role: 'first_line', clinicalRole: 'first_line_bb' }],
    });
    const b = makePathway({
      title: 'B',
      medications: [{ name: 'Carvedilol', role: 'first_line', clinicalRole: 'first_line_bb' }],
    });
    const c = makePathway({
      title: 'C',
      medications: [{ name: 'Bisoprolol', role: 'first_line', clinicalRole: 'first_line_bb' }],
    });
    const merged = mergeResolvedCarePlans([a, b, c]);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0].candidates).toHaveLength(3);
  });

  it('contraindication takes precedence over conflict — drug never reaches conflict detection', () => {
    const a = makePathway({
      title: 'A',
      medications: [{ name: 'Metoprolol', role: 'avoid', clinicalRole: 'first_line_bb' }],
    });
    const b = makePathway({
      title: 'B',
      medications: [{ name: 'Carvedilol', role: 'first_line', clinicalRole: 'first_line_bb' }],
    });
    const merged = mergeResolvedCarePlans([a, b]);

    // Metoprolol was avoid → suppressed before reaching conflict detection;
    // Carvedilol stands alone in the role → not a conflict.
    expect(merged.conflicts).toEqual([]);
    expect(merged.medications).toHaveLength(1);
    expect(merged.medications[0].recommendation.name).toBe('Carvedilol');
    expect(merged.suppressed).toHaveLength(1);
    expect(merged.suppressed[0].name).toBe('Metoprolol');
  });

  it('preserves source pathway titles on conflict candidates for UX', () => {
    const a = makePathway({
      title: 'Atrial Fibrillation',
      medications: [{ name: 'Metoprolol', role: 'first_line', clinicalRole: 'role_x' }],
    });
    const b = makePathway({
      title: 'Heart Failure',
      medications: [{ name: 'Carvedilol', role: 'first_line', clinicalRole: 'role_x' }],
    });
    const merged = mergeResolvedCarePlans([a, b]);
    const titles = merged.conflicts[0].candidates.map((c) => c.sourcePathwayTitle).sort();
    expect(titles).toEqual(['Atrial Fibrillation', 'Heart Failure']);
  });
});
