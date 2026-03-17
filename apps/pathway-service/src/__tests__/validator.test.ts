import { validatePathwayJson } from '../services/import/validator';
import { REFERENCE_PATHWAY, MINIMAL_PATHWAY, clonePathway } from './fixtures/reference-pathway';

describe('validatePathwayJson', () => {
  describe('structural rules', () => {
    it('should pass validation for the reference pathway', () => {
      const result = validatePathwayJson(REFERENCE_PATHWAY);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should pass validation for the minimal pathway', () => {
      const result = validatePathwayJson(MINIMAL_PATHWAY);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    // S1: schema_version required
    it('should reject missing schema_version', () => {
      const pw = clonePathway();
      delete (pw as any).schema_version;
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('schema_version'));
    });

    // S2: pathway metadata required
    it('should reject missing pathway metadata', () => {
      const pw = clonePathway();
      delete (pw as any).pathway;
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('pathway'));
    });

    // S3: required pathway fields
    it('should reject missing pathway.logical_id', () => {
      const pw = clonePathway();
      delete (pw.pathway as any).logical_id;
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('logical_id'));
    });

    it('should reject missing pathway.title', () => {
      const pw = clonePathway();
      delete (pw.pathway as any).title;
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('title'));
    });

    it('should reject missing pathway.version', () => {
      const pw = clonePathway();
      delete (pw.pathway as any).version;
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('version'));
    });

    it('should reject missing pathway.category', () => {
      const pw = clonePathway();
      delete (pw.pathway as any).category;
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('category'));
    });

    // S4: invalid category
    it('should reject invalid pathway.category', () => {
      const pw = clonePathway();
      pw.pathway.category = 'INVALID_CATEGORY';
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('category'));
    });

    // S5: nodes must be an array
    it('should reject missing nodes array', () => {
      const pw = clonePathway();
      delete (pw as any).nodes;
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('nodes'));
    });

    // S6: edges must be an array
    it('should reject missing edges array', () => {
      const pw = clonePathway();
      delete (pw as any).edges;
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('edges'));
    });

    // S7: node must have id, type, properties
    it('should reject node without id', () => {
      const pw = clonePathway();
      delete (pw.nodes[0] as any).id;
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('node[0]'));
    });

    // S8: invalid node type
    it('should reject invalid node type', () => {
      const pw = clonePathway();
      (pw.nodes[0] as any).type = 'InvalidType';
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('InvalidType'));
    });

    // S9: duplicate node ids
    it('should reject duplicate node ids', () => {
      const pw = clonePathway();
      pw.nodes.push({ ...pw.nodes[0] });
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('duplicate'));
    });

    // S10: required properties per node type
    it('should reject Stage missing stage_number', () => {
      const pw = clonePathway();
      const stage = pw.nodes.find(n => n.type === 'Stage')!;
      delete (stage.properties as any).stage_number;
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('stage_number'));
    });

    // S11: edge must have from, to, type
    it('should reject edge without from', () => {
      const pw = clonePathway();
      delete (pw.edges[0] as any).from;
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('edge[0]'));
    });

    // S12: invalid edge type
    it('should reject invalid edge type', () => {
      const pw = clonePathway();
      (pw.edges[0] as any).type = 'INVALID_EDGE';
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('INVALID_EDGE'));
    });

    // S13: edge references nonexistent node
    it('should reject edge referencing nonexistent node', () => {
      const pw = clonePathway();
      pw.edges.push({ from: 'nonexistent', to: 'stage-1', type: 'HAS_STAGE' });
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('nonexistent'));
    });

    // S14: edge endpoint type constraints
    it('should reject HAS_STAGE from a Step node', () => {
      const pw = clonePathway();
      pw.edges.push({ from: 'step-1-1', to: 'stage-2', type: 'HAS_STAGE' });
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('HAS_STAGE'));
    });

    // S15: condition_codes required and non-empty
    it('should reject empty condition_codes', () => {
      const pw = clonePathway();
      pw.pathway.condition_codes = [];
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('condition_codes'));
    });

    // All-errors-at-once: multiple errors collected
    it('should collect multiple errors at once', () => {
      const pw = clonePathway();
      delete (pw as any).schema_version;
      delete (pw.pathway as any).logical_id;
      pw.pathway.condition_codes = [];
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('semantic rules', () => {
    // SE1: ICD-10 code format
    it('should reject invalid ICD-10 code format', () => {
      const pw = clonePathway();
      pw.pathway.condition_codes[0].code = 'INVALID';
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('ICD-10'));
    });

    // SE2: must have at least one Stage node
    it('should reject pathway with no Stage nodes', () => {
      const pw = clonePathway();
      pw.nodes = pw.nodes.filter(n => n.type !== 'Stage');
      // Also remove edges that reference removed stages
      pw.edges = pw.edges.filter(e => {
        const stageIds = ['stage-1', 'stage-2', 'stage-3'];
        return !stageIds.includes(e.from) && !stageIds.includes(e.to);
      });
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('Stage'));
    });

    // SE3: graph depth check
    it('should not warn for shallow pathways', () => {
      const pw = clonePathway();
      const result = validatePathwayJson(pw);
      expect(result.warnings.filter(w => w.includes('depth'))).toHaveLength(0);
    });

    it('should warn when graph depth exceeds 30', () => {
      const pw = clonePathway();
      // Build a chain of 32 nested steps to trigger the warning
      for (let i = 10; i <= 41; i++) {
        pw.nodes.push({ id: `deep-step-${i}`, type: 'Step', properties: { stage_number: 1, step_number: i, display_number: `1.${i}`, title: `Deep Step ${i}` } });
        pw.edges.push({ from: i === 10 ? 'step-1-1' : `deep-step-${i-1}`, to: `deep-step-${i}`, type: 'HAS_DECISION_POINT' as any });
      }
      const result = validatePathwayJson(pw);
      expect(result.warnings).toContainEqual(expect.stringContaining('depth'));
    });

    // SE4: root must have at least one HAS_STAGE edge
    it('should reject pathway with no root → HAS_STAGE edges', () => {
      const pw = clonePathway();
      pw.edges = pw.edges.filter(e => !(e.from === 'root' && e.type === 'HAS_STAGE'));
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('HAS_STAGE'));
    });

    // SE5: DecisionPoint should have at least one BRANCHES_TO edge
    it('should warn when DecisionPoint has no BRANCHES_TO edges', () => {
      const pw = clonePathway();
      pw.edges = pw.edges.filter(e => e.type !== 'BRANCHES_TO');
      const result = validatePathwayJson(pw);
      expect(result.warnings).toContainEqual(expect.stringContaining('BRANCHES_TO'));
    });

    // SE6: orphan nodes (nodes not connected by any edge)
    it('should warn about orphan nodes', () => {
      const pw = clonePathway();
      pw.nodes.push({ id: 'orphan-1', type: 'Stage', properties: { stage_number: 99, title: 'Orphan' } });
      const result = validatePathwayJson(pw);
      expect(result.warnings).toContainEqual(expect.stringContaining('orphan'));
    });

    // SE7: CodeEntry code format validation for non-ICD-10 systems
    it('should reject CodeEntry with invalid LOINC code format', () => {
      const pw = clonePathway();
      const codeEntry = pw.nodes.find(n => n.id === 'code-1')!;
      codeEntry.properties.system = 'LOINC';
      codeEntry.properties.code = 'NOT-A-LOINC';
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('LOINC'));
    });

    // SE8: cross-reference validation — condition codes used in criteria must be defined
    it('should warn when criterion references code not in condition_codes', () => {
      const pw = clonePathway();
      // Change a criterion's code to something not in condition_codes
      const crit = pw.nodes.find(n => n.id === 'crit-1')!;
      crit.properties.code_value = 'Z99.99';
      const result = validatePathwayJson(pw);
      expect(result.warnings).toContainEqual(expect.stringContaining('Z99.99'));
    });
  });
});
