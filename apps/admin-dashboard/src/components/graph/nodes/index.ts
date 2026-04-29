import { StageNode } from './StageNode';
import { StepNode } from './StepNode';
import { DecisionPointNode } from './DecisionPointNode';
import { CriterionNode } from './CriterionNode';
import { MedicationNode } from './MedicationNode';
import { LabTestNode } from './LabTestNode';
import { ProcedureNode } from './ProcedureNode';
import { CodeEntryNode } from './CodeEntryNode';
import { EvidenceCitationNode } from './EvidenceCitationNode';
import { QualityMetricNode } from './QualityMetricNode';
import { ScheduleNode } from './ScheduleNode';

/**
 * Node types registry for React Flow.
 * IMPORTANT: This object must be defined outside component render
 * to avoid React Flow re-mounting nodes on every render.
 */
export const nodeTypes = {
  Stage: StageNode,
  Step: StepNode,
  DecisionPoint: DecisionPointNode,
  Criterion: CriterionNode,
  Medication: MedicationNode,
  LabTest: LabTestNode,
  Procedure: ProcedureNode,
  CodeEntry: CodeEntryNode,
  EvidenceCitation: EvidenceCitationNode,
  QualityMetric: QualityMetricNode,
  Schedule: ScheduleNode,
};
