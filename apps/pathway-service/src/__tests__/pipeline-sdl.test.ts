import { readFileSync } from 'fs';
import { join } from 'path';
import { EnumTypeDefinitionNode, ObjectTypeDefinitionNode, parse, print } from 'graphql';
import { formatSessionForGraphQL } from '../resolvers/Query';
import { NodeStatus } from '../services/resolution/types';

const SDL = parse(readFileSync(join(__dirname, '../../schema.graphql'), 'utf-8'));
const objectType = (name: string) =>
  SDL.definitions.find((d) => d.kind === 'ObjectTypeDefinition' && d.name.value === name) as ObjectTypeDefinitionNode;
const fieldType = (type: string, field: string) => {
  const f = objectType(type).fields?.find((x) => x.name.value === field);
  return f ? print(f.type) : undefined;
};
const enumValues = (name: string) =>
  (SDL.definitions.find((d) => d.kind === 'EnumTypeDefinition' && d.name.value === name) as EnumTypeDefinitionNode)
    .values!.map((v) => v.name.value);

describe('evaluation pipeline API surface (spec §4)', () => {
  it('exposes revision, resultHash and envFingerprint on ResolutionSession', () => {
    expect(fieldType('ResolutionSession', 'revision')).toBe('Int!');
    expect(fieldType('ResolutionSession', 'resultHash')).toBe('String!');
    expect(fieldType('ResolutionSession', 'envFingerprint')).toBe('String!');
  });

  it('exposes both node layers (C2)', () => {
    expect(fieldType('ResolvedNode', 'eligibilityStatus')).toBe('NodeStatus!');
    expect(fieldType('ResolvedNode', 'withheldBy')).toBe('WithheldBy');
    expect(enumValues('WithheldBy')).toEqual(['SAFETY', 'CONFLICT']);
  });

  it('scopes blockers and names the new blocker types (C3)', () => {
    expect(fieldType('ValidationBlockerType', 'scope')).toBe('BlockerScope!');
    expect(fieldType('ValidationBlockerType', 'pathwayId')).toBe('ID');
    expect(enumValues('BlockerScope')).toEqual(['COMPLETENESS', 'OUTPUT']);
    expect(enumValues('BlockerType')).toEqual(expect.arrayContaining([
      'SAFETY_DATA_UNAVAILABLE', 'UNRESOLVED_CONFLICT', 'STALE_CONFLICT_DECISION', 'PLAN_CHANGED_SINCE_REVIEW',
    ]));
  });

  it('formatSessionForGraphQL maps the layers and the session fields', () => {
    const node = (nodeId: string, extra: Record<string, unknown>) => ({
      nodeId, nodeType: 'Medication', title: nodeId, confidence: 0.9, confidenceBreakdown: [], depth: 1, ...extra,
    });
    const formatted = formatSessionForGraphQL({
      id: 's', pathwayId: 'p', pathwayVersion: '1', patientId: 'pt', providerId: 'pr', status: 'ACTIVE',
      revision: 3, resultHash: 'h', envFingerprint: 'e',
      resolutionState: new Map([
        ['withheld', node('withheld', {
          status: NodeStatus.EXCLUDED,
          eligibility: { status: NodeStatus.INCLUDED, decidedBy: 'traversal' },
          disposition: { status: NodeStatus.EXCLUDED, withheldBy: 'safety' },
        })],
        ['plain', node('plain', { status: NodeStatus.INCLUDED })],
      ]),
      pendingQuestions: [], redFlags: [], resolutionEvents: [], ddiWarnings: [],
      totalNodesEvaluated: 2, traversalDurationMs: 1,
    } as never);

    expect(formatted).toMatchObject({ revision: 3, resultHash: 'h', envFingerprint: 'e' });
    expect(formatted.excludedNodes[0]).toMatchObject({ nodeId: 'withheld', status: 'EXCLUDED', eligibilityStatus: 'INCLUDED', withheldBy: 'SAFETY' });
    expect(formatted.includedNodes[0]).toMatchObject({ nodeId: 'plain', eligibilityStatus: 'INCLUDED', withheldBy: null });
  });
});
