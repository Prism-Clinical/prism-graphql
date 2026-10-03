// apps/pathway-service/src/__tests__/compiler-gates.test.ts
import { compileChoice, compileGate, conditionProblem } from '../services/compiler/gates';
import type { CompileError, GraphEdgeIn, NodeKind } from '../services/compiler/model';

const arm = (from: string, to: string, when?: unknown): GraphEdgeIn =>
  ({ from, to, type: 'BRANCHES_TO', properties: (when === undefined ? null : { when }) as never });
const kinds = new Map<string, NodeKind>([['step-a', 'container'], ['step-b', 'container'], ['crit', 'annotation'], ['med', 'action']]);
const types = new Map([['step-a', 'Step'], ['step-b', 'Step'], ['crit', 'Criterion'], ['med', 'Medication']]);
const gate = (props: Record<string, unknown>, arms: GraphEdgeIn[]) => {
  const errors: CompileError[] = [];
  return { out: compileGate('g', props, arms, kinds, types, errors), errors };
};
const LAB = { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 7 };

describe('compileGate', () => {
  it('normalizes default_behavior case and a lowercase compound operator; null edge properties read as {}', () => {
    const { out, errors } = gate(
      { gate_type: 'compound', default_behavior: 'Traverse', operator: 'and', conditions: [LAB] },
      [arm('g', 'step-a')],
    );
    expect(errors).toEqual([]);
    expect(out!.gate).toEqual({ type: 'condition', conditions: [LAB], operator: 'AND', onUnresolved: 'ask', defaultBehavior: 'traverse' });
    expect(out!.arms).toEqual([{ id: 'g->step-a', target: 'step-a' }]);
  });

  it('Q13: a condition gate with several targets is an error that describes the legal shapes', () => {
    const { errors } = gate({ gate_type: 'patient_attribute', default_behavior: 'skip', condition: LAB }, [arm('g', 'step-a'), arm('g', 'step-b')]);
    expect(errors).toEqual([expect.objectContaining({
      code: 'MULTI_TARGET_NON_ROUTING_GATE',
      message: expect.stringMatching(/use one gate per target, or put the target Steps under one Stage and guard that Stage.*guard one Step that contains a DecisionPoint/),
    })]);
  });

  it('a routing (question) gate with several targets needs `when` on every arm', () => {
    const { errors } = gate(
      { gate_type: 'question', default_behavior: 'skip', answer_type: 'boolean' },
      [arm('g', 'step-a', { equals: true }), arm('g', 'step-b')],
    );
    expect(errors).toEqual([expect.objectContaining({ code: 'MISSING_WHEN', message: expect.stringContaining('step-b') })]);
  });

  it('rejects unknown vocabularies and a gate with no target', () => {
    const { errors } = gate({ gate_type: 'patient_attribute', default_behavior: 'maybe', on_unresolved: 'never', condition: LAB }, []);
    expect(errors.map((e) => e.code)).toEqual(['DEFAULT_BEHAVIOR', 'NO_TARGET', 'ON_UNRESOLVED']);
  });

  it('payloads: a condition gate needs a usable condition; a SELECT question needs options (any case); an LLM gate needs one safe default', () => {
    const codes = (p: Record<string, unknown>) => gate(p, [arm('g', 'step-a')]).errors.map((e) => e.code);
    expect(codes({ gate_type: 'patient_attribute', default_behavior: 'skip' })).toEqual(['PAYLOAD']);
    expect(codes({ gate_type: 'compound', default_behavior: 'skip', conditions: [] })).toEqual(['PAYLOAD']);
    expect(codes({ gate_type: 'question', default_behavior: 'skip', answer_type: 'SELECT' })).toEqual(['PAYLOAD']);
    expect(codes({ gate_type: 'question', default_behavior: 'skip', answer_type: 'SELECT', options: ['a', 'b'] })).toEqual([]);
    expect(codes({ gate_type: 'question', default_behavior: 'skip', answer_type: 'text' })).toEqual(['PAYLOAD']);
    expect(codes({ gate_type: 'llm_text_analysis', default_behavior: 'skip', branches: [{ name: 'a' }, { name: 'b' }] })).toEqual(['PAYLOAD']);
    expect(codes({ gate_type: 'llm_text_analysis', default_behavior: 'skip', branches: [{ name: 'a', is_safe_default: true }] })).toEqual([]);
  });

  it('V8: depends_on must be canonical, with an exact status, on a non-annotation, non-Medication target', () => {
    const bare = gate({ gate_type: 'prior_node_result', default_behavior: 'skip', depends_on: 'step-a' }, [arm('g', 'step-b')]);
    expect(bare.errors.map((e) => e.code)).toEqual(['DEPENDS_ON']);

    const bad = gate({
      gate_type: 'prior_node_result', default_behavior: 'skip',
      depends_on: [{ node_id: 'step-a', status: 'included' }, { node_id: 'crit', status: 'INCLUDED' }, { node_id: 'med', status: 'INCLUDED' }],
    }, [arm('g', 'step-b')]);
    expect(bad.errors.map((e) => e.message)).toEqual([
      expect.stringContaining('status "included"'),
      expect.stringContaining('"crit" is an annotation'),
      expect.stringContaining('"med" is a Medication'),
    ]);

    const good = gate({ gate_type: 'prior_node_result', default_behavior: 'skip', depends_on: [{ node_id: 'step-a', status: 'INCLUDED' }] }, [arm('g', 'step-b')]);
    expect(good.errors).toEqual([]);
    expect(good.out!.gate).toEqual({ type: 'prior_result', dependsOn: [{ nodeId: 'step-a', status: 'INCLUDED' }], defaultBehavior: 'skip' });
  });
});

describe('conditionProblem', () => {
  it.each([
    [{ attribute: 'patient.trimester', operator: 'less_than' }, 'needs a value'],
    [{ attribute: 'patient.trimester', operator: 'in', value: [] }, 'non-empty array'],
    [{ field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC' }, 'numeric threshold'],
    [{ field: 'labs', operator: 'less_than', value: '', threshold: 7 }, 'code value'],
    [{ operator: 'equals', value: 1 }, 'field or attribute'],
  ])('rejects %j', (c, fragment) => expect(conditionProblem(c)).toContain(fragment));

  it.each([
    [{ attribute: 'patient.trimester', operator: 'less_than', value: 3 }],
    [{ attribute: 'patient.trimester', operator: 'in', value: [1, 3] }],
    [{ attribute: 'allergy.metronidazole', operator: 'exists' }],
    [LAB],
    [{ field: 'conditions', operator: 'includes_code', value: 'O99.0*', system: 'ICD-10' }],
    [{ field: 'labs', operator: 'exists', value: '' }],
  ])('accepts %j', (c) => expect(conditionProblem(c)).toBeNull());
});

describe('compileChoice', () => {
  it('accepts arms without `when` and requires an exact branch_mode', () => {
    const errors: CompileError[] = [];
    expect(compileChoice('dp', { branch_mode: 'one_of' }, [arm('dp', 'step-b'), arm('dp', 'step-a')], errors))
      .toEqual({ mode: 'one_of', arms: [{ id: 'dp->step-a', target: 'step-a' }, { id: 'dp->step-b', target: 'step-b' }] });
    expect(errors).toEqual([]);

    compileChoice('dp', { branch_mode: 'ONE_OF' }, [arm('dp', 'step-a', { equals: true })], errors);
    expect(errors.map((e) => e.code)).toEqual(['BRANCH_MODE', 'CHOICE_ARM_WHEN']);
  });
});
