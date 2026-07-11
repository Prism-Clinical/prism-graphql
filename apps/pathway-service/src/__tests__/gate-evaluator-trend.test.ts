/**
 * Time-shape operators on patient_attribute gates: trend_up, trend_down,
 * delta_from_baseline. Clock pinned so window math and timestamp parsing
 * are deterministic across timezones and CI runs.
 */

import { evaluateGate } from '../services/resolution/gate-evaluator';
import { GateType } from '../services/resolution/types';
import type { PatientContext } from '../services/confidence/types';

const NOW = Date.parse('2026-06-27T00:00:00Z');

function daysAgo(n: number): string {
  return new Date(NOW - n * 86_400_000).toISOString();
}

function ctx(overrides: Partial<PatientContext> = {}): PatientContext {
  return {
    patientId: 'pt-test',
    conditionCodes: [],
    medications: [],
    labResults: [],
    allergies: [],
    ...overrides,
  };
}

async function run(condition: Record<string, unknown>, c: PatientContext) {
  return evaluateGate(
    {
      gate_type: GateType.PATIENT_ATTRIBUTE,
      title: 'time-shape test',
      default_behavior: 'skip',
      condition: condition as never,
    },
    c,
    new Map(),
    new Map(),
    undefined,
    undefined,
    NOW,
  );
}

describe('trend_up', () => {
  it('fires on a strictly ascending HbA1c series within window', async () => {
    const r = await run(
      {
        field: 'labs',
        operator: 'trend_up',
        value: '4548-4',
        system: 'LOINC',
        window_days: 365,
      },
      ctx({
        labResults: [
          { code: '4548-4', system: 'LOINC', value: 7.0, date: daysAgo(300) },
          { code: '4548-4', system: 'LOINC', value: 7.4, date: daysAgo(180) },
          { code: '4548-4', system: 'LOINC', value: 7.9, date: daysAgo(60) },
        ],
      }),
    );
    expect(r.satisfied).toBe(true);
    expect(r.reason).toMatch(/slope/);
  });

  it('does NOT fire on a flat series', async () => {
    const r = await run(
      {
        field: 'labs',
        operator: 'trend_up',
        value: '4548-4',
        system: 'LOINC',
      },
      ctx({
        labResults: [
          { code: '4548-4', system: 'LOINC', value: 7.0, date: daysAgo(300) },
          { code: '4548-4', system: 'LOINC', value: 7.0, date: daysAgo(180) },
          { code: '4548-4', system: 'LOINC', value: 7.0, date: daysAgo(60) },
        ],
      }),
    );
    expect(r.satisfied).toBe(false);
  });

  it('does NOT fire on a descending series', async () => {
    const r = await run(
      { field: 'labs', operator: 'trend_up', value: '4548-4', system: 'LOINC' },
      ctx({
        labResults: [
          { code: '4548-4', system: 'LOINC', value: 8.0, date: daysAgo(300) },
          { code: '4548-4', system: 'LOINC', value: 7.5, date: daysAgo(180) },
          { code: '4548-4', system: 'LOINC', value: 7.0, date: daysAgo(60) },
        ],
      }),
    );
    expect(r.satisfied).toBe(false);
  });

  it('respects slope_threshold (rejects shallow drifts)', async () => {
    // ~0.001 value/day — real but slow.
    const r = await run(
      {
        field: 'labs',
        operator: 'trend_up',
        value: '4548-4',
        system: 'LOINC',
        slope_threshold: 0.01,
      },
      ctx({
        labResults: [
          { code: '4548-4', system: 'LOINC', value: 7.0, date: daysAgo(300) },
          { code: '4548-4', system: 'LOINC', value: 7.1, date: daysAgo(200) },
          { code: '4548-4', system: 'LOINC', value: 7.2, date: daysAgo(100) },
        ],
      }),
    );
    expect(r.satisfied).toBe(false);
  });

  it('requires min_points', async () => {
    const r = await run(
      {
        field: 'labs',
        operator: 'trend_up',
        value: '4548-4',
        system: 'LOINC',
        min_points: 4,
      },
      ctx({
        labResults: [
          { code: '4548-4', system: 'LOINC', value: 7.0, date: daysAgo(200) },
          { code: '4548-4', system: 'LOINC', value: 7.5, date: daysAgo(100) },
          { code: '4548-4', system: 'LOINC', value: 8.0, date: daysAgo(50) },
        ],
      }),
    );
    expect(r.satisfied).toBe(false);
    expect(r.reason).toMatch(/Need ≥4/);
  });

  it('excludes out-of-window points before computing slope', async () => {
    // Within last 90d only the last two points exist. min_points default 3
    // → not enough in-window data to assert a trend.
    const r = await run(
      {
        field: 'labs',
        operator: 'trend_up',
        value: '4548-4',
        system: 'LOINC',
        window_days: 90,
      },
      ctx({
        labResults: [
          { code: '4548-4', system: 'LOINC', value: 7.0, date: daysAgo(300) },
          { code: '4548-4', system: 'LOINC', value: 7.5, date: daysAgo(60) },
          { code: '4548-4', system: 'LOINC', value: 8.0, date: daysAgo(30) },
        ],
      }),
    );
    expect(r.satisfied).toBe(false);
    expect(r.reason).toMatch(/found 2/);
  });

  it('refuses non-labs fields', async () => {
    const r = await run(
      {
        field: 'conditions',
        operator: 'trend_up',
        value: 'I10',
        system: 'ICD-10',
      },
      ctx({ conditionCodes: [{ code: 'I10', system: 'ICD-10' }] }),
    );
    expect(r.satisfied).toBe(false);
    expect(r.reason).toMatch(/only supports field=labs/);
  });
});

describe('trend_down', () => {
  it('fires on a strictly descending series', async () => {
    const r = await run(
      { field: 'labs', operator: 'trend_down', value: '8462-4', system: 'LOINC' },
      ctx({
        labResults: [
          { code: '8462-4', system: 'LOINC', value: 95, date: daysAgo(180) },
          { code: '8462-4', system: 'LOINC', value: 88, date: daysAgo(90) },
          { code: '8462-4', system: 'LOINC', value: 80, date: daysAgo(30) },
        ],
      }),
    );
    expect(r.satisfied).toBe(true);
  });

  it('does NOT fire on an ascending series', async () => {
    const r = await run(
      { field: 'labs', operator: 'trend_down', value: '8462-4', system: 'LOINC' },
      ctx({
        labResults: [
          { code: '8462-4', system: 'LOINC', value: 80, date: daysAgo(180) },
          { code: '8462-4', system: 'LOINC', value: 88, date: daysAgo(90) },
          { code: '8462-4', system: 'LOINC', value: 95, date: daysAgo(30) },
        ],
      }),
    );
    expect(r.satisfied).toBe(false);
  });
});

describe('delta_from_baseline', () => {
  it('fires when the rise exceeds a positive threshold', async () => {
    // Baseline 7.0 → current 8.5 → delta 1.5 satisfies ≥ 1.0.
    const r = await run(
      {
        field: 'labs',
        operator: 'delta_from_baseline',
        value: '4548-4',
        system: 'LOINC',
        delta_threshold: 1.0,
      },
      ctx({
        labResults: [
          { code: '4548-4', system: 'LOINC', value: 7.0, date: daysAgo(200) },
          { code: '4548-4', system: 'LOINC', value: 8.5, date: daysAgo(30) },
        ],
      }),
    );
    expect(r.satisfied).toBe(true);
  });

  it('does NOT fire when the rise is below the threshold', async () => {
    const r = await run(
      {
        field: 'labs',
        operator: 'delta_from_baseline',
        value: '4548-4',
        system: 'LOINC',
        delta_threshold: 1.0,
      },
      ctx({
        labResults: [
          { code: '4548-4', system: 'LOINC', value: 7.0, date: daysAgo(200) },
          { code: '4548-4', system: 'LOINC', value: 7.5, date: daysAgo(30) },
        ],
      }),
    );
    expect(r.satisfied).toBe(false);
  });

  it('fires when the drop exceeds a negative threshold ("BP fell ≥10")', async () => {
    // Baseline 150 → current 138 → delta -12 satisfies ≤ -10.
    const r = await run(
      {
        field: 'labs',
        operator: 'delta_from_baseline',
        value: '8480-6',
        system: 'LOINC',
        delta_threshold: -10,
      },
      ctx({
        labResults: [
          { code: '8480-6', system: 'LOINC', value: 150, date: daysAgo(120) },
          { code: '8480-6', system: 'LOINC', value: 138, date: daysAgo(10) },
        ],
      }),
    );
    expect(r.satisfied).toBe(true);
  });

  it('does NOT fire when the change is in the wrong direction', async () => {
    // Asking for ≥10 drop, but value rose. Should fail.
    const r = await run(
      {
        field: 'labs',
        operator: 'delta_from_baseline',
        value: '8480-6',
        system: 'LOINC',
        delta_threshold: -10,
      },
      ctx({
        labResults: [
          { code: '8480-6', system: 'LOINC', value: 130, date: daysAgo(120) },
          { code: '8480-6', system: 'LOINC', value: 145, date: daysAgo(10) },
        ],
      }),
    );
    expect(r.satisfied).toBe(false);
  });

  it('uses in-window oldest as baseline, not the all-time oldest', async () => {
    // Out-of-window ancient point would yield delta of +2.5 if used as
    // baseline; in-window oldest (7.5) yields +1.0. With threshold 2,
    // in-window baseline should yield NOT satisfied.
    const r = await run(
      {
        field: 'labs',
        operator: 'delta_from_baseline',
        value: '4548-4',
        system: 'LOINC',
        window_days: 180,
        delta_threshold: 2,
      },
      ctx({
        labResults: [
          { code: '4548-4', system: 'LOINC', value: 6.0, date: daysAgo(400) },
          { code: '4548-4', system: 'LOINC', value: 7.5, date: daysAgo(150) },
          { code: '4548-4', system: 'LOINC', value: 8.5, date: daysAgo(10) },
        ],
      }),
    );
    expect(r.satisfied).toBe(false);
    expect(r.reason).toMatch(/baseline 7\.5/);
  });

  it('zero threshold means "any non-flat change"', async () => {
    const r = await run(
      {
        field: 'labs',
        operator: 'delta_from_baseline',
        value: '4548-4',
        system: 'LOINC',
        delta_threshold: 0,
      },
      ctx({
        labResults: [
          { code: '4548-4', system: 'LOINC', value: 7.0, date: daysAgo(100) },
          { code: '4548-4', system: 'LOINC', value: 7.0, date: daysAgo(10) },
        ],
      }),
    );
    expect(r.satisfied).toBe(false); // flat
  });
});
