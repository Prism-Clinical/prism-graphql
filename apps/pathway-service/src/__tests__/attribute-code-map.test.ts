import { buildCodeMap } from '../services/resolution/attribute-code-map';
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
