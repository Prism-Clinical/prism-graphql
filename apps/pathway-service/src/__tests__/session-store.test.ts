import {
  serializeResolutionState,
  deserializeResolutionState,
  serializeDependencyMap,
  deserializeDependencyMap,
} from '../services/resolution/session-store';
import { NodeStatus, NodeResult, createEmptyDependencyMap } from '../services/resolution/types';

describe('SessionStore serialization', () => {
  it('should round-trip ResolutionState through JSON', () => {
    const state = new Map<string, NodeResult>([
      [
        'node-1',
        {
          nodeId: 'node-1',
          nodeType: 'Medication',
          title: 'Med',
          status: NodeStatus.INCLUDED,
          confidence: 0.85,
          confidenceBreakdown: [],
          depth: 2,
        },
      ],
    ]);
    const json = serializeResolutionState(state);
    const parsed = JSON.parse(JSON.stringify(json)); // simulate DB round-trip
    const restored = deserializeResolutionState(parsed);
    expect(restored.get('node-1')?.status).toBe(NodeStatus.INCLUDED);
    expect(restored.get('node-1')?.confidence).toBe(0.85);
  });

  it('should round-trip DependencyMap through JSON', () => {
    const depMap = createEmptyDependencyMap();
    depMap.influences.set('a', new Set(['b', 'c']));
    depMap.influencedBy.set('b', new Set(['a']));
    depMap.gateContextFields.set('gate-1', new Set(['conditions']));
    depMap.scorerInputs.set('med-1', new Set(['medications', 'allergies']));

    const json = serializeDependencyMap(depMap);
    const parsed = JSON.parse(JSON.stringify(json));
    const restored = deserializeDependencyMap(parsed);

    expect(restored.influences.get('a')?.has('b')).toBe(true);
    expect(restored.influences.get('a')?.has('c')).toBe(true);
    expect(restored.influencedBy.get('b')?.has('a')).toBe(true);
    expect(restored.gateContextFields.get('gate-1')?.has('conditions')).toBe(true);
    expect(restored.scorerInputs.get('med-1')?.has('medications')).toBe(true);
  });

  it('should handle empty state', () => {
    const state = new Map<string, NodeResult>();
    const json = serializeResolutionState(state);
    const restored = deserializeResolutionState(JSON.parse(JSON.stringify(json)));
    expect(restored.size).toBe(0);
  });

  it('should handle empty dependency map', () => {
    const depMap = createEmptyDependencyMap();
    const json = serializeDependencyMap(depMap);
    const restored = deserializeDependencyMap(JSON.parse(JSON.stringify(json)));
    expect(restored.influences.size).toBe(0);
    expect(restored.influencedBy.size).toBe(0);
    expect(restored.gateContextFields.size).toBe(0);
    expect(restored.scorerInputs.size).toBe(0);
  });

  it('should preserve multiple nodes in ResolutionState', () => {
    const state = new Map<string, NodeResult>([
      [
        'node-1',
        {
          nodeId: 'node-1',
          nodeType: 'Medication',
          title: 'Aspirin',
          status: NodeStatus.INCLUDED,
          confidence: 0.9,
          confidenceBreakdown: [],
          depth: 1,
        },
      ],
      [
        'node-2',
        {
          nodeId: 'node-2',
          nodeType: 'LabTest',
          title: 'CBC',
          status: NodeStatus.EXCLUDED,
          confidence: 0.3,
          confidenceBreakdown: [],
          excludeReason: 'Not indicated',
          depth: 2,
        },
      ],
      [
        'node-3',
        {
          nodeId: 'node-3',
          nodeType: 'Procedure',
          title: 'Biopsy',
          status: NodeStatus.PENDING,
          confidence: 0.5,
          confidenceBreakdown: [],
          depth: 2,
        },
      ],
    ]);

    const json = serializeResolutionState(state);
    const parsed = JSON.parse(JSON.stringify(json));
    const restored = deserializeResolutionState(parsed);

    expect(restored.size).toBe(3);
    expect(restored.get('node-2')?.excludeReason).toBe('Not indicated');
    expect(restored.get('node-3')?.status).toBe(NodeStatus.PENDING);
  });

  it('should preserve provider override in NodeResult', () => {
    const state = new Map<string, NodeResult>([
      [
        'node-1',
        {
          nodeId: 'node-1',
          nodeType: 'Medication',
          title: 'Statins',
          status: NodeStatus.INCLUDED,
          confidence: 0.4,
          confidenceBreakdown: [],
          depth: 1,
          providerOverride: {
            action: 'include' as any,
            reason: 'Clinical judgment',
            originalStatus: NodeStatus.EXCLUDED,
            originalConfidence: 0.4,
          },
        },
      ],
    ]);

    const json = serializeResolutionState(state);
    const parsed = JSON.parse(JSON.stringify(json));
    const restored = deserializeResolutionState(parsed);

    const node = restored.get('node-1')!;
    expect(node.providerOverride).toBeDefined();
    expect(node.providerOverride!.reason).toBe('Clinical judgment');
    expect(node.providerOverride!.originalConfidence).toBe(0.4);
  });
});
