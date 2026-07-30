import { parseFhirDate, boundEpochRange, instantEpoch } from '../../services/resolution/temporal/interval';

test('accepts each valid FHIR precision', () => {
  expect(parseFhirDate('2026')).toEqual({ value: '2026', precision: 'year' });
  expect(parseFhirDate('2026-03')).toEqual({ value: '2026-03', precision: 'month' });
  expect(parseFhirDate('2026-03-14')).toEqual({ value: '2026-03-14', precision: 'day' });
  expect(parseFhirDate('2026-03-14T09:30:00Z')).toEqual({ value: '2026-03-14T09:30:00Z', precision: 'instant' });
  expect(parseFhirDate('2026-03-14T09:30:00+02:00')).toEqual({ value: '2026-03-14T09:30:00+02:00', precision: 'instant' });
});

test('rejects impossible calendar values', () => {
  expect(parseFhirDate('2026-13')).toBeNull();
  expect(parseFhirDate('2026-00')).toBeNull();
  expect(parseFhirDate('2026-02-31')).toBeNull();
  expect(parseFhirDate('2025-02-29')).toBeNull(); // not a leap year
  expect(parseFhirDate('2024-02-29')).toEqual({ value: '2024-02-29', precision: 'day' }); // leap year OK
});

test('rejects non-FHIR forms', () => {
  expect(parseFhirDate('2026-03-14T09:30:00')).toBeNull(); // no timezone
  expect(parseFhirDate(' 2026-03-14 ')).toBeNull(); // whitespace
  expect(parseFhirDate('03/14/2026')).toBeNull(); // locale form
  expect(parseFhirDate(null)).toBeNull();
  expect(parseFhirDate('')).toBeNull();
});

test('boundEpochRange spans precision inclusively', () => {
  const y = boundEpochRange({ value: '2026', precision: 'year' });
  expect(y.loMs).toBe(Date.UTC(2026, 0, 1, 0, 0, 0, 0));
  expect(y.hiMs).toBe(Date.UTC(2026, 11, 31, 23, 59, 59, 999));
  const feb = boundEpochRange({ value: '2024-02', precision: 'month' });
  expect(feb.hiMs).toBe(Date.UTC(2024, 1, 29, 23, 59, 59, 999)); // leap Feb → 29 days
  const day = boundEpochRange({ value: '2026-03-14', precision: 'day' });
  expect(day.loMs).toBe(Date.UTC(2026, 2, 14, 0, 0, 0, 0));
  expect(day.hiMs).toBe(Date.UTC(2026, 2, 14, 23, 59, 59, 999));
});

test('instantEpoch parses a full instant and rejects non-instants', () => {
  expect(instantEpoch('2026-03-14T00:00:00Z')).toBe(Date.UTC(2026, 2, 14, 0, 0, 0, 0));
  expect(() => instantEpoch('2026-03-14')).toThrow();
});

test('boundEpochRange throws on an invalid hand-built bound', () => {
  expect(() => boundEpochRange({ value: '2026-13', precision: 'month' })).toThrow();
});

// ─── Strict FHIR R4 grammar (review round 4) ──────────────────────────
// The previous regex delegated component validation to Date.parse, which
// silently normalizes out-of-range values instead of rejecting them.

test('rejects year zero — FHIR R4 allows 0001-9999', () => {
  expect(parseFhirDate('0000')).toBeNull();
  expect(parseFhirDate('0000-01')).toBeNull();
  expect(parseFhirDate('0000-01-01')).toBeNull();
  expect(parseFhirDate('0000-01-01T00:00:00Z')).toBeNull();
  expect(parseFhirDate('0001')).toEqual({ value: '0001', precision: 'year' });
});

test('rejects hour 24 rather than rolling it into the next day', () => {
  expect(parseFhirDate('2026-01-01T24:00:00Z')).toBeNull();
  expect(parseFhirDate('2026-01-01T23:59:59Z')).toEqual({
    value: '2026-01-01T23:59:59Z',
    precision: 'instant',
  });
});

test('rejects out-of-range minutes and seconds', () => {
  expect(parseFhirDate('2026-01-01T12:60:00Z')).toBeNull();
  expect(parseFhirDate('2026-01-01T12:00:61Z')).toBeNull();
  expect(parseFhirDate('2026-01-01T12:00:59Z')).toEqual({
    value: '2026-01-01T12:00:59Z',
    precision: 'instant',
  });
});

test('rejects the FHIR leap second rather than normalizing it away', () => {
  // Documented narrowing of the FHIR grammar: ECMAScript cannot represent
  // :60, and clamping or rolling it would be the silent normalization this
  // parser exists to prevent. See validTime() in interval.ts.
  expect(parseFhirDate('2026-01-01T12:00:60Z')).toBeNull();
});

test('bounds timezone offsets to the FHIR R4 range of ±14:00', () => {
  expect(parseFhirDate('2026-01-01T23:59:59+15:00')).toBeNull();
  expect(parseFhirDate('2026-01-01T23:59:59+14:01')).toBeNull();
  expect(parseFhirDate('2026-01-01T23:59:59-14:01')).toBeNull();
  expect(parseFhirDate('2026-01-01T23:59:59+14:00')).toEqual({
    value: '2026-01-01T23:59:59+14:00',
    precision: 'instant',
  });
  expect(parseFhirDate('2026-01-01T23:59:59-13:59')).toEqual({
    value: '2026-01-01T23:59:59-13:59',
    precision: 'instant',
  });
});

test('low years are not shifted ~1900 years by the Date.UTC(0-99) trap', () => {
  const y = boundEpochRange({ value: '0001', precision: 'year' });
  expect(new Date(y.loMs).toISOString()).toBe('0001-01-01T00:00:00.000Z');
  expect(new Date(y.hiMs).toISOString()).toBe('0001-12-31T23:59:59.999Z');

  const d = boundEpochRange({ value: '0099-06-15', precision: 'day' });
  expect(new Date(d.loMs).toISOString()).toBe('0099-06-15T00:00:00.000Z');

  const m = boundEpochRange({ value: '0050-02', precision: 'month' });
  expect(new Date(m.hiMs).toISOString()).toBe('0050-02-28T23:59:59.999Z');
});
