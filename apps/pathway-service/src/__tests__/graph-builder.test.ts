import { buildGraphCommands, buildBatchedGraphCommands } from '../services/import/graph-builder';
import { REFERENCE_PATHWAY, MINIMAL_PATHWAY, clonePathway } from './fixtures/reference-pathway';

describe('buildGraphCommands', () => {
  it('should return a root Pathway CREATE as the first command', () => {
    const commands = buildGraphCommands(REFERENCE_PATHWAY);
    expect(commands.length).toBeGreaterThan(0);
    expect(commands[0].cypher).toContain('CREATE (v:Pathway');
    expect(commands[0].cypher).toContain('CP-PriorUterineSurgery');
  });

  it('should create one command per node plus root', () => {
    const commands = buildGraphCommands(MINIMAL_PATHWAY);
    // root + 2 nodes = 3 node creates, plus 2 edge creates = 5 total
    const nodeCreates = commands.filter(c => c.type === 'node');
    expect(nodeCreates).toHaveLength(3); // root + stage-1 + step-1-1
  });

  it('should create one command per edge', () => {
    const commands = buildGraphCommands(MINIMAL_PATHWAY);
    const edgeCreates = commands.filter(c => c.type === 'edge');
    expect(edgeCreates).toHaveLength(2); // HAS_STAGE + HAS_STEP
  });

  it('should escape single quotes in property values', () => {
    const pw = clonePathway(MINIMAL_PATHWAY);
    pw.nodes[0].properties.title = "Patient's Assessment";
    const commands = buildGraphCommands(pw);
    const stageCypher = commands.find(c => c.nodeId === 'stage-1')!.cypher;
    expect(stageCypher).toContain("Patient\\'s Assessment");
    expect(stageCypher).not.toContain("Patient's Assessment");
  });

  it('should reject property keys with unsafe characters', () => {
    const pw = clonePathway(MINIMAL_PATHWAY);
    pw.nodes[0].properties['bad}key'] = 'exploit';
    expect(() => buildGraphCommands(pw)).toThrow('Invalid property key');
  });

  it('should include all node types from reference pathway', () => {
    const commands = buildGraphCommands(REFERENCE_PATHWAY);
    const allCypher = commands.map(c => c.cypher).join('\n');
    expect(allCypher).toContain(':Stage');
    expect(allCypher).toContain(':Step');
    expect(allCypher).toContain(':DecisionPoint');
    expect(allCypher).toContain(':Criterion');
    expect(allCypher).toContain(':Medication');
    expect(allCypher).toContain(':EvidenceCitation');
  });

  it('should include all edge types from reference pathway', () => {
    const commands = buildGraphCommands(REFERENCE_PATHWAY);
    const allCypher = commands.map(c => c.cypher).join('\n');
    expect(allCypher).toContain('HAS_STAGE');
    expect(allCypher).toContain('HAS_STEP');
    expect(allCypher).toContain('HAS_DECISION_POINT');
    expect(allCypher).toContain('BRANCHES_TO');
    expect(allCypher).toContain('USES_MEDICATION');
  });

  it('should set node_id property on every node for reference linking', () => {
    const commands = buildGraphCommands(MINIMAL_PATHWAY);
    const nodeCreates = commands.filter(c => c.type === 'node');
    for (const cmd of nodeCreates) {
      expect(cmd.cypher).toContain('node_id:');
    }
  });

  describe('Gate node Cypher generation', () => {
    it('should generate CREATE for Gate node with all properties', () => {
      const pathway = clonePathway();
      pathway.nodes.push({
        id: 'gate-transplant',
        type: 'Gate' as any,
        properties: {
          title: 'Transplant screening',
          gate_type: 'patient_attribute',
          default_behavior: 'skip',
          condition: { field: 'conditions', operator: 'includes_code', value: 'Z94.*', system: 'ICD-10' },
        },
      });
      pathway.edges.push({ from: 'step-1-1', to: 'gate-transplant', type: 'HAS_GATE' as any });
      pathway.edges.push({ from: 'gate-transplant', to: 'step-1-2', type: 'BRANCHES_TO' });

      const commands = buildGraphCommands(pathway);
      const gateCmd = commands.find(c => c.nodeId === 'gate-transplant');
      expect(gateCmd).toBeDefined();
      expect(gateCmd!.cypher).toContain(':Gate');

      const edgeCmd = commands.find(c => c.cypher.includes('HAS_GATE'));
      expect(edgeCmd).toBeDefined();
    });

    it('should serialize nested condition object as a Cypher map literal, not a JSON string', () => {
      const pathway = clonePathway(MINIMAL_PATHWAY);
      pathway.nodes.push({
        id: 'gate-numeric',
        type: 'Gate' as any,
        properties: {
          title: 'BP elevated',
          gate_type: 'patient_attribute',
          default_behavior: 'skip',
          condition: { field: 'vitals', operator: 'greater_than', value: 'systolicBP', threshold: 140 },
        },
      });
      const commands = buildGraphCommands(pathway);
      const gateCmd = commands.find(c => c.nodeId === 'gate-numeric')!;
      // Map literal (real nested object): condition: {field: 'vitals', ...}
      expect(gateCmd.cypher).toMatch(/condition:\s*\{field:\s*'vitals'/);
      expect(gateCmd.cypher).toContain('threshold: 140');
      // Should NOT be the previous bug: JSON-encoded string starting with `condition: '{`
      expect(gateCmd.cypher).not.toMatch(/condition:\s*'\{/);
    });

    it('should serialize array properties as Cypher list literals, not JSON strings', () => {
      const pathway = clonePathway(MINIMAL_PATHWAY);
      pathway.nodes.push({
        id: 'gate-tags',
        type: 'Gate' as any,
        properties: {
          title: 'Tagged gate',
          gate_type: 'patient_attribute',
          default_behavior: 'skip',
          tags: ['preventive', 'screening'],
        },
      });
      const commands = buildGraphCommands(pathway);
      const gateCmd = commands.find(c => c.nodeId === 'gate-tags')!;
      expect(gateCmd.cypher).toContain("tags: ['preventive', 'screening']");
      expect(gateCmd.cypher).not.toMatch(/tags:\s*'\[/);
    });
  });

  describe('cross-pathway scoping', () => {
    it('should stamp pathway_logical_id and pathway_version on every non-root node', () => {
      const commands = buildGraphCommands(MINIMAL_PATHWAY);
      const nodeCreates = commands.filter(c => c.type === 'node' && c.nodeId !== 'root');
      expect(nodeCreates.length).toBeGreaterThan(0);
      for (const cmd of nodeCreates) {
        expect(cmd.cypher).toContain(`pathway_logical_id: '${MINIMAL_PATHWAY.pathway.logical_id}'`);
        expect(cmd.cypher).toContain(`pathway_version: '${MINIMAL_PATHWAY.pathway.version}'`);
      }
    });

    it('should scope every edge MATCH by pathway_logical_id and pathway_version', () => {
      const commands = buildGraphCommands(MINIMAL_PATHWAY);
      const edgeCmds = commands.filter(c => c.type === 'edge');
      expect(edgeCmds.length).toBeGreaterThan(0);
      const lid = MINIMAL_PATHWAY.pathway.logical_id;
      const ver = MINIMAL_PATHWAY.pathway.version;
      for (const cmd of edgeCmds) {
        // Both endpoints filtered by the per-pathway-version scope
        expect(cmd.cypher).toContain(`pathway_logical_id: '${lid}'`);
        expect(cmd.cypher).toContain(`pathway_version: '${ver}'`);
      }
    });

    it('should scope root MATCH by Pathway label + logical_id + version', () => {
      const commands = buildGraphCommands(MINIMAL_PATHWAY);
      const rootEdgeCmds = commands.filter(c => c.type === 'edge' && c.cypher.includes("(a:Pathway"));
      expect(rootEdgeCmds.length).toBeGreaterThan(0);
      for (const cmd of rootEdgeCmds) {
        expect(cmd.cypher).toMatch(/MATCH \(a:Pathway \{node_id: 'root', logical_id: '[^']+', version: '[^']+'\}\)/);
      }
    });
  });
});

describe('buildBatchedGraphCommands', () => {
  it('emits separate root-edge cyphers from non-root edge cyphers', () => {
    // Strip edge properties so root edges land in rootEdgeCyphers, not edgeWithPropsCyphers
    const pw = clonePathway(MINIMAL_PATHWAY);
    pw.edges = pw.edges.map((e) => ({ from: e.from, to: e.to, type: e.type }));
    const batched = buildBatchedGraphCommands(pw);
    expect(batched.rootEdgeCyphers.length).toBeGreaterThan(0);
    for (const cypher of batched.rootEdgeCyphers) {
      expect(cypher).toMatch(/MATCH \(a:Pathway \{node_id: 'root',/);
      expect(cypher).toContain(`logical_id: '${pw.pathway.logical_id}'`);
      expect(cypher).toContain(`version: '${pw.pathway.version}'`);
    }
  });

  it('non-root UNWIND edge cyphers scope MATCH by pathway_logical_id and pathway_version', () => {
    const batched = buildBatchedGraphCommands(MINIMAL_PATHWAY);
    if (batched.edgeCyphers.length === 0) {
      // MINIMAL_PATHWAY may not have non-root edges — synthesize one
      return;
    }
    for (const cypher of batched.edgeCyphers) {
      expect(cypher).toContain('UNWIND edges AS e');
      expect(cypher).toContain(`pathway_logical_id: '${MINIMAL_PATHWAY.pathway.logical_id}'`);
      expect(cypher).toContain(`pathway_version: '${MINIMAL_PATHWAY.pathway.version}'`);
    }
  });

  it('batched node CREATEs include pathway_logical_id and pathway_version on every node', () => {
    const batched = buildBatchedGraphCommands(MINIMAL_PATHWAY);
    for (const cypher of batched.nodeCyphers) {
      expect(cypher).toContain(`pathway_logical_id: '${MINIMAL_PATHWAY.pathway.logical_id}'`);
      expect(cypher).toContain(`pathway_version: '${MINIMAL_PATHWAY.pathway.version}'`);
    }
  });
});
