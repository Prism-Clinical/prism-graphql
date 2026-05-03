import {
  isConditionActive,
  activeConditionPredicate,
} from '../services/snapshot/active-context-filter';

function row(opts: {
  abatement?: string | null;
  status?: unknown;
}) {
  return {
    abatement_date_time: opts.abatement ?? null,
    clinical_status: opts.status ?? null,
  };
}

function statusWith(...codes: string[]) {
  return { coding: codes.map((code) => ({ code })) };
}

describe('isConditionActive — abatement', () => {
  it('returns false when abatement_date_time is set, regardless of clinical_status', () => {
    expect(isConditionActive(row({ abatement: '2020-01-01', status: statusWith('active') }))).toBe(
      false,
    );
  });

  it('returns false for any non-empty abatement string', () => {
    expect(isConditionActive(row({ abatement: '2030-12-31' }))).toBe(false);
    expect(isConditionActive(row({ abatement: 'unknown-format' }))).toBe(false);
  });

  it('treats null/undefined abatement as not-abated', () => {
    expect(isConditionActive(row({ abatement: null, status: statusWith('active') }))).toBe(true);
    expect(isConditionActive({ abatement_date_time: undefined, clinical_status: statusWith('active') })).toBe(true);
  });
});

describe('isConditionActive — clinical_status null/empty', () => {
  it('returns true when clinical_status is null (fail-safe)', () => {
    expect(isConditionActive(row({ status: null }))).toBe(true);
  });

  it('returns true when clinical_status is an empty object', () => {
    expect(isConditionActive(row({ status: {} }))).toBe(true);
  });

  it('returns true when coding is missing', () => {
    expect(isConditionActive(row({ status: { text: 'Active' } }))).toBe(true);
  });

  it('returns true when coding is empty array', () => {
    expect(isConditionActive(row({ status: { coding: [] } }))).toBe(true);
  });

  it('returns true when clinical_status is non-object garbage (fail-safe)', () => {
    expect(isConditionActive(row({ status: 'active' }))).toBe(true);
    expect(isConditionActive(row({ status: 42 }))).toBe(true);
    expect(isConditionActive(row({ status: true }))).toBe(true);
  });
});

describe('isConditionActive — active-family codes', () => {
  it.each([['active'], ['recurrence'], ['relapse']])(
    '%s → active',
    (code) => {
      expect(isConditionActive(row({ status: statusWith(code) }))).toBe(true);
    },
  );

  it.each([['resolved'], ['inactive'], ['remission']])(
    '%s → not active',
    (code) => {
      expect(isConditionActive(row({ status: statusWith(code) }))).toBe(false);
    },
  );

  it('unknown codes → not active (strict allowlist)', () => {
    expect(isConditionActive(row({ status: statusWith('unknown') }))).toBe(false);
    expect(isConditionActive(row({ status: statusWith('') }))).toBe(false);
  });
});

describe('isConditionActive — multi-coding', () => {
  it('any active code in the array makes the row active', () => {
    expect(isConditionActive(row({ status: statusWith('inactive', 'active') }))).toBe(true);
    expect(isConditionActive(row({ status: statusWith('resolved', 'recurrence') }))).toBe(true);
  });

  it('all-inactive codes leave the row inactive', () => {
    expect(isConditionActive(row({ status: statusWith('resolved', 'inactive', 'remission') }))).toBe(false);
  });

  it('coding entries without a code field are ignored', () => {
    expect(isConditionActive(row({ status: { coding: [{ display: 'No code' }, { code: 'active' }] } }))).toBe(true);
    expect(isConditionActive(row({ status: { coding: [{ display: 'No code' }] } }))).toBe(false);
  });

  it('non-string code fields are ignored', () => {
    expect(isConditionActive(row({ status: { coding: [{ code: 42 as unknown as string }] } }))).toBe(false);
    expect(isConditionActive(row({ status: { coding: [{ code: null as unknown as string }] } }))).toBe(false);
  });
});

describe('isConditionActive — abatement overrides clinical_status', () => {
  it('abated condition with active clinical_status is still inactive', () => {
    expect(
      isConditionActive(row({ abatement: '2024-06-01', status: statusWith('active') })),
    ).toBe(false);
  });
});

describe('activeConditionPredicate', () => {
  it('returns a non-empty SQL string with the alias substituted', () => {
    const sql = activeConditionPredicate('sc');
    expect(sql).toContain('sc.abatement_date_time IS NULL');
    expect(sql).toContain('sc.clinical_status IS NULL');
    expect(sql).toContain("c->>'code' IN ('active', 'recurrence', 'relapse')");
  });

  it('mirrors the active-code allowlist exactly', () => {
    const sql = activeConditionPredicate('x');
    // Must include all three active codes; must not silently include or omit
    for (const code of ['active', 'recurrence', 'relapse']) {
      expect(sql).toContain(`'${code}'`);
    }
    for (const code of ['resolved', 'inactive', 'remission']) {
      expect(sql).not.toContain(`'${code}'`);
    }
  });

  it('handles different valid aliases', () => {
    expect(activeConditionPredicate('cond')).toContain('cond.abatement_date_time');
    expect(activeConditionPredicate('snapshot_conditions_t1')).toContain(
      'snapshot_conditions_t1.abatement_date_time',
    );
    expect(activeConditionPredicate('_internal')).toContain('_internal.abatement_date_time');
  });

  it('rejects aliases with SQL-injection characters', () => {
    expect(() => activeConditionPredicate("sc; DROP TABLE")).toThrow(/invalid SQL alias/);
    expect(() => activeConditionPredicate('sc.code')).toThrow(/invalid SQL alias/);
    expect(() => activeConditionPredicate("sc' OR '1")).toThrow(/invalid SQL alias/);
    expect(() => activeConditionPredicate('')).toThrow(/invalid SQL alias/);
    expect(() => activeConditionPredicate('1abc')).toThrow(/invalid SQL alias/); // can't start with digit
  });
});
