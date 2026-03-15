import { buildCypherQuery } from '../services/age-client';

describe('buildCypherQuery', () => {
  it('should wrap cypher in SELECT FROM cypher() call', () => {
    const result = buildCypherQuery(
      'clinical_pathways',
      'MATCH (p:Pathway) RETURN p',
      '(v agtype)'
    );
    expect(result).toBe(
      "SELECT * FROM cypher('clinical_pathways', $$ MATCH (p:Pathway) RETURN p $$) AS (v agtype)"
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
});
