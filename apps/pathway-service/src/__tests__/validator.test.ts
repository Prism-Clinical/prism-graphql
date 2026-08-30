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
      // Fill past the 5000-edge limit with copies of an existing edge.
      const originalEdges = [...pw.edges];
      for (let i = pw.edges.length; i <= 5001; i++) {
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

    it('should not flag a high-fan-in DAG as cyclic (depth = longest path, not BFS iteration count)', () => {
      // Regression: a previous BFS-based algorithm with an iteration cap
      // misclassified DAGs with many shared leaf targets as cycles.
      const pw = clonePathway();
      // Add 200 medication nodes that all CITES_EVIDENCE the same evidence node.
      // Real depth is unchanged (2 deeper than any USES_MEDICATION step), but
      // the high fan-in inflates a naive BFS iteration count.
      pw.nodes.push({
        id: 'shared-evidence',
        type: 'EvidenceCitation',
        properties: { title: 'Shared evidence', source: 'X', year: 2024, evidence_level: 'A' },
      });
      for (let i = 0; i < 200; i++) {
        const medId = `fanin-med-${i}`;
        pw.nodes.push({
          id: medId,
          type: 'Medication',
          properties: { name: `Med ${i}`, role: 'first_line' },
        });
        pw.edges.push({ from: 'step-1-1', to: medId, type: 'USES_MEDICATION' });
        pw.edges.push({ from: medId, to: 'shared-evidence', type: 'CITES_EVIDENCE' });
      }
      const result = validatePathwayJson(pw);
      expect(result.errors.filter((e) => e.includes('depth'))).toHaveLength(0);
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

    // addValidGate hardcodes its condition; this variant lets a test inject
    // a raw condition object to exercise condition-schema validation.
    function addGateWithCondition(pw: ReturnType<typeof clonePathway>, condition: Record<string, unknown>): void {
      pw.nodes.push({
        id: 'gate-cond',
        type: 'Gate' as any,
        properties: {
          title: 'Condition test gate',
          gate_type: 'patient_attribute',
          default_behavior: 'skip',
          condition: condition as any,
        },
      });
      pw.edges.push({ from: 'step-1-1', to: 'gate-cond', type: 'HAS_GATE' as any });
      pw.edges.push({ from: 'gate-cond', to: 'step-1-2', type: 'BRANCHES_TO' as any });
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

    it('accepts Gate with no outbound edges in draft mode (warning, not error)', () => {
      // Mid-authoring case: an author drops a Gate on the canvas but hasn't
      // wired its branches yet. Autosave (DRAFT_UPDATE) must persist the gate
      // so the user doesn't lose work; publishing re-promotes this to an error.
      const pw = clonePathway();
      pw.nodes.push({
        id: 'gate-orphan',
        type: 'Gate' as any,
        properties: {},
      });
      pw.edges.push({ from: 'step-1-1', to: 'gate-orphan', type: 'HAS_GATE' as any });
      const result = validatePathwayJson(pw, { draftMode: true });
      expect(result.valid).toBe(true);
      expect(result.errors).not.toContainEqual(expect.stringContaining('outbound edge'));
      expect(result.warnings).toContainEqual(expect.stringContaining('outbound edge'));
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

    // The inverse of the case below, and the one that bit hardest: the old
    // check compared whole `{node_id, status}` OBJECTS against the id set, so
    // a correctly-shaped gate pointing at a node that plainly exists was
    // rejected as "references nonexistent node [object Object]". The canonical
    // shape was unimportable.
    it('should accept a canonical depends_on pointing at an existing node', () => {
      const pw = clonePathway();
      pw.nodes.push({
        id: 'gate-good-dep',
        type: 'Gate' as any,
        properties: {
          title: 'Good dep gate',
          gate_type: 'prior_node_result',
          default_behavior: 'skip',
          depends_on: [{ node_id: 'step-1-1', status: 'INCLUDED' }],
        },
      });
      pw.edges.push({ from: 'step-1-1', to: 'gate-good-dep', type: 'HAS_GATE' as any });
      pw.edges.push({ from: 'gate-good-dep', to: 'step-1-2', type: 'BRANCHES_TO' as any });
      const result = validatePathwayJson(pw);
      expect(result.errors).not.toContainEqual(expect.stringContaining('depends_on'));
      expect(result.valid).toBe(true);
    });

    // The existence check above reads node ids through parseDependsOn, so it
    // has to keep working for the canonical object shape too — that is the
    // shape import now writes.
    it('should reject nonexistent depends_on references in the canonical shape', () => {
      const pw = clonePathway();
      pw.nodes.push({
        id: 'gate-bad-dep-obj',
        type: 'Gate' as any,
        properties: {
          title: 'Bad dep gate',
          gate_type: 'prior_node_result',
          default_behavior: 'skip',
          depends_on: [{ node_id: 'nonexistent-node', status: 'INCLUDED' }],
        },
      });
      pw.edges.push({ from: 'step-1-1', to: 'gate-bad-dep-obj', type: 'HAS_GATE' as any });
      pw.edges.push({ from: 'gate-bad-dep-obj', to: 'step-1-2', type: 'BRANCHES_TO' as any });
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('nonexistent-node'));
    });

    // A depends_on the engine cannot read is a hard error even in draft: it is
    // not "work in progress", it is a value that will never evaluate. The old
    // validator cast it to string[] and waved it through.
    it('should reject an uninterpretable depends_on shape, even in draft mode', () => {
      const pw = clonePathway();
      pw.nodes.push({
        id: 'gate-bad-shape',
        type: 'Gate' as any,
        properties: {
          title: 'Bad shape gate',
          gate_type: 'prior_node_result',
          default_behavior: 'skip',
          depends_on: { node: 'step-1-1' },
        },
      });
      pw.edges.push({ from: 'step-1-1', to: 'gate-bad-shape', type: 'HAS_GATE' as any });
      pw.edges.push({ from: 'gate-bad-shape', to: 'step-1-2', type: 'BRANCHES_TO' as any });
      const result = validatePathwayJson(pw, { draftMode: true });
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('depends_on'));
    });

    it('should reject a depends_on status outside the NodeStatus vocabulary', () => {
      const pw = clonePathway();
      pw.nodes.push({
        id: 'gate-bad-status',
        type: 'Gate' as any,
        properties: {
          title: 'Bad status gate',
          gate_type: 'prior_node_result',
          default_behavior: 'skip',
          depends_on: [{ node_id: 'step-1-1', status: 'MAYBE' }],
        },
      });
      pw.edges.push({ from: 'step-1-1', to: 'gate-bad-status', type: 'HAS_GATE' as any });
      pw.edges.push({ from: 'gate-bad-status', to: 'step-1-2', type: 'BRANCHES_TO' as any });
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
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

    describe('condition schema validation', () => {
      it('rejects a condition with neither field nor attribute', () => {
        const pw = clonePathway(REFERENCE_PATHWAY);
        addGateWithCondition(pw, { operator: 'less_than', value: '7' }); // no field, no attribute
        const result = validatePathwayJson(pw);
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(expect.stringContaining('exactly one of'));
      });

      it('rejects a condition with both field and attribute', () => {
        const pw = clonePathway(REFERENCE_PATHWAY);
        addGateWithCondition(pw, { field: 'labs', attribute: 'lab.hemoglobin', operator: 'less_than', value: '7' });
        expect(validatePathwayJson(pw).errors).toContainEqual(expect.stringContaining('exactly one of'));
      });

      it('rejects an SQL-style operator (LT) on a coded condition', () => {
        const pw = clonePathway(REFERENCE_PATHWAY);
        addGateWithCondition(pw, { field: 'labs', operator: 'LT', value: '718-7' });
        expect(validatePathwayJson(pw).errors).toContainEqual(expect.stringContaining('operator'));
      });

      // Plan 04 Task 1: the NODE tier of the temporal cascade. Without these
      // keys on CODED_KEYS/ATTRIBUTE_KEYS the validator rejects them as unknown
      // keys, and a per-condition horizon becomes unauthorable — the whole
      // point of the feature would be reachable only from hand-built fixtures.
      it('accepts a per-condition horizon on a coded condition', () => {
        const pw = clonePathway(REFERENCE_PATHWAY);
        addGateWithCondition(pw, {
          field: 'labs',
          operator: 'greater_than',
          value: '718-7',
          horizon: 'QUARTER',
        });
        const result = validatePathwayJson(pw);
        expect(result.errors).not.toContainEqual(expect.stringContaining('unknown key'));
        expect(result.valid).toBe(true);
      });

      it('accepts a per-condition status on a coded condition', () => {
        const pw = clonePathway(REFERENCE_PATHWAY);
        addGateWithCondition(pw, {
          field: 'conditions',
          operator: 'includes_code',
          value: 'E11.9',
          status: 'any',
        });
        const result = validatePathwayJson(pw);
        expect(result.errors).not.toContainEqual(expect.stringContaining('unknown key'));
        expect(result.valid).toBe(true);
      });

      it('accepts a per-condition horizon on an attribute condition', () => {
        const pw = clonePathway(REFERENCE_PATHWAY);
        addGateWithCondition(pw, {
          attribute: 'lab.hemoglobin',
          operator: 'less_than',
          value: 7,
          horizon: 'ENCOUNTER',
        });
        const result = validatePathwayJson(pw);
        expect(result.errors).not.toContainEqual(expect.stringContaining('unknown key'));
        expect(result.valid).toBe(true);
      });

      it('still rejects a key that is neither', () => {
        // The allowlist must widen by exactly two keys, not collapse.
        const pw = clonePathway(REFERENCE_PATHWAY);
        addGateWithCondition(pw, {
          field: 'labs',
          operator: 'greater_than',
          value: '718-7',
          hoziron: 'QUARTER',
        });
        expect(validatePathwayJson(pw).errors).toContainEqual(
          expect.stringContaining('unknown key'),
        );
      });

      it('rejects a coded field that has no fact kind (round 7 P1-22)', () => {
        // Previously only checked to be a string. An unknown field imported
        // cleanly, was silently skipped by preflight, and was then rejected by
        // the runtime adapter mid-traversal.
        const pw = clonePathway(REFERENCE_PATHWAY);
        addGateWithCondition(pw, { field: 'horoscopes', operator: 'exists', value: '' });
        const result = validatePathwayJson(pw);
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(expect.stringContaining('horoscopes'));
      });

      it('accepts every field the kernel does model', () => {
        for (const field of ['conditions', 'medications', 'allergies', 'labs', 'vitals']) {
          const pw = clonePathway(REFERENCE_PATHWAY);
          addGateWithCondition(pw, { field, operator: 'exists', value: '' });
          expect(validatePathwayJson(pw).valid).toBe(true);
        }
      });

      // Plan 04 D9: `system` stays in CODED_KEYS because it is valid on every
      // other field; this is a field-specific rule, not a key-allowlist change.
      it('rejects a system on a coded vitals condition (D9)', () => {
        const pw = clonePathway(REFERENCE_PATHWAY);
        addGateWithCondition(pw, {
          field: 'vitals',
          operator: 'greater_than',
          value: 'systolic_bp',
          system: 'LOINC',
          threshold: 140,
        });
        const result = validatePathwayJson(pw);
        expect(result.valid).toBe(false);
        // Not reported as an unknown key — `system` is a legitimate coded key.
        expect(result.errors).not.toContainEqual(expect.stringContaining('unknown key'));
        expect(result.errors).toContainEqual(expect.stringContaining('vitals'));
        expect(result.errors).toContainEqual(expect.stringContaining('system'));
      });

      it('rejects a system on a vitals exists condition too (D9)', () => {
        // Same field rule regardless of operator: the adapter rejects `exists`
        // as well, and preflight and authoring must not disagree.
        const pw = clonePathway(REFERENCE_PATHWAY);
        addGateWithCondition(pw, { field: 'vitals', operator: 'exists', value: '', system: 'LOINC' });
        expect(validatePathwayJson(pw).valid).toBe(false);
      });

      it('still accepts a system on a coded labs condition (D9 is field-specific)', () => {
        const pw = clonePathway(REFERENCE_PATHWAY);
        addGateWithCondition(pw, {
          field: 'labs',
          operator: 'greater_than',
          value: '718-7',
          system: 'LOINC',
          threshold: 7,
        });
        expect(validatePathwayJson(pw).valid).toBe(true);
      });

      it('accepts a vitals condition that sets no system', () => {
        const pw = clonePathway(REFERENCE_PATHWAY);
        addGateWithCondition(pw, {
          field: 'vitals',
          operator: 'greater_than',
          value: 'systolic_bp',
          threshold: 140,
        });
        expect(validatePathwayJson(pw).valid).toBe(true);
      });

      it('rejects an attribute with an unregistered namespace', () => {
        const pw = clonePathway(REFERENCE_PATHWAY);
        addGateWithCondition(pw, { attribute: 'bogus.thing', operator: 'exists', value: true });
        expect(validatePathwayJson(pw).errors).toContainEqual(expect.stringContaining('namespace'));
      });

      it('rejects an unknown decorator/extra key', () => {
        const pw = clonePathway(REFERENCE_PATHWAY);
        addGateWithCondition(pw, { field: 'labs', operator: 'less_than', value: '718-7', threshold: 7, bogusKey: 1 });
        expect(validatePathwayJson(pw).errors).toContainEqual(expect.stringContaining('unknown'));
      });

      it('accepts a valid coded condition with a display decorator', () => {
        const pw = clonePathway(REFERENCE_PATHWAY);
        addGateWithCondition(pw, { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 7, display: 'Hemoglobin' });
        expect(validatePathwayJson(pw).valid).toBe(true);
      });

      it('accepts a valid attribute condition', () => {
        const pw = clonePathway(REFERENCE_PATHWAY);
        addGateWithCondition(pw, { attribute: 'patient.trimester', operator: 'in', value: [1, 3] });
        expect(validatePathwayJson(pw).valid).toBe(true);
      });
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
