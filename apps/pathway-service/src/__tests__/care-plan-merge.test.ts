import {
  mergeResolvedCarePlans,
  ResolvedCarePlan,
  ResolvedMedication,
  ResolvedLab,
  ResolvedProcedure,
  ResolvedSchedule,
  ResolvedQualityMetric,
  ResolvedGuidance,
  ResolvedImaging,
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
  guidance?: Partial<ResolvedGuidance>[];
  imaging?: Partial<ResolvedImaging>[];
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
    imaging: (opts.imaging ?? []).map((i) => ({
      name: 'Imaging',
      modality: 'MRI',
      sourcePathwayId: id,
      ...i,
    })) as ResolvedImaging[],
    procedures: (opts.procedures ?? []).map((p) => ({
      name: 'Proc',
      sourcePathwayId: id,
      ...p,
    })) as ResolvedProcedure[],
    guidance: (opts.guidance ?? []).map((g) => ({
      topic: 'Topic',
      instructions: 'Instructions',
      sourcePathwayId: id,
      ...g,
    })) as ResolvedGuidance[],
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

  it('keeps two quality metrics that share a name but define different measures', () => {
    const a = makePathway({
      title: 'A',
      qualityMetrics: [{ name: 'BP control rate', measure: '% < 140/90' }],
    });
    const b = makePathway({
      title: 'B',
      qualityMetrics: [{ name: 'BP control rate', measure: '% < 130/80' }],
    });
    const merged = mergeResolvedCarePlans([a, b]);
    expect(merged.qualityMetrics.map((m) => m.recommendation.measure))
      .toEqual(['% < 140/90', '% < 130/80']);
    expect(merged.qualityMetrics.map((m) => m.sourcePathwayIds)).toEqual([[a.pathwayId], [b.pathwayId]]);
  });

  it('keeps uncoded imaging with and without contrast as separate orders', () => {
    const a = makePathway({
      title: 'A',
      imaging: [{ name: 'MRI head', modality: 'MRI', bodyRegion: 'Head', contrast: true }],
    });
    const b = makePathway({
      title: 'B',
      imaging: [{ name: 'MRI head', modality: 'MRI', bodyRegion: 'Head', contrast: false }],
    });
    const merged = mergeResolvedCarePlans([a, b]);
    expect(merged.imaging.map((m) => m.recommendation.contrast)).toEqual([true, false]);
  });

  it('still dedupes identical uncoded imaging and unions provenance', () => {
    const a = makePathway({
      title: 'A',
      imaging: [{ name: 'MRI head', modality: 'MRI', bodyRegion: 'Head', contrast: false }],
    });
    const b = makePathway({
      title: 'B',
      imaging: [{ name: 'mri  head', modality: 'mri', bodyRegion: 'head', contrast: false }],
    });
    const merged = mergeResolvedCarePlans([a, b]);
    expect(merged.imaging).toHaveLength(1);
    expect(merged.imaging[0].sourcePathwayIds).toEqual([a.pathwayId, b.pathwayId]);
  });
});

// ─── Guidance ─────────────────────────────────────────────────────────

/**
 * Guidance used to be keyed by topic alone, so two pathways' different
 * instructions under one heading collapsed to the first pathway's text. Real
 * case: anaemia-in-pregnancy and asymptomatic-bacteriuria-in-pregnancy both
 * ship "When to call us right away", and the second pathway's safety-netting
 * advice silently disappeared from the merged plan.
 */
describe('mergeResolvedCarePlans — guidance', () => {
  const TOPIC = 'When to call us right away';

  it('keeps both pathways\' instructions when they share a topic but differ in text', () => {
    const anaemia = makePathway({
      title: 'Anemia in pregnancy',
      guidance: [{ topic: TOPIC, instructions: 'Call if you feel faint, short of breath, or your heart races.' }],
    });
    const asb = makePathway({
      title: 'Asymptomatic bacteriuria in pregnancy',
      guidance: [{ topic: TOPIC, instructions: 'Call if you have fever, flank pain, or burning when you pee.' }],
    });
    const merged = mergeResolvedCarePlans([anaemia, asb]);
    expect(merged.guidance).toHaveLength(2);
    expect(merged.guidance.map((g) => g.recommendation.instructions)).toEqual([
      'Call if you feel faint, short of breath, or your heart races.',
      'Call if you have fever, flank pain, or burning when you pee.',
    ]);
    expect(merged.guidance.map((g) => g.sourcePathwayIds)).toEqual([[anaemia.pathwayId], [asb.pathwayId]]);
  });

  it('dedupes identical topic + instructions and unions sourcePathwayIds', () => {
    const text = 'Call if you have vaginal bleeding or leaking fluid.';
    const a = makePathway({ title: 'A', guidance: [{ topic: TOPIC, instructions: text }] });
    const b = makePathway({ title: 'B', guidance: [{ topic: TOPIC, instructions: text }] });
    const merged = mergeResolvedCarePlans([a, b]);
    expect(merged.guidance).toHaveLength(1);
    expect(merged.guidance[0].sourcePathwayIds).toEqual([a.pathwayId, b.pathwayId]);
  });

  it('treats case and whitespace differences alone as identical', () => {
    const a = makePathway({
      title: 'A', guidance: [{ topic: TOPIC, instructions: 'Call if you have a fever.' }],
    });
    const b = makePathway({
      title: 'B', guidance: [{ topic: `  ${TOPIC.toLowerCase()} `, instructions: 'call if  you have a fever.' }],
    });
    const merged = mergeResolvedCarePlans([a, b]);
    expect(merged.guidance).toHaveLength(1);
    expect(merged.guidance[0].sourcePathwayIds).toEqual([a.pathwayId, b.pathwayId]);
  });

  it('keeps two same-topic Guidance nodes within ONE pathway', () => {
    const one = makePathway({
      title: 'A',
      guidance: [
        { topic: TOPIC, instructions: 'Call if you feel faint.' },
        { topic: TOPIC, instructions: 'Call if you have a fever.' },
      ],
    });
    const merged = mergeResolvedCarePlans([one]);
    expect(merged.guidance.map((g) => g.recommendation.instructions))
      .toEqual(['Call if you feel faint.', 'Call if you have a fever.']);
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
      imaging: [],
      procedures: [],
      guidance: [],
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

// ─── Same drug, different regimens ────────────────────────────────────
//
// Medications used to be merged by drug NAME alone: when two pathways asked
// for the same drug at a different dose / frequency / route / duration, the
// second pathway's regimen vanished and only its pathway id survived, in the
// provenance of a regimen it never asked for. A regimen is now part of what
// identifies a recommendation; the drug NAME still identifies the drug for
// suppression and for clinical_role lanes.

describe('mergeResolvedCarePlans — same drug, different regimens', () => {
  const metformin = (over: Partial<ResolvedMedication> = {}): Partial<ResolvedMedication> => ({
    name: 'Metformin',
    role: 'first_line',
    dose: '500 mg',
    frequency: 'BID',
    route: 'PO',
    duration: '90 days',
    ...over,
  });

  it('merges an identical regimen from two pathways and unions provenance', () => {
    const a = makePathway({ title: 'T2DM', medications: [metformin()] });
    const b = makePathway({ title: 'PCOS', medications: [metformin()] });
    const merged = mergeResolvedCarePlans([a, b]);

    expect(merged.conflicts).toEqual([]);
    expect(merged.medications).toHaveLength(1);
    expect(merged.medications[0].sourcePathwayIds).toEqual([a.pathwayId, b.pathwayId]);
  });

  it('treats case and whitespace differences in the regimen as identical', () => {
    const a = makePathway({ title: 'T2DM', medications: [metformin()] });
    const b = makePathway({
      title: 'PCOS',
      medications: [metformin({ name: ' metformin ', dose: '500  MG', frequency: 'bid', route: 'po' })],
    });
    const merged = mergeResolvedCarePlans([a, b]);

    expect(merged.conflicts).toEqual([]);
    expect(merged.medications).toHaveLength(1);
  });

  it('does not let the recommendation role split an otherwise identical regimen', () => {
    const a = makePathway({ title: 'T2DM', medications: [metformin({ role: 'first_line' })] });
    const b = makePathway({ title: 'Prediabetes', medications: [metformin({ role: 'preferred' })] });
    const merged = mergeResolvedCarePlans([a, b]);

    expect(merged.conflicts).toEqual([]);
    expect(merged.medications).toHaveLength(1);
  });

  it.each([
    ['dose', { dose: '1000 mg' }],
    ['frequency', { frequency: 'daily' }],
    ['route', { route: 'IV' }],
    ['duration', { duration: '14 days' }],
    ['a stated vs unstated duration', { duration: undefined }],
  ])('never drops a second pathway\'s regimen that differs by %s — surfaces a conflict', (_label, diff) => {
    const a = makePathway({ title: 'T2DM', medications: [metformin()] });
    const b = makePathway({ title: 'PCOS', medications: [metformin(diff as Partial<ResolvedMedication>)] });
    const merged = mergeResolvedCarePlans([a, b]);

    // Neither regimen is auto-included — the provider has to choose.
    expect(merged.medications).toEqual([]);
    expect(merged.conflicts).toHaveLength(1);

    const c = merged.conflicts[0];
    expect(c.type).toBe('medication_regimen');
    expect(c.conflictId).toBe('regimen:metformin');
    // Untagged drug: the conflict's subject is the drug itself.
    expect(c.clinicalRole).toBe('Metformin');
    expect(c.resolution).toBeNull();
    expect(c.candidates).toHaveLength(2);

    const [ca, cb] = c.candidates;
    expect(ca.sourcePathwayId).toBe(a.pathwayId);
    expect(ca.sourcePathwayTitle).toBe('T2DM');
    expect(ca.recommendation).toMatchObject(metformin());
    expect(cb.sourcePathwayId).toBe(b.pathwayId);
    expect(cb.sourcePathwayTitle).toBe('PCOS');
    expect(cb.recommendation).toMatchObject({ ...metformin(), ...diff });
  });

  it('labels a regimen conflict with the shared clinical_role when the drug carries one', () => {
    const a = makePathway({ title: 'T2DM', medications: [metformin({ clinicalRole: 'first_line_t2dm' })] });
    const b = makePathway({
      title: 'PCOS',
      medications: [metformin({ dose: '1000 mg', clinicalRole: 'first_line_t2dm' })],
    });
    const merged = mergeResolvedCarePlans([a, b]);

    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0].type).toBe('medication_regimen');
    expect(merged.conflicts[0].conflictId).toBe('regimen:metformin');
    expect(merged.conflicts[0].clinicalRole).toBe('first_line_t2dm');
  });

  it('groups pathways that agree into ONE candidate carrying all of their ids', () => {
    const a = makePathway({ title: 'T2DM', medications: [metformin()] });
    const b = makePathway({ title: 'PCOS', medications: [metformin()] });
    const c = makePathway({ title: 'Obesity', medications: [metformin({ dose: '1000 mg' })] });
    const merged = mergeResolvedCarePlans([a, b, c]);

    expect(merged.medications).toEqual([]);
    expect(merged.conflicts).toHaveLength(1);
    const cands = merged.conflicts[0].candidates;
    expect(cands).toHaveLength(2);
    expect(cands[0].recommendation.dose).toBe('500 mg');
    expect(cands[0].sourcePathwayIds).toEqual([a.pathwayId, b.pathwayId]);
    expect(cands[1].recommendation.dose).toBe('1000 mg');
    expect(cands[1].sourcePathwayIds).toEqual([c.pathwayId]);
  });

  it('keeps two regimens authored by ONE pathway as two entries, not a conflict', () => {
    // No cross-pathway disagreement to decide — and CONFIRM_PATHWAY could not
    // tell the two apart. Keeping both is the only answer that loses nothing.
    const a = makePathway({
      title: 'T2DM',
      medications: [metformin(), metformin({ dose: '1000 mg' })],
    });
    const merged = mergeResolvedCarePlans([a]);

    expect(merged.conflicts).toEqual([]);
    expect(merged.medications.map((m) => m.recommendation.dose)).toEqual(['500 mg', '1000 mg']);
  });

  it('leaves unrelated drugs alone when one drug has a regimen conflict', () => {
    const a = makePathway({
      title: 'T2DM',
      medications: [metformin(), { name: 'Atorvastatin', role: 'first_line', dose: '20 mg' }],
    });
    const b = makePathway({ title: 'PCOS', medications: [metformin({ dose: '1000 mg' })] });
    const merged = mergeResolvedCarePlans([a, b]);

    expect(merged.medications.map((m) => m.recommendation.name)).toEqual(['Atorvastatin']);
    expect(merged.conflicts.map((c) => c.conflictId)).toEqual(['regimen:metformin']);
  });

  it('suppresses every regimen of a drug another pathway marks AVOID — by drug, not by regimen', () => {
    const a = makePathway({ title: 'CKD 4', medications: [{ name: 'Metformin', role: 'avoid' }] });
    const b = makePathway({ title: 'T2DM', medications: [metformin()] });
    const c = makePathway({ title: 'PCOS', medications: [metformin({ dose: '1000 mg', route: 'PO ER' })] });
    const merged = mergeResolvedCarePlans([a, b, c]);

    expect(merged.medications).toEqual([]);
    expect(merged.conflicts).toEqual([]);
    expect(merged.suppressed).toHaveLength(3);
    const active = merged.suppressed.filter((s) => (s.original as ResolvedMedication).role !== 'avoid');
    expect(active.map((s) => (s.original as ResolvedMedication).dose)).toEqual(['500 mg', '1000 mg']);
    for (const s of active) {
      expect(s.reason).toBe('avoid');
      expect(s.suppressedBy).toEqual({ pathwayId: a.pathwayId, pathwayTitle: 'CKD 4' });
    }
  });

  it('suppresses a CONTRAINDICATED drug even when the flag carries a different regimen', () => {
    const a = makePathway({
      title: 'Pregnancy',
      medications: [{ name: 'Lisinopril', role: 'contraindicated', dose: '10 mg' }],
    });
    const b = makePathway({
      title: 'HTN',
      medications: [{ name: 'lisinopril', role: 'first_line', dose: '40 mg', frequency: 'daily' }],
    });
    const merged = mergeResolvedCarePlans([a, b]);

    expect(merged.medications).toEqual([]);
    expect(merged.conflicts).toEqual([]);
    expect(merged.suppressed.map((s) => s.reason)).toEqual(['contraindicated', 'contraindicated']);
  });

  it('a clinical_role conflict takes EVERY regimen of each drug in the lane — none escapes as auto-included', () => {
    const a = makePathway({ title: 'T2DM', medications: [metformin({ clinicalRole: 'first_line_t2dm' })] });
    const b = makePathway({ title: 'PCOS', medications: [metformin({ dose: '1000 mg' })] }); // untagged
    const c = makePathway({
      title: 'T2DM + ASCVD',
      medications: [{ name: 'Empagliflozin', role: 'first_line', dose: '10 mg', clinicalRole: 'first_line_t2dm' }],
    });
    const merged = mergeResolvedCarePlans([a, b, c]);

    expect(merged.medications).toEqual([]);
    expect(merged.conflicts).toHaveLength(1);
    const conflict = merged.conflicts[0];
    expect(conflict.type).toBe('medication');
    expect(conflict.conflictId).toBe('first_line_t2dm');
    expect(conflict.clinicalRole).toBe('first_line_t2dm');
    expect(
      conflict.candidates.map((x) => `${x.recommendation.name} ${x.recommendation.dose}`),
    ).toEqual(['Metformin 500 mg', 'Metformin 1000 mg', 'Empagliflozin 10 mg']);
  });

  it('two different drugs sharing a clinical_role still conflict exactly as before', () => {
    const a = makePathway({
      title: 'AF',
      medications: [{ name: 'Metoprolol', role: 'first_line', dose: '25 mg', clinicalRole: 'bb' }],
    });
    const b = makePathway({
      title: 'HFrEF',
      medications: [{ name: 'Carvedilol', role: 'first_line', dose: '3.125 mg', clinicalRole: 'bb' }],
    });
    const merged = mergeResolvedCarePlans([a, b]);

    expect(merged.medications).toEqual([]);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0]).toMatchObject({
      conflictId: 'bb',
      type: 'medication',
      clinicalRole: 'bb',
      resolution: null,
    });
    expect(merged.conflicts[0].candidates.map((c) => [c.recommendation.name, c.sourcePathwayId])).toEqual([
      ['Metoprolol', a.pathwayId],
      ['Carvedilol', b.pathwayId],
    ]);
  });
});
