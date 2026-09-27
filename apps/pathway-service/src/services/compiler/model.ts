// apps/pathway-service/src/services/compiler/model.ts
import type { PathwayJson } from '../import/types';
import type { AttributeCodeMap } from '../resolution/types';
import type { PathwayTemporalDefaults } from '../resolution/temporal/cascade';

/** Bump whenever compiled output for the same input can change (it keys the cache). */
export const COMPILER_VERSION = '1';

export type NodeKind = 'root' | 'container' | 'gate' | 'choice' | 'action' | 'constraint' | 'item' | 'annotation';
export type EdgeKind = 'contains' | 'guards' | 'owns' | 'references' | 'prerequisite' | 'alternative';
export type DatumKey = string;
export type DefaultBehavior = 'skip' | 'traverse';

export interface DatumSpec {
  key: DatumKey;
  domain: 'lab' | 'vital' | 'allergy' | 'attribute';
  valueType: 'number' | 'boolean' | 'string';
  /** Gate ids that read this datum, sorted. */
  readBy: string[];
}

export interface GateArm { id: string; target: string; when?: unknown }
export interface ChoiceArm { id: string; target: string }
export interface ArmRef { controller: string; armId: string }

/**
 * Phase 1 keeps each condition as authored (it is validated); the condition IR
 * (spec §5.2) replaces `conditions` in phase 2.
 */
export type CompiledGate =
  | { type: 'condition'; conditions: Record<string, unknown>[]; operator: 'AND' | 'OR' | null; onUnresolved: 'ask' | 'default'; defaultBehavior: DefaultBehavior }
  | { type: 'question'; answerType: 'boolean' | 'numeric' | 'select'; options: string[]; defaultBehavior: DefaultBehavior }
  | { type: 'prior_result'; dependsOn: { nodeId: string; status: string }[]; defaultBehavior: DefaultBehavior }
  | { type: 'llm'; properties: Record<string, unknown>; defaultBehavior: DefaultBehavior };

export type CompiledNode =
  | { kind: 'root' | 'container' | 'item' | 'action' | 'constraint' | 'annotation'; id: string; nodeType: string; properties: Record<string, unknown> }
  | { kind: 'gate'; id: string; nodeType: 'Gate'; properties: Record<string, unknown>; gate: CompiledGate; arms: GateArm[] }
  | { kind: 'choice'; id: string; nodeType: 'DecisionPoint'; properties: Record<string, unknown>; mode: 'one_of' | 'all_of' | 'any_of'; arms: ChoiceArm[] };

export interface CompiledPathway {
  compilerVersion: string;
  nodes: ReadonlyMap<string, CompiledNode>;
  /** Semantic nodes, topological over contains ∪ guards ∪ data, ties by nodeId. */
  order: string[];
  /** Annotations, topological over owns, ties by nodeId (spec §4.8). */
  annotationOrder: string[];
  containers: ReadonlyMap<string, string[]>;
  guards: ReadonlyMap<string, ArmRef[]>;
  owners: ReadonlyMap<string, string[]>;
  datums: ReadonlyMap<DatumKey, DatumSpec>;
  requiresEncounterAnchor: boolean;
}

export type CompileErrorCode =
  | 'VALIDATION' | 'UNKNOWN_NODE_TYPE' | 'UNKNOWN_EDGE_TYPE' | 'UNREACHABLE' | 'ORPHAN_ANNOTATION' | 'CYCLE'
  | 'GATE_TYPE' | 'DEFAULT_BEHAVIOR' | 'ON_UNRESOLVED' | 'COMPOUND_OPERATOR' | 'NO_TARGET'
  | 'MULTI_TARGET_NON_ROUTING_GATE' | 'MISSING_WHEN' | 'CHOICE_ARM_WHEN' | 'BRANCH_MODE' | 'DEPENDS_ON'
  | 'UNMAPPED_ATTRIBUTE' | 'UNKNOWN_PATIENT_ATTRIBUTE' | 'TEMPORAL' | 'NOT_FOUND' | 'PAYLOAD' | 'DATUM_TYPE' | 'RESERVED_ROOT';

export interface CompileError { code: CompileErrorCode; message: string; nodeId?: string }
export type CompileResult = { ok: true; model: CompiledPathway } | { ok: false; errors: CompileError[] };

export interface CompileInput {
  pathway: PathwayJson;
  codeMap: AttributeCodeMap;
  temporalDefaults: PathwayTemporalDefaults;
}

/** The compiler's internal graph shape: the root is an ordinary node with id "root". */
export interface GraphNodeIn { id: string; type: string; properties: Record<string, unknown> }
export interface GraphEdgeIn { from: string; to: string; type: string; properties: Record<string, unknown> }
