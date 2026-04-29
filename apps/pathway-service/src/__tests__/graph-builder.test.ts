import { buildGraphCommands } from '../services/import/graph-builder';
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
  });
});
