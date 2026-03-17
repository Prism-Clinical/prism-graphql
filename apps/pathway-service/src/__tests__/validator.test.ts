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
});
