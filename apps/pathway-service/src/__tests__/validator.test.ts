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

    it('should reject unsupported schema_version', () => {
      const pw = clonePathway();
      pw.schema_version = '2.0';
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

    // S6b: edge count limit
    it('should reject edge count exceeding MAX_GRAPH_EDGES', () => {
      const pw = clonePathway();
      // Fill with 2001 edges (all referencing existing nodes to avoid other errors)
      const originalEdges = [...pw.edges];
      for (let i = pw.edges.length; i <= 2000; i++) {
        pw.edges.push({ ...originalEdges[0] });
      }
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('edge count'));
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
      // Build a deep chain using valid edge types:
      // Step → DecisionPoint (HAS_DECISION_POINT) → Step (BRANCHES_TO) → ...
      // Each iteration adds 2 depth levels. 16 iterations = 32 extra depth.
      // step-1-1 is at ~depth 2, so total ~34: above 30 (warning) but below 50 (error).
      let prevId = 'step-1-1';
      for (let i = 10; i <= 25; i++) {
        const dpId = `deep-dp-${i}`;
        const stepId = `deep-step-${i}`;
        pw.nodes.push({ id: dpId, type: 'DecisionPoint', properties: { title: `Decision ${i}` } });
        pw.nodes.push({ id: stepId, type: 'Step', properties: { stage_number: 1, step_number: i, display_number: `1.${i}`, title: `Deep Step ${i}` } });
        pw.edges.push({ from: prevId, to: dpId, type: 'HAS_DECISION_POINT' });
        pw.edges.push({ from: dpId, to: stepId, type: 'BRANCHES_TO' });
        prevId = stepId;
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

  describe('Gate node validation', () => {
    function addValidGate(pw: ReturnType<typeof clonePathway>): void {
      pw.nodes.push({
        id: 'gate-1',
        type: 'Gate' as any,
        properties: {
          title: 'Transplant screening',
          gate_type: 'patient_attribute',
          default_behavior: 'skip',
          condition: { field: 'conditions', operator: 'includes_code', value: 'Z94.*', system: 'ICD-10' },
        },
      });
      pw.edges.push({ from: 'step-1-1', to: 'gate-1', type: 'HAS_GATE' as any });
      pw.edges.push({ from: 'gate-1', to: 'step-1-2', type: 'BRANCHES_TO' as any });
    }

    it('should accept a valid Gate node', () => {
      const pw = clonePathway();
      addValidGate(pw);
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject Gate with no outbound edges', () => {
      const pw = clonePathway();
      pw.nodes.push({
        id: 'gate-orphan',
        type: 'Gate' as any,
        properties: {
          title: 'Orphan gate',
          gate_type: 'patient_attribute',
          default_behavior: 'skip',
        },
      });
      // Only inbound edge, no outbound
      pw.edges.push({ from: 'step-1-1', to: 'gate-orphan', type: 'HAS_GATE' as any });
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('gate-orphan'));
      expect(result.errors).toContainEqual(expect.stringContaining('outbound edge'));
    });

    it('should reject Gate with nonexistent depends_on references', () => {
      const pw = clonePathway();
      pw.nodes.push({
        id: 'gate-bad-dep',
        type: 'Gate' as any,
        properties: {
          title: 'Bad dep gate',
          gate_type: 'patient_attribute',
          default_behavior: 'skip',
          depends_on: ['nonexistent-node'],
        },
      });
      pw.edges.push({ from: 'step-1-1', to: 'gate-bad-dep', type: 'HAS_GATE' as any });
      pw.edges.push({ from: 'gate-bad-dep', to: 'step-1-2', type: 'BRANCHES_TO' as any });
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('nonexistent-node'));
      expect(result.errors).toContainEqual(expect.stringContaining('depends_on'));
    });

    it('should reject select Gate without options', () => {
      const pw = clonePathway();
      pw.nodes.push({
        id: 'gate-select',
        type: 'Gate' as any,
        properties: {
          title: 'Select gate',
          gate_type: 'select',
          default_behavior: 'skip',
          // missing options array
        },
      });
      pw.edges.push({ from: 'step-1-1', to: 'gate-select', type: 'HAS_GATE' as any });
      pw.edges.push({ from: 'gate-select', to: 'step-1-2', type: 'BRANCHES_TO' as any });
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('select'));
      expect(result.errors).toContainEqual(expect.stringContaining('options'));
    });

    it('should reject compound Gate with empty conditions', () => {
      const pw = clonePathway();
      pw.nodes.push({
        id: 'gate-compound',
        type: 'Gate' as any,
        properties: {
          title: 'Compound gate',
          gate_type: 'compound',
          default_behavior: 'skip',
          conditions: [],
        },
      });
      pw.edges.push({ from: 'step-1-1', to: 'gate-compound', type: 'HAS_GATE' as any });
      pw.edges.push({ from: 'gate-compound', to: 'step-1-2', type: 'BRANCHES_TO' as any });
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('compound'));
      expect(result.errors).toContainEqual(expect.stringContaining('conditions'));
    });
  });

  describe('Phase 1b code_sets validation', () => {
    it('accepts pathway with no code_sets (legacy shape)', () => {
      const pw = clonePathway(MINIMAL_PATHWAY);
      expect(pw.pathway.code_sets).toBeUndefined();
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(true);
    });

    it('accepts pathway with valid code_sets', () => {
      const pw = clonePathway(MINIMAL_PATHWAY);
      pw.pathway.code_sets = [
        {
          description: 'T2DM with HTN',
          scope: 'EXACT',
          required_codes: [
            { code: 'E11', system: 'ICD-10' },
            { code: 'I10', system: 'ICD-10' },
          ],
        },
      ];
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(true);
    });

    it('accepts cross-system code_sets', () => {
      const pw = clonePathway(MINIMAL_PATHWAY);
      pw.pathway.code_sets = [
        {
          description: 'AF on warfarin',
          required_codes: [
            { code: 'I48.91', system: 'ICD-10' },
            { code: '11289', system: 'RXNORM' },
          ],
        },
      ];
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(true);
    });

    it('rejects code_sets that is not an array', () => {
      const pw = clonePathway(MINIMAL_PATHWAY);
      (pw.pathway as any).code_sets = 'not an array';
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('code_sets must be an array'));
    });

    it('rejects code_set with empty required_codes', () => {
      const pw = clonePathway(MINIMAL_PATHWAY);
      pw.pathway.code_sets = [{ description: 'empty', required_codes: [] }];
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('required_codes must be a non-empty array'));
    });

    it('rejects invalid scope value', () => {
      const pw = clonePathway(MINIMAL_PATHWAY);
      pw.pathway.code_sets = [
        {
          scope: 'BOGUS' as any,
          required_codes: [{ code: 'E11', system: 'ICD-10' }],
        },
      ];
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('invalid scope'));
    });

    it('rejects invalid system on a member', () => {
      const pw = clonePathway(MINIMAL_PATHWAY);
      pw.pathway.code_sets = [
        {
          required_codes: [{ code: 'E11', system: 'NOT-A-SYSTEM' as any }],
        },
      ];
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringMatching(/invalid system "NOT-A-SYSTEM"/));
    });

    it('rejects member missing code', () => {
      const pw = clonePathway(MINIMAL_PATHWAY);
      pw.pathway.code_sets = [
        {
          required_codes: [{ system: 'ICD-10' } as any],
        },
      ];
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('missing "code"'));
    });

    it('rejects invalid scope_override on a member', () => {
      const pw = clonePathway(MINIMAL_PATHWAY);
      pw.pathway.code_sets = [
        {
          required_codes: [
            { code: 'E11', system: 'ICD-10', scope_override: 'BOGUS' as any },
          ],
        },
      ];
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('invalid scope_override'));
    });
  });
});
