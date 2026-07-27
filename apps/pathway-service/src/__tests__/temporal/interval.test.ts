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
