import { buildCodeMap, loadAttributeCodeMap } from '../services/resolution/attribute-code-map';
import { AttributeCodeEntry } from '../services/resolution/types';

const rows: AttributeCodeEntry[] = [
  { attributeName: 'lab.hemoglobin', namespace: 'lab', system: 'LOINC', code: '718-7', valueType: 'number' },
];

describe('buildCodeMap', () => {
  it('keys entries by full attribute name', () => {
    const map = buildCodeMap(rows);
    expect(map.get('lab.hemoglobin')?.code).toBe('718-7');
    expect(map.get('lab.unknown')).toBeUndefined();
  });
});

describe('loadAttributeCodeMap', () => {
  it('reads the table on every call, so a new row is visible without a restart', async () => {
    const row = (name: string) => ({ attribute_name: name, namespace: 'lab', system: 'LOINC', code: '1-1', value_type: 'number' });
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [row('lab.hemoglobin')] })
      .mockResolvedValueOnce({ rows: [row('lab.hemoglobin'), row('lab.mcv')] });
    const pool = { query } as never;
    expect([...(await loadAttributeCodeMap(pool)).keys()]).toEqual(['lab.hemoglobin']);
    expect([...(await loadAttributeCodeMap(pool)).keys()]).toEqual(['lab.hemoglobin', 'lab.mcv']);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
