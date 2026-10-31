/**
 * EXPERIMENTAL, NONCLINICAL. The RFC 8785 library behind payload identity, checked against the
 * RFC itself (Appendix B number vectors, §3.2.3 sample) and against member names that have a
 * special meaning in JavaScript. Expected strings are copied from RFC 8785, not from library output.
 */
import { canonicalJson } from '../s1/payload';
import type { JsonValue } from '../s1/types';

// RFC 8785 Appendix B: IEEE 754 bit pattern → serialization.
const APPENDIX_B: [string, string][] = [
  ['0000000000000000', '0'], ['8000000000000000', '0'], ['0000000000000001', '5e-324'],
  ['8000000000000001', '-5e-324'], ['7fefffffffffffff', '1.7976931348623157e+308'],
  ['ffefffffffffffff', '-1.7976931348623157e+308'], ['4340000000000000', '9007199254740992'],
  ['c340000000000000', '-9007199254740992'], ['4430000000000000', '295147905179352830000'],
  ['44b52d02c7e14af5', '9.999999999999997e+22'], ['44b52d02c7e14af6', '1e+23'],
  ['44b52d02c7e14af7', '1.0000000000000001e+23'], ['444b1ae4d6e2ef4e', '999999999999999700000'],
  ['444b1ae4d6e2ef4f', '999999999999999900000'], ['444b1ae4d6e2ef50', '1e+21'],
  ['3eb0c6f7a0b5ed8c', '9.999999999999997e-7'], ['3eb0c6f7a0b5ed8d', '0.000001'],
  ['41b3de4355555553', '333333333.3333332'], ['41b3de4355555554', '333333333.33333325'],
  ['41b3de4355555555', '333333333.3333333'], ['41b3de4355555556', '333333333.3333334'],
  ['41b3de4355555557', '333333333.33333343'], ['becbf647612f3696', '-0.0000033333333333333333'],
  ['43143ff3c1cb0959', '1424953923781206.2'],
];

describe('canonicalJson (RFC 8785 library)', () => {
  it.each(APPENDIX_B)('Appendix B %s → %s', (bits, expected) => {
    expect(canonicalJson(Buffer.from(bits, 'hex').readDoubleBE(0))).toBe(expected);
  });

  it('§3.2.3 sample', () => {
    const input = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],' +
        '"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}',
    ) as JsonValue;
    expect(canonicalJson(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it.each(['toJSON', '__proto__', 'constructor'])('a member named %s is ordinary: member order never changes the bytes', (name) => {
    const a = JSON.parse(`{${JSON.stringify(name)}:{"y":1,"x":2},"b":1,"a":2}`) as JsonValue;
    const b = JSON.parse(`{"a":2,"b":1,${JSON.stringify(name)}:{"x":2,"y":1}}`) as JsonValue;
    const expected = [`"a":2`, `"b":1`, `${JSON.stringify(name)}:{"x":2,"y":1}`]
      .sort((p, q) => (p < q ? -1 : 1))
      .join(',');
    expect(canonicalJson(a)).toBe(`{${expected}}`);
    expect(canonicalJson(b)).toBe(`{${expected}}`);
  });
});
