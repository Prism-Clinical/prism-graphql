/**
 * count_in_window operator on patient_attribute gates — recurrence
 * pattern. Covers labs (LabResult.date) and code buckets (CodeEntry.date),
 * default-threshold behavior, window boundary semantics, missing dates,
 * mixed code systems, and the "no window = lifetime count" path.
 *
 * Clock is pinned to a fixed `now` so window-boundary tests are
 * deterministic across timezones and CI runs.
 */

import { evaluateGate } from '../services/resolution/gate-evaluator';
import { GateType } from '../services/resolution/types';
import type { PatientContext } from '../services/confidence/types';

// 2026-06-27T00:00:00Z — pinned for boundary determinism.
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

describe('count_in_window operator', () => {
  describe('on the conditions bucket', () => {
    it('flags ≥2 recurrent UTIs in 6 months as satisfied (default threshold)', async () => {
      const result = await evaluateGate(
        {
          gate_type: GateType.PATIENT_ATTRIBUTE,
          title: 'Recurrent UTI',
          default_behavior: 'skip',
          condition: {
            field: 'conditions',
            operator: 'count_in_window',
            value: 'N39.0',
            system: 'ICD-10',
            window_days: 180,
          },
        },
        ctx({
          conditionCodes: [
            { code: 'N39.0', system: 'ICD-10', date: daysAgo(10) },
            { code: 'N39.0', system: 'ICD-10', date: daysAgo(90) },
          ],
        }),
        new Map(),
        new Map(),
        undefined,
        undefined,
        NOW,
      );
      expect(result.satisfied).toBe(true);
      expect(result.reason).toMatch(/Found 2 matching N39\.0/);
      expect(result.reason).toMatch(/last 180 days/);
    });

    it('does NOT fire with just one match (default threshold = 2)', async () => {
      const result = await evaluateGate(
        {
          gate_type: GateType.PATIENT_ATTRIBUTE,
          title: 'Recurrent UTI',
          default_behavior: 'skip',
          condition: {
            field: 'conditions',
            operator: 'count_in_window',
            value: 'N39.0',
            system: 'ICD-10',
            window_days: 180,
          },
        },
        ctx({
          conditionCodes: [{ code: 'N39.0', system: 'ICD-10', date: daysAgo(10) }],
        }),
        new Map(),
        new Map(),
        undefined,
        undefined,
        NOW,
      );
      expect(result.satisfied).toBe(false);
      expect(result.reason).toMatch(/Found 1 matching/);
    });

    it('respects custom count_threshold (≥3 ED visits in 90 days)', async () => {
      const condition = {
        field: 'conditions',
        operator: 'count_in_window',
        value: 'Z76.2',
        system: 'ICD-10',
        window_days: 90,
        count_threshold: 3,
      };
      const baseGate = {
        gate_type: GateType.PATIENT_ATTRIBUTE,
        title: 'Repeat ED visits',
        default_behavior: 'skip',
        condition,
      };

      // 2 in window — under threshold
      const two = await evaluateGate(
        baseGate,
        ctx({
          conditionCodes: [
            { code: 'Z76.2', system: 'ICD-10', date: daysAgo(5) },
            { code: 'Z76.2', system: 'ICD-10', date: daysAgo(40) },
          ],
        }),
        new Map(),
        new Map(),
        undefined,
        undefined,
        NOW,
      );
      expect(two.satisfied).toBe(false);

      // 3 in window — exactly threshold
      const three = await evaluateGate(
        baseGate,
        ctx({
          conditionCodes: [
            { code: 'Z76.2', system: 'ICD-10', date: daysAgo(5) },
            { code: 'Z76.2', system: 'ICD-10', date: daysAgo(40) },
            { code: 'Z76.2', system: 'ICD-10', date: daysAgo(80) },
          ],
        }),
        new Map(),
        new Map(),
        undefined,
        undefined,
        NOW,
      );
      expect(three.satisfied).toBe(true);
    });

    it('excludes occurrences outside the window', async () => {
      // 3 matches but one is ancient — only 2 in the 180-day window.
      const result = await evaluateGate(
        {
          gate_type: GateType.PATIENT_ATTRIBUTE,
          title: 'Recurrent UTI (180d)',
          default_behavior: 'skip',
          condition: {
            field: 'conditions',
            operator: 'count_in_window',
            value: 'N39.0',
            system: 'ICD-10',
            window_days: 180,
            count_threshold: 3,
          },
        },
        ctx({
          conditionCodes: [
            { code: 'N39.0', system: 'ICD-10', date: daysAgo(30) },
            { code: 'N39.0', system: 'ICD-10', date: daysAgo(120) },
            { code: 'N39.0', system: 'ICD-10', date: daysAgo(400) },
          ],
        }),
        new Map(),
        new Map(),
        undefined,
        undefined,
        NOW,
      );
      expect(result.satisfied).toBe(false);
      expect(result.reason).toMatch(/Found 2 matching/);
    });

    it('skips entries with no date when a window is specified', async () => {
      // window_days set → date-less entries can't be reasoned about
      // → excluded. With 3 total entries (one un-dated), only 1 counts.
      const result = await evaluateGate(
        {
          gate_type: GateType.PATIENT_ATTRIBUTE,
          title: 'Recurrent UTI',
          default_behavior: 'skip',
          condition: {
            field: 'conditions',
            operator: 'count_in_window',
            value: 'N39.0',
            system: 'ICD-10',
            window_days: 180,
          },
        },
        ctx({
          conditionCodes: [
            { code: 'N39.0', system: 'ICD-10', date: daysAgo(10) },
            { code: 'N39.0', system: 'ICD-10' }, // no date — skipped
            { code: 'N39.0', system: 'ICD-10', date: daysAgo(400) }, // out of window
          ],
        }),
        new Map(),
        new Map(),
        undefined,
        undefined,
        NOW,
      );
      expect(result.satisfied).toBe(false);
    });

    it('counts all matching entries when no window is set ("lifetime")', async () => {
      // Same data as the previous test, but no window_days → un-dated and
      // ancient entries all count. 3 ≥ default threshold of 2 → fires.
      const result = await evaluateGate(
        {
          gate_type: GateType.PATIENT_ATTRIBUTE,
          title: 'Ever had ≥2 UTIs',
          default_behavior: 'skip',
          condition: {
            field: 'conditions',
            operator: 'count_in_window',
            value: 'N39.0',
            system: 'ICD-10',
          },
        },
        ctx({
          conditionCodes: [
            { code: 'N39.0', system: 'ICD-10', date: daysAgo(10) },
            { code: 'N39.0', system: 'ICD-10' },
            { code: 'N39.0', system: 'ICD-10', date: daysAgo(400) },
          ],
        }),
        new Map(),
        new Map(),
        undefined,
        undefined,
        NOW,
      );
      expect(result.satisfied).toBe(true);
      expect(result.reason).toMatch(/lifetime/);
    });

    it('respects the system filter when set', async () => {
      // Two matches on N39.0 ICD-10, plus an unrelated SNOMED code that
      // happens to share the value. System filter must exclude the SNOMED one.
      const result = await evaluateGate(
        {
          gate_type: GateType.PATIENT_ATTRIBUTE,
          title: 'ICD-10 UTI only',
          default_behavior: 'skip',
          condition: {
            field: 'conditions',
            operator: 'count_in_window',
            value: 'N39.0',
            system: 'ICD-10',
          },
        },
        ctx({
          conditionCodes: [
            { code: 'N39.0', system: 'ICD-10' },
            { code: 'N39.0', system: 'SNOMED' },
          ],
        }),
        new Map(),
        new Map(),
        undefined,
        undefined,
        NOW,
      );
      expect(result.satisfied).toBe(false); // only 1 in ICD-10
    });
  });

  describe('on the labs bucket', () => {
    it('counts repeat abnormal lab values in a window', async () => {
      const result = await evaluateGate(
        {
          gate_type: GateType.PATIENT_ATTRIBUTE,
          title: '≥3 elevated A1c readings in last year',
          default_behavior: 'skip',
          condition: {
            field: 'labs',
            operator: 'count_in_window',
            value: '4548-4',
            system: 'LOINC',
            window_days: 365,
            count_threshold: 3,
          },
        },
        ctx({
          labResults: [
            { code: '4548-4', system: 'LOINC', value: 7.8, date: daysAgo(30) },
            { code: '4548-4', system: 'LOINC', value: 8.1, date: daysAgo(150) },
            { code: '4548-4', system: 'LOINC', value: 7.5, date: daysAgo(310) },
            { code: '4548-4', system: 'LOINC', value: 6.2, date: daysAgo(400) }, // out of window
          ],
        }),
        new Map(),
        new Map(),
        undefined,
        undefined,
        NOW,
      );
      expect(result.satisfied).toBe(true);
      expect(result.reason).toMatch(/Found 3 matching/);
    });
  });

  describe('boundary behavior', () => {
    it('treats entries exactly at the window edge as inside', async () => {
      // entry at exactly window_days ago should count.
      const result = await evaluateGate(
        {
          gate_type: GateType.PATIENT_ATTRIBUTE,
          title: 'Edge test',
          default_behavior: 'skip',
          condition: {
            field: 'conditions',
            operator: 'count_in_window',
            value: 'X',
            system: 'ICD-10',
            window_days: 30,
          },
        },
        ctx({
          conditionCodes: [
            { code: 'X', system: 'ICD-10', date: daysAgo(30) },
            { code: 'X', system: 'ICD-10', date: daysAgo(0) },
          ],
        }),
        new Map(),
        new Map(),
        undefined,
        undefined,
        NOW,
      );
      expect(result.satisfied).toBe(true); // both inside ≤ 30
    });

    it('ignores future-dated entries even within window', async () => {
      // Defensive: don't let a clock-skewed snapshot accidentally satisfy
      // a recurrence gate with future dates.
      const result = await evaluateGate(
        {
          gate_type: GateType.PATIENT_ATTRIBUTE,
          title: 'No future dates',
          default_behavior: 'skip',
          condition: {
            field: 'conditions',
            operator: 'count_in_window',
            value: 'X',
            system: 'ICD-10',
            window_days: 365,
          },
        },
        ctx({
          conditionCodes: [
            { code: 'X', system: 'ICD-10', date: new Date(NOW + 86_400_000).toISOString() },
            { code: 'X', system: 'ICD-10', date: new Date(NOW + 2 * 86_400_000).toISOString() },
          ],
        }),
        new Map(),
        new Map(),
        undefined,
        undefined,
        NOW,
      );
      expect(result.satisfied).toBe(false);
    });
  });
});
