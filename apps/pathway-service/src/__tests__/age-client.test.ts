import { buildCypherQuery } from '../services/age-client';

describe('buildCypherQuery', () => {
  it('should wrap cypher in SELECT FROM cypher() call with tagged dollar quoting', () => {
    const result = buildCypherQuery(
      'clinical_pathways',
      'MATCH (p:Pathway) RETURN p',
      '(v agtype)'
    );
    // Uses tagged dollar quoting: $cypher_<hex>$ instead of plain $$
    expect(result).toMatch(
      /^SELECT \* FROM cypher\('clinical_pathways', \$cypher_[0-9a-f]{8}\$ MATCH \(p:Pathway\) RETURN p \$cypher_[0-9a-f]{8}\$\) AS \(v agtype\)$/
    );
  });

  it('should handle multi-column return types', () => {
    const result = buildCypherQuery(
      'clinical_pathways',
      'MATCH (p:Pathway)-[:HAS_STAGE]->(s:Stage) RETURN p, s',
      '(p agtype, s agtype)'
    );
    expect(result).toContain('AS (p agtype, s agtype)');
  });

  it('should use default graph name when not specified', () => {
    const result = buildCypherQuery(
      undefined,
      'CREATE (n:Test {id: 1}) RETURN n',
      '(v agtype)'
    );
    expect(result).toContain("cypher('clinical_pathways'");
  });

  it('should reject invalid graph names', () => {
    expect(() =>
      buildCypherQuery('malicious_graph; DROP TABLE users', 'RETURN 1', '(v agtype)')
    ).toThrow('Invalid graph name');
  });

  it('should reject invalid returnType format', () => {
    expect(() =>
      buildCypherQuery('clinical_pathways', 'RETURN 1', '(v agtype); DROP TABLE users--')
    ).toThrow('Invalid returnType format');
  });

  it('should use unique tags per call to prevent $$ injection', () => {
    const result1 = buildCypherQuery(undefined, 'RETURN 1', '(v agtype)');
    const result2 = buildCypherQuery(undefined, 'RETURN 1', '(v agtype)');
    // Tags should be different between calls
    const tag1 = result1.match(/\$cypher_[0-9a-f]{8}\$/)?.[0];
    const tag2 = result2.match(/\$cypher_[0-9a-f]{8}\$/)?.[0];
    expect(tag1).toBeDefined();
    expect(tag2).toBeDefined();
    expect(tag1).not.toBe(tag2);
  });

  it('should safely handle cypher containing $$ sequences', () => {
    // If a property value contained $$, the old plain $$ quoting would break.
    // Tagged quoting prevents this.
    const cypher = "CREATE (n:Test {val: 'contains $$ dangerous'}) RETURN n";
    const result = buildCypherQuery(undefined, cypher, '(v agtype)');
    // The cypher string should appear intact inside the tagged quotes
    expect(result).toContain(cypher);
    // The dollar-quote delimiters should be tagged, not plain $$
    expect(result).toMatch(/\$cypher_[0-9a-f]{8}\$/);
  });
});
