# Admin Dashboard Plan 2: Graph Editor Core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive React Flow graph editor to the admin dashboard with custom node components for all 11 pathway node types, a draggable node palette, edge constraint validation, auto-layout, and a properties panel for editing node data.

**Architecture:** React Flow v12 (`@xyflow/react`) provides the canvas. Each of the 11 pathway node types gets a custom React Flow node component with type-specific styling and source/target handles. A `NodePalette` sidebar lets admins drag new nodes onto the canvas. `EdgeConstraintValidator` enforces the `VALID_EDGE_ENDPOINTS` rules at connection time. Dagre provides hierarchical auto-layout. A right-side `PropertiesPanel` shows type-specific forms when a node is selected. The editor page replaces the stub at `/pathways/[id]`.

**Tech Stack:** @xyflow/react 12.x, dagre, existing Next.js 16 / React 19 / TypeScript 5 / Tailwind CSS 4 stack

**Spec:** `prism-graphql/docs/superpowers/specs/2026-03-31-admin-dashboard-pathway-editor-design.md` (Sections 5 & 8)

**Depends on:** Plan 1 (scaffold, completed)

---

## File Structure

```
prism-admin-dashboard/src/
├── components/
│   ├── graph/
│   │   ├── PathwayCanvas.tsx          # Main React Flow wrapper with state management
│   │   ├── NodePalette.tsx            # Draggable sidebar of node types
│   │   ├── EdgeConstraintValidator.ts # Connection validation logic
│   │   ├── AutoLayout.ts             # Dagre-based hierarchical layout
│   │   ├── nodeConfig.ts             # Node type metadata: colors, icons, labels, handles
│   │   └── nodes/
│   │       ├── BaseNode.tsx           # Shared node shell (handles, selection ring, header)
│   │       ├── StageNode.tsx
│   │       ├── StepNode.tsx
│   │       ├── DecisionPointNode.tsx
│   │       ├── CriterionNode.tsx
│   │       ├── MedicationNode.tsx
│   │       ├── LabTestNode.tsx
│   │       ├── ProcedureNode.tsx
│   │       ├── CodeEntryNode.tsx
│   │       ├── EvidenceCitationNode.tsx
│   │       ├── QualityMetricNode.tsx
│   │       ├── ScheduleNode.tsx
│   │       └── index.ts              # nodeTypes registry object
│   └── editor/
│       ├── PropertiesPanel.tsx        # Right sidebar: type-specific property forms
│       ├── EditorToolbar.tsx          # Top bar: layout, undo/redo, zoom controls
│       └── propertyFields.ts         # Field definitions per node type
├── lib/
│   └── hooks/
│       └── useUndoRedo.ts            # Undo/redo state management for nodes + edges
├── types/
│   └── index.ts                       # Add PathwayNodeType, PathwayEdgeType, graph types
└── app/
    └── pathways/
        └── [id]/
            └── page.tsx               # Replace stub with editor layout
```

---

### Task 1: Install Dependencies

**Files:**
- Modify: `prism-admin-dashboard/package.json`

- [ ] **Step 1: Install React Flow and dagre**

Run:
```bash
npm --prefix /home/claude/workspace/prism-admin-dashboard install @xyflow/react dagre @types/dagre
```

- [ ] **Step 2: Verify installation**

Run:
```bash
npm --prefix /home/claude/workspace/prism-admin-dashboard ls @xyflow/react dagre
```

Expected: Both packages listed with versions.

- [ ] **Step 3: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add package.json package-lock.json
git -C /home/claude/workspace/prism-admin-dashboard commit -m "chore: add @xyflow/react and dagre dependencies"
```

---

### Task 2: Extend Types for Graph Editor

**Files:**
- Modify: `prism-admin-dashboard/src/types/index.ts`

- [ ] **Step 1: Add graph-related types**

Append to `prism-admin-dashboard/src/types/index.ts`:

```typescript
// ─── Graph Editor Types ─────────────────────────────────────────────

export type PathwayNodeType =
  | 'Stage'
  | 'Step'
  | 'DecisionPoint'
  | 'Criterion'
  | 'CodeEntry'
  | 'Medication'
  | 'LabTest'
  | 'Procedure'
  | 'EvidenceCitation'
  | 'QualityMetric'
  | 'Schedule';

export type PathwayEdgeType =
  | 'HAS_STAGE'
  | 'HAS_STEP'
  | 'HAS_DECISION_POINT'
  | 'HAS_CRITERION'
  | 'BRANCHES_TO'
  | 'USES_MEDICATION'
  | 'ESCALATES_TO'
  | 'CITES_EVIDENCE'
  | 'HAS_LAB_TEST'
  | 'HAS_PROCEDURE'
  | 'HAS_QUALITY_METRIC'
  | 'HAS_SCHEDULE'
  | 'HAS_CODE';

/** Data stored on each React Flow node */
export interface PathwayNodeData {
  pathwayNodeType: PathwayNodeType;
  pathwayNodeId: string;
  label: string;
  properties: Record<string, unknown>;
}

/** Data stored on each React Flow edge */
export interface PathwayEdgeData {
  pathwayEdgeType: PathwayEdgeType;
  properties?: Record<string, unknown>;
}

/** Valid edge endpoint constraints — mirrors backend VALID_EDGE_ENDPOINTS */
export const VALID_EDGE_ENDPOINTS: Record<PathwayEdgeType, { from: ('root' | PathwayNodeType)[]; to: PathwayNodeType[] }> = {
  HAS_STAGE:          { from: ['root'],          to: ['Stage'] },
  HAS_STEP:           { from: ['Stage'],          to: ['Step'] },
  HAS_DECISION_POINT: { from: ['Step'],           to: ['DecisionPoint'] },
  HAS_CRITERION:      { from: ['DecisionPoint'],  to: ['Criterion'] },
  BRANCHES_TO:        { from: ['DecisionPoint'],  to: ['Step', 'Stage'] },
  USES_MEDICATION:    { from: ['Step'],           to: ['Medication'] },
  ESCALATES_TO:       { from: ['Medication'],     to: ['Medication'] },
  CITES_EVIDENCE:     { from: ['Stage', 'Step', 'DecisionPoint', 'Criterion', 'Medication', 'LabTest', 'Procedure'], to: ['EvidenceCitation'] },
  HAS_LAB_TEST:       { from: ['Step'],           to: ['LabTest'] },
  HAS_PROCEDURE:      { from: ['Step'],           to: ['Procedure'] },
  HAS_QUALITY_METRIC: { from: ['Step'],           to: ['QualityMetric'] },
  HAS_SCHEDULE:       { from: ['Step'],           to: ['Schedule'] },
  HAS_CODE:           { from: ['Step', 'Criterion', 'Medication', 'LabTest', 'Procedure'], to: ['CodeEntry'] },
};

/** Required properties per node type — mirrors backend REQUIRED_NODE_PROPERTIES */
export const REQUIRED_NODE_PROPERTIES: Record<PathwayNodeType, string[]> = {
  Stage:            ['stage_number', 'title'],
  Step:             ['stage_number', 'step_number', 'display_number', 'title'],
  DecisionPoint:    ['title'],
  Criterion:        ['description'],
  CodeEntry:        ['system', 'code'],
  Medication:       ['name', 'role'],
  LabTest:          ['name'],
  Procedure:        ['name'],
  EvidenceCitation: ['reference_number', 'title', 'evidence_level'],
  QualityMetric:    ['name', 'measure'],
  Schedule:         ['interval', 'description'],
};
```

- [ ] **Step 2: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/types/index.ts
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add graph editor types, edge constraints, and required properties"
```

---

### Task 3: Node Configuration Registry

**Files:**
- Create: `prism-admin-dashboard/src/components/graph/nodeConfig.ts`

- [ ] **Step 1: Create node config with colors, icons, labels, and handle rules**

Create `prism-admin-dashboard/src/components/graph/nodeConfig.ts`:

```typescript
import type { PathwayNodeType } from '@/types';

export interface NodeTypeConfig {
  label: string;
  category: 'structural' | 'clinical' | 'supporting';
  color: string;          // Tailwind bg class for the node header
  borderColor: string;    // Tailwind border class
  textColor: string;      // Tailwind text class for the header
  bgColor: string;        // Tailwind bg class for the node body
  icon: string;           // Emoji icon (simple, no dep needed)
  defaultWidth: number;
  defaultHeight: number;
  /** Whether this node type can be a source (have outgoing edges) */
  canBeSource: boolean;
  /** Whether this node type can be a target (have incoming edges) */
  canBeTarget: boolean;
}

export const NODE_CONFIG: Record<PathwayNodeType, NodeTypeConfig> = {
  Stage: {
    label: 'Stage',
    category: 'structural',
    color: 'bg-blue-500',
    borderColor: 'border-blue-300',
    textColor: 'text-white',
    bgColor: 'bg-blue-50',
    icon: '\u{1F4CB}',
    defaultWidth: 220,
    defaultHeight: 80,
    canBeSource: true,
    canBeTarget: true,
  },
  Step: {
    label: 'Step',
    category: 'structural',
    color: 'bg-emerald-500',
    borderColor: 'border-emerald-300',
    textColor: 'text-white',
    bgColor: 'bg-emerald-50',
    icon: '\u{25B6}\u{FE0F}',
    defaultWidth: 220,
    defaultHeight: 80,
    canBeSource: true,
    canBeTarget: true,
  },
  DecisionPoint: {
    label: 'Decision Point',
    category: 'structural',
    color: 'bg-amber-500',
    borderColor: 'border-amber-300',
    textColor: 'text-white',
    bgColor: 'bg-amber-50',
    icon: '\u{2753}',
    defaultWidth: 200,
    defaultHeight: 80,
    canBeSource: true,
    canBeTarget: true,
  },
  Criterion: {
    label: 'Criterion',
    category: 'supporting',
    color: 'bg-gray-500',
    borderColor: 'border-gray-300',
    textColor: 'text-white',
    bgColor: 'bg-gray-50',
    icon: '\u{2714}\u{FE0F}',
    defaultWidth: 180,
    defaultHeight: 60,
    canBeSource: true,
    canBeTarget: true,
  },
  Medication: {
    label: 'Medication',
    category: 'clinical',
    color: 'bg-purple-500',
    borderColor: 'border-purple-300',
    textColor: 'text-white',
    bgColor: 'bg-purple-50',
    icon: '\u{1F48A}',
    defaultWidth: 200,
    defaultHeight: 70,
    canBeSource: true,
    canBeTarget: true,
  },
  LabTest: {
    label: 'Lab Test',
    category: 'clinical',
    color: 'bg-teal-500',
    borderColor: 'border-teal-300',
    textColor: 'text-white',
    bgColor: 'bg-teal-50',
    icon: '\u{1F9EA}',
    defaultWidth: 180,
    defaultHeight: 60,
    canBeSource: true,
    canBeTarget: true,
  },
  Procedure: {
    label: 'Procedure',
    category: 'clinical',
    color: 'bg-orange-500',
    borderColor: 'border-orange-300',
    textColor: 'text-white',
    bgColor: 'bg-orange-50',
    icon: '\u{1FA7A}',
    defaultWidth: 180,
    defaultHeight: 60,
    canBeSource: true,
    canBeTarget: true,
  },
  CodeEntry: {
    label: 'Code',
    category: 'supporting',
    color: 'bg-slate-500',
    borderColor: 'border-slate-300',
    textColor: 'text-white',
    bgColor: 'bg-slate-50',
    icon: '\u{1F3F7}\u{FE0F}',
    defaultWidth: 160,
    defaultHeight: 50,
    canBeSource: false,
    canBeTarget: true,
  },
  EvidenceCitation: {
    label: 'Evidence',
    category: 'supporting',
    color: 'bg-indigo-500',
    borderColor: 'border-indigo-300',
    textColor: 'text-white',
    bgColor: 'bg-indigo-50',
    icon: '\u{1F4DA}',
    defaultWidth: 200,
    defaultHeight: 60,
    canBeSource: false,
    canBeTarget: true,
  },
  QualityMetric: {
    label: 'Quality Metric',
    category: 'supporting',
    color: 'bg-emerald-600',
    borderColor: 'border-emerald-400',
    textColor: 'text-white',
    bgColor: 'bg-emerald-50',
    icon: '\u{1F4CA}',
    defaultWidth: 180,
    defaultHeight: 60,
    canBeSource: false,
    canBeTarget: true,
  },
  Schedule: {
    label: 'Schedule',
    category: 'supporting',
    color: 'bg-cyan-500',
    borderColor: 'border-cyan-300',
    textColor: 'text-white',
    bgColor: 'bg-cyan-50',
    icon: '\u{1F552}',
    defaultWidth: 180,
    defaultHeight: 60,
    canBeSource: false,
    canBeTarget: true,
  },
};

/** All node types, grouped by category for the palette */
export const NODE_CATEGORIES = {
  structural: ['Stage', 'Step', 'DecisionPoint'] as PathwayNodeType[],
  clinical: ['Medication', 'LabTest', 'Procedure'] as PathwayNodeType[],
  supporting: ['Criterion', 'CodeEntry', 'EvidenceCitation', 'QualityMetric', 'Schedule'] as PathwayNodeType[],
};
```

- [ ] **Step 2: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/components/graph/nodeConfig.ts
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add node type configuration registry with colors and categories"
```

---

### Task 4: BaseNode Component

**Files:**
- Create: `prism-admin-dashboard/src/components/graph/nodes/BaseNode.tsx`

- [ ] **Step 1: Create the shared base node wrapper**

Create `prism-admin-dashboard/src/components/graph/nodes/BaseNode.tsx`:

```tsx
import { Handle, Position } from '@xyflow/react';
import clsx from 'clsx';
import { NODE_CONFIG } from '../nodeConfig';
import type { PathwayNodeType } from '@/types';

interface BaseNodeProps {
  pathwayNodeType: PathwayNodeType;
  label: string;
  selected: boolean;
  children?: React.ReactNode;
}

export function BaseNode({ pathwayNodeType, label, selected, children }: BaseNodeProps) {
  const config = NODE_CONFIG[pathwayNodeType];

  return (
    <div
      className={clsx(
        'rounded-xl border-2 shadow-sm min-w-[140px] max-w-[280px] transition-shadow',
        config.borderColor,
        config.bgColor,
        selected && 'ring-2 ring-blue-500 ring-offset-2 shadow-md'
      )}
    >
      {/* Header */}
      <div className={clsx(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-t-[10px] text-xs font-semibold',
        config.color,
        config.textColor
      )}>
        <span>{config.icon}</span>
        <span>{config.label}</span>
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        <div className="text-sm font-medium text-gray-900 truncate">{label}</div>
        {children}
      </div>

      {/* Handles */}
      {config.canBeTarget && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"
        />
      )}
      {config.canBeSource && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/components/graph/nodes/BaseNode.tsx
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add BaseNode component with handles and type-specific styling"
```

---

### Task 5: Custom Node Components (All 11 Types)

**Files:**
- Create: `prism-admin-dashboard/src/components/graph/nodes/StageNode.tsx`
- Create: `prism-admin-dashboard/src/components/graph/nodes/StepNode.tsx`
- Create: `prism-admin-dashboard/src/components/graph/nodes/DecisionPointNode.tsx`
- Create: `prism-admin-dashboard/src/components/graph/nodes/CriterionNode.tsx`
- Create: `prism-admin-dashboard/src/components/graph/nodes/MedicationNode.tsx`
- Create: `prism-admin-dashboard/src/components/graph/nodes/LabTestNode.tsx`
- Create: `prism-admin-dashboard/src/components/graph/nodes/ProcedureNode.tsx`
- Create: `prism-admin-dashboard/src/components/graph/nodes/CodeEntryNode.tsx`
- Create: `prism-admin-dashboard/src/components/graph/nodes/EvidenceCitationNode.tsx`
- Create: `prism-admin-dashboard/src/components/graph/nodes/QualityMetricNode.tsx`
- Create: `prism-admin-dashboard/src/components/graph/nodes/ScheduleNode.tsx`
- Create: `prism-admin-dashboard/src/components/graph/nodes/index.ts`

- [ ] **Step 1: Create StageNode**

Create `prism-admin-dashboard/src/components/graph/nodes/StageNode.tsx`:

```tsx
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { PathwayNodeData } from '@/types';

export function StageNode({ data, selected }: NodeProps) {
  const nodeData = data as PathwayNodeData;
  const props = nodeData.properties;

  return (
    <BaseNode pathwayNodeType="Stage" label={nodeData.label} selected={!!selected}>
      {props.description && (
        <div className="text-xs text-gray-500 mt-1 line-clamp-2">{String(props.description)}</div>
      )}
      <div className="text-xs text-blue-600 font-mono mt-1">Stage {String(props.stage_number ?? '?')}</div>
    </BaseNode>
  );
}
```

- [ ] **Step 2: Create StepNode**

Create `prism-admin-dashboard/src/components/graph/nodes/StepNode.tsx`:

```tsx
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { PathwayNodeData } from '@/types';

export function StepNode({ data, selected }: NodeProps) {
  const nodeData = data as PathwayNodeData;
  const props = nodeData.properties;

  return (
    <BaseNode pathwayNodeType="Step" label={nodeData.label} selected={!!selected}>
      {props.description && (
        <div className="text-xs text-gray-500 mt-1 line-clamp-2">{String(props.description)}</div>
      )}
      <div className="text-xs text-emerald-600 font-mono mt-1">{String(props.display_number ?? '?')}</div>
    </BaseNode>
  );
}
```

- [ ] **Step 3: Create DecisionPointNode**

Create `prism-admin-dashboard/src/components/graph/nodes/DecisionPointNode.tsx`:

```tsx
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { PathwayNodeData } from '@/types';

export function DecisionPointNode({ data, selected }: NodeProps) {
  const nodeData = data as PathwayNodeData;
  const props = nodeData.properties;

  return (
    <BaseNode pathwayNodeType="DecisionPoint" label={nodeData.label} selected={!!selected}>
      {props.auto_resolve_eligible && (
        <div className="text-xs text-amber-600 mt-1">Auto-resolvable</div>
      )}
    </BaseNode>
  );
}
```

- [ ] **Step 4: Create CriterionNode**

Create `prism-admin-dashboard/src/components/graph/nodes/CriterionNode.tsx`:

```tsx
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { PathwayNodeData } from '@/types';

export function CriterionNode({ data, selected }: NodeProps) {
  const nodeData = data as PathwayNodeData;
  const props = nodeData.properties;

  return (
    <BaseNode pathwayNodeType="Criterion" label={nodeData.label} selected={!!selected}>
      {props.is_critical && (
        <div className="text-xs text-red-500 font-medium mt-1">Critical</div>
      )}
    </BaseNode>
  );
}
```

- [ ] **Step 5: Create MedicationNode**

Create `prism-admin-dashboard/src/components/graph/nodes/MedicationNode.tsx`:

```tsx
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import clsx from 'clsx';
import type { PathwayNodeData } from '@/types';

const roleBadge: Record<string, string> = {
  preferred: 'bg-green-100 text-green-700',
  acceptable: 'bg-blue-100 text-blue-700',
  avoid: 'bg-yellow-100 text-yellow-700',
  contraindicated: 'bg-red-100 text-red-700',
};

export function MedicationNode({ data, selected }: NodeProps) {
  const nodeData = data as PathwayNodeData;
  const props = nodeData.properties;
  const role = String(props.role ?? 'acceptable');

  return (
    <BaseNode pathwayNodeType="Medication" label={nodeData.label} selected={!!selected}>
      <div className="flex items-center gap-2 mt-1">
        <span className={clsx('text-xs px-1.5 py-0.5 rounded font-medium', roleBadge[role] ?? 'bg-gray-100 text-gray-600')}>
          {role}
        </span>
      </div>
      {props.dose && (
        <div className="text-xs text-gray-500 mt-1">{String(props.dose)}</div>
      )}
    </BaseNode>
  );
}
```

- [ ] **Step 6: Create LabTestNode**

Create `prism-admin-dashboard/src/components/graph/nodes/LabTestNode.tsx`:

```tsx
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { PathwayNodeData } from '@/types';

export function LabTestNode({ data, selected }: NodeProps) {
  const nodeData = data as PathwayNodeData;
  const props = nodeData.properties;

  return (
    <BaseNode pathwayNodeType="LabTest" label={nodeData.label} selected={!!selected}>
      {props.code_value && (
        <div className="text-xs text-teal-600 font-mono mt-1">
          {String(props.code_system ?? '')}: {String(props.code_value)}
        </div>
      )}
    </BaseNode>
  );
}
```

- [ ] **Step 7: Create ProcedureNode**

Create `prism-admin-dashboard/src/components/graph/nodes/ProcedureNode.tsx`:

```tsx
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { PathwayNodeData } from '@/types';

export function ProcedureNode({ data, selected }: NodeProps) {
  const nodeData = data as PathwayNodeData;
  const props = nodeData.properties;

  return (
    <BaseNode pathwayNodeType="Procedure" label={nodeData.label} selected={!!selected}>
      {props.code_value && (
        <div className="text-xs text-orange-600 font-mono mt-1">
          {String(props.code_system ?? '')}: {String(props.code_value)}
        </div>
      )}
    </BaseNode>
  );
}
```

- [ ] **Step 8: Create CodeEntryNode**

Create `prism-admin-dashboard/src/components/graph/nodes/CodeEntryNode.tsx`:

```tsx
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { PathwayNodeData } from '@/types';

export function CodeEntryNode({ data, selected }: NodeProps) {
  const nodeData = data as PathwayNodeData;
  const props = nodeData.properties;

  return (
    <BaseNode pathwayNodeType="CodeEntry" label={String(props.code ?? nodeData.label)} selected={!!selected}>
      <div className="text-xs text-slate-600 font-mono">
        {String(props.system ?? '')}
      </div>
      {props.description && (
        <div className="text-xs text-gray-500 mt-0.5 truncate">{String(props.description)}</div>
      )}
    </BaseNode>
  );
}
```

- [ ] **Step 9: Create EvidenceCitationNode**

Create `prism-admin-dashboard/src/components/graph/nodes/EvidenceCitationNode.tsx`:

```tsx
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { PathwayNodeData } from '@/types';

export function EvidenceCitationNode({ data, selected }: NodeProps) {
  const nodeData = data as PathwayNodeData;
  const props = nodeData.properties;

  return (
    <BaseNode pathwayNodeType="EvidenceCitation" label={nodeData.label} selected={!!selected}>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-xs font-mono text-indigo-600">[{String(props.reference_number ?? '?')}]</span>
        <span className="text-xs text-gray-500">{String(props.evidence_level ?? '')}</span>
      </div>
    </BaseNode>
  );
}
```

- [ ] **Step 10: Create QualityMetricNode**

Create `prism-admin-dashboard/src/components/graph/nodes/QualityMetricNode.tsx`:

```tsx
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { PathwayNodeData } from '@/types';

export function QualityMetricNode({ data, selected }: NodeProps) {
  const nodeData = data as PathwayNodeData;
  const props = nodeData.properties;

  return (
    <BaseNode pathwayNodeType="QualityMetric" label={nodeData.label} selected={!!selected}>
      {props.measure && (
        <div className="text-xs text-gray-500 mt-1 line-clamp-2">{String(props.measure)}</div>
      )}
    </BaseNode>
  );
}
```

- [ ] **Step 11: Create ScheduleNode**

Create `prism-admin-dashboard/src/components/graph/nodes/ScheduleNode.tsx`:

```tsx
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { PathwayNodeData } from '@/types';

export function ScheduleNode({ data, selected }: NodeProps) {
  const nodeData = data as PathwayNodeData;
  const props = nodeData.properties;

  return (
    <BaseNode pathwayNodeType="Schedule" label={nodeData.label} selected={!!selected}>
      <div className="text-xs text-cyan-600 mt-1">{String(props.interval ?? '')}</div>
    </BaseNode>
  );
}
```

- [ ] **Step 12: Create nodeTypes registry**

Create `prism-admin-dashboard/src/components/graph/nodes/index.ts`:

```typescript
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
```

- [ ] **Step 13: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/components/graph/nodes/
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add all 11 custom node components with type-specific rendering"
```

---

### Task 6: Edge Constraint Validator

**Files:**
- Create: `prism-admin-dashboard/src/components/graph/EdgeConstraintValidator.ts`

- [ ] **Step 1: Create the validator**

Create `prism-admin-dashboard/src/components/graph/EdgeConstraintValidator.ts`:

```typescript
import type { Node, Edge, Connection } from '@xyflow/react';
import { VALID_EDGE_ENDPOINTS, type PathwayNodeType, type PathwayEdgeType, type PathwayNodeData } from '@/types';

/**
 * Finds all valid edge types that can connect a source node type to a target node type.
 */
export function getValidEdgeTypes(
  sourceType: PathwayNodeType | 'root',
  targetType: PathwayNodeType
): PathwayEdgeType[] {
  const valid: PathwayEdgeType[] = [];
  for (const [edgeType, endpoints] of Object.entries(VALID_EDGE_ENDPOINTS)) {
    if (endpoints.from.includes(sourceType) && endpoints.to.includes(targetType)) {
      valid.push(edgeType as PathwayEdgeType);
    }
  }
  return valid;
}

/**
 * Checks whether a proposed connection is valid.
 * Returns the valid edge types if the connection is allowed, or an empty array if not.
 */
export function validateConnection(
  connection: Connection,
  nodes: Node[]
): PathwayEdgeType[] {
  if (!connection.source || !connection.target) return [];
  if (connection.source === connection.target) return [];

  const sourceNode = nodes.find(n => n.id === connection.source);
  const targetNode = nodes.find(n => n.id === connection.target);
  if (!sourceNode || !targetNode) return [];

  const sourceType = (sourceNode.data as PathwayNodeData).pathwayNodeType;
  const targetType = (targetNode.data as PathwayNodeData).pathwayNodeType;

  return getValidEdgeTypes(sourceType, targetType);
}

/**
 * Given a source node type, returns all node types that can be valid targets.
 */
export function getValidTargetTypes(sourceType: PathwayNodeType): PathwayNodeType[] {
  const targets = new Set<PathwayNodeType>();
  for (const endpoints of Object.values(VALID_EDGE_ENDPOINTS)) {
    if (endpoints.from.includes(sourceType)) {
      endpoints.to.forEach(t => targets.add(t));
    }
  }
  return [...targets];
}

/**
 * Checks if connecting source to target would create a cycle.
 * Uses BFS from target to see if it can reach source.
 */
export function wouldCreateCycle(
  sourceId: string,
  targetId: string,
  edges: Edge[]
): boolean {
  const visited = new Set<string>();
  const queue = [targetId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === sourceId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const edge of edges) {
      if (edge.target === current) {
        queue.push(edge.source);
      }
    }
  }

  return false;
}
```

- [ ] **Step 2: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/components/graph/EdgeConstraintValidator.ts
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add edge constraint validator with cycle detection"
```

---

### Task 7: Auto-Layout with Dagre

**Files:**
- Create: `prism-admin-dashboard/src/components/graph/AutoLayout.ts`

- [ ] **Step 1: Create the dagre layout utility**

Create `prism-admin-dashboard/src/components/graph/AutoLayout.ts`:

```typescript
import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';
import { NODE_CONFIG } from './nodeConfig';
import type { PathwayNodeData } from '@/types';

interface LayoutOptions {
  direction?: 'TB' | 'LR';
  nodeSpacing?: number;
  rankSpacing?: number;
}

/**
 * Applies dagre hierarchical layout to React Flow nodes.
 * Returns new node array with updated positions. Edges are unchanged.
 */
export function applyAutoLayout(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {}
): Node[] {
  const { direction = 'TB', nodeSpacing = 40, rankSpacing = 80 } = options;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: nodeSpacing,
    ranksep: rankSpacing,
    marginx: 40,
    marginy: 40,
  });

  // Add nodes with their dimensions
  for (const node of nodes) {
    const nodeData = node.data as PathwayNodeData;
    const config = NODE_CONFIG[nodeData.pathwayNodeType];
    g.setNode(node.id, {
      width: node.measured?.width ?? config.defaultWidth,
      height: node.measured?.height ?? config.defaultHeight,
    });
  }

  // Add edges
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  // Run layout
  dagre.layout(g);

  // Map positions back to React Flow nodes
  return nodes.map(node => {
    const dagreNode = g.node(node.id);
    if (!dagreNode) return node;

    const nodeData = node.data as PathwayNodeData;
    const config = NODE_CONFIG[nodeData.pathwayNodeType];
    const width = node.measured?.width ?? config.defaultWidth;
    const height = node.measured?.height ?? config.defaultHeight;

    return {
      ...node,
      position: {
        x: dagreNode.x - width / 2,
        y: dagreNode.y - height / 2,
      },
    };
  });
}
```

- [ ] **Step 2: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/components/graph/AutoLayout.ts
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add dagre-based auto-layout utility"
```

---

### Task 8: Undo/Redo Hook

**Files:**
- Create: `prism-admin-dashboard/src/lib/hooks/useUndoRedo.ts`

- [ ] **Step 1: Create the undo/redo hook**

Create `prism-admin-dashboard/src/lib/hooks/useUndoRedo.ts`:

```typescript
import { useCallback, useRef } from 'react';
import type { Node, Edge } from '@xyflow/react';

interface Snapshot {
  nodes: Node[];
  edges: Edge[];
}

const MAX_HISTORY = 50;

/**
 * Manages undo/redo history for the graph editor.
 * Call `takeSnapshot` before making changes to push the current state onto the stack.
 */
export function useUndoRedo(
  nodes: Node[],
  edges: Edge[],
  setNodes: (nodes: Node[]) => void,
  setEdges: (edges: Edge[]) => void,
) {
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);

  const takeSnapshot = useCallback(() => {
    past.current = [
      ...past.current.slice(-(MAX_HISTORY - 1)),
      { nodes: structuredClone(nodes), edges: structuredClone(edges) },
    ];
    future.current = [];
  }, [nodes, edges]);

  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (!previous) return;

    future.current.push({ nodes: structuredClone(nodes), edges: structuredClone(edges) });
    setNodes(previous.nodes);
    setEdges(previous.edges);
  }, [nodes, edges, setNodes, setEdges]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;

    past.current.push({ nodes: structuredClone(nodes), edges: structuredClone(edges) });
    setNodes(next.nodes);
    setEdges(next.edges);
  }, [nodes, edges, setNodes, setEdges]);

  const canUndo = past.current.length > 0;
  const canRedo = future.current.length > 0;

  return { takeSnapshot, undo, redo, canUndo, canRedo };
}
```

- [ ] **Step 2: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/lib/hooks/useUndoRedo.ts
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add undo/redo hook for graph editor state"
```

---

### Task 9: Node Palette

**Files:**
- Create: `prism-admin-dashboard/src/components/graph/NodePalette.tsx`

- [ ] **Step 1: Create the draggable node palette**

Create `prism-admin-dashboard/src/components/graph/NodePalette.tsx`:

```tsx
'use client';

import clsx from 'clsx';
import { NODE_CONFIG, NODE_CATEGORIES } from './nodeConfig';
import type { PathwayNodeType } from '@/types';

const categoryLabels: Record<string, string> = {
  structural: 'Structural',
  clinical: 'Clinical',
  supporting: 'Supporting',
};

function PaletteItem({ nodeType }: { nodeType: PathwayNodeType }) {
  const config = NODE_CONFIG[nodeType];

  function onDragStart(event: React.DragEvent) {
    event.dataTransfer.setData('application/reactflow-nodetype', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={clsx(
        'flex items-center gap-2 px-3 py-2 rounded-lg border cursor-grab active:cursor-grabbing',
        'hover:shadow-sm transition-all text-sm',
        config.borderColor,
        config.bgColor
      )}
    >
      <span>{config.icon}</span>
      <span className="font-medium text-gray-700">{config.label}</span>
    </div>
  );
}

export function NodePalette() {
  return (
    <div className="w-56 bg-white border-r border-gray-200 p-4 overflow-y-auto flex-shrink-0">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
        Node Palette
      </h3>
      <p className="text-xs text-gray-400 mb-4">Drag nodes onto the canvas</p>

      {Object.entries(NODE_CATEGORIES).map(([category, types]) => (
        <div key={category} className="mb-4">
          <h4 className="text-xs font-medium text-gray-500 mb-2">
            {categoryLabels[category]}
          </h4>
          <div className="space-y-1.5">
            {types.map(nodeType => (
              <PaletteItem key={nodeType} nodeType={nodeType} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/components/graph/NodePalette.tsx
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add draggable node palette with categorized node types"
```

---

### Task 10: Property Field Definitions

**Files:**
- Create: `prism-admin-dashboard/src/components/editor/propertyFields.ts`

- [ ] **Step 1: Define the property fields for each node type**

Create `prism-admin-dashboard/src/components/editor/propertyFields.ts`:

```typescript
import type { PathwayNodeType } from '@/types';

export type FieldType = 'text' | 'number' | 'textarea' | 'select' | 'checkbox';

export interface PropertyField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

const MEDICATION_ROLES = [
  { value: 'preferred', label: 'Preferred' },
  { value: 'acceptable', label: 'Acceptable' },
  { value: 'avoid', label: 'Avoid' },
  { value: 'contraindicated', label: 'Contraindicated' },
];

const EVIDENCE_LEVELS = [
  { value: 'Level A', label: 'Level A' },
  { value: 'Level B', label: 'Level B' },
  { value: 'Level C', label: 'Level C' },
  { value: 'Expert Consensus', label: 'Expert Consensus' },
];

const CODE_SYSTEMS = [
  { value: 'ICD-10', label: 'ICD-10' },
  { value: 'SNOMED', label: 'SNOMED' },
  { value: 'RXNORM', label: 'RxNorm' },
  { value: 'LOINC', label: 'LOINC' },
  { value: 'CPT', label: 'CPT' },
];

export const PROPERTY_FIELDS: Record<PathwayNodeType, PropertyField[]> = {
  Stage: [
    { key: 'stage_number', label: 'Stage Number', type: 'number', required: true },
    { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g., Initial Assessment' },
    { key: 'description', label: 'Description', type: 'textarea', required: false },
  ],
  Step: [
    { key: 'stage_number', label: 'Stage Number', type: 'number', required: true },
    { key: 'step_number', label: 'Step Number', type: 'number', required: true },
    { key: 'display_number', label: 'Display Number', type: 'text', required: true, placeholder: 'e.g., 1.1' },
    { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g., Obtain Surgical History' },
    { key: 'description', label: 'Description', type: 'textarea', required: false },
  ],
  DecisionPoint: [
    { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g., Delivery Method Decision' },
    { key: 'auto_resolve_eligible', label: 'Auto-resolve eligible', type: 'checkbox', required: false },
  ],
  Criterion: [
    { key: 'description', label: 'Description', type: 'textarea', required: true, placeholder: 'e.g., Single prior low-transverse cesarean' },
    { key: 'code_system', label: 'Code System', type: 'select', required: false, options: CODE_SYSTEMS },
    { key: 'code_value', label: 'Code Value', type: 'text', required: false, placeholder: 'e.g., O34.211' },
    { key: 'base_rate', label: 'Base Rate', type: 'number', required: false },
    { key: 'is_critical', label: 'Critical criterion', type: 'checkbox', required: false },
  ],
  Medication: [
    { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g., Amoxicillin' },
    { key: 'role', label: 'Role', type: 'select', required: true, options: MEDICATION_ROLES },
    { key: 'dose', label: 'Dose', type: 'text', required: false, placeholder: 'e.g., 500mg' },
    { key: 'route', label: 'Route', type: 'text', required: false, placeholder: 'e.g., Oral, IV' },
    { key: 'frequency', label: 'Frequency', type: 'text', required: false, placeholder: 'e.g., TID x 10 days' },
  ],
  LabTest: [
    { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g., Complete Blood Count' },
    { key: 'code_system', label: 'Code System', type: 'select', required: false, options: CODE_SYSTEMS },
    { key: 'code_value', label: 'Code Value', type: 'text', required: false },
  ],
  Procedure: [
    { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g., Cesarean Delivery' },
    { key: 'code_system', label: 'Code System', type: 'select', required: false, options: CODE_SYSTEMS },
    { key: 'code_value', label: 'Code Value', type: 'text', required: false },
  ],
  CodeEntry: [
    { key: 'system', label: 'Code System', type: 'select', required: true, options: CODE_SYSTEMS },
    { key: 'code', label: 'Code', type: 'text', required: true, placeholder: 'e.g., J02.0' },
    { key: 'description', label: 'Description', type: 'text', required: false },
  ],
  EvidenceCitation: [
    { key: 'reference_number', label: 'Reference #', type: 'number', required: true },
    { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g., ACOG Practice Bulletin' },
    { key: 'evidence_level', label: 'Evidence Level', type: 'select', required: true, options: EVIDENCE_LEVELS },
    { key: 'source', label: 'Source', type: 'text', required: false, placeholder: 'e.g., Journal name' },
    { key: 'year', label: 'Year', type: 'number', required: false },
  ],
  QualityMetric: [
    { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g., VBAC Success Rate' },
    { key: 'measure', label: 'Measure', type: 'textarea', required: true, placeholder: 'What this metric measures' },
    { key: 'target', label: 'Target', type: 'text', required: false, placeholder: 'e.g., >= 60%' },
  ],
  Schedule: [
    { key: 'interval', label: 'Interval', type: 'text', required: true, placeholder: 'e.g., Every 15 minutes' },
    { key: 'description', label: 'Description', type: 'textarea', required: true },
    { key: 'duration', label: 'Duration', type: 'text', required: false, placeholder: 'e.g., Throughout active labor' },
  ],
};
```

- [ ] **Step 2: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/components/editor/propertyFields.ts
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add property field definitions for all 11 node types"
```

---

### Task 11: Properties Panel

**Files:**
- Create: `prism-admin-dashboard/src/components/editor/PropertiesPanel.tsx`

- [ ] **Step 1: Create the properties panel component**

Create `prism-admin-dashboard/src/components/editor/PropertiesPanel.tsx`:

```tsx
'use client';

import { useCallback } from 'react';
import type { Node } from '@xyflow/react';
import clsx from 'clsx';
import { NODE_CONFIG } from '@/components/graph/nodeConfig';
import { PROPERTY_FIELDS, type PropertyField } from './propertyFields';
import type { PathwayNodeData, PathwayNodeType } from '@/types';

interface PropertiesPanelProps {
  selectedNode: Node | null;
  onUpdateNode: (nodeId: string, properties: Record<string, unknown>, label: string) => void;
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: PropertyField;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
}) {
  const baseInputClass = 'w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';

  switch (field.type) {
    case 'textarea':
      return (
        <textarea
          value={String(value ?? '')}
          onChange={e => onChange(field.key, e.target.value)}
          placeholder={field.placeholder}
          rows={3}
          className={clsx(baseInputClass, 'resize-y')}
        />
      );
    case 'select':
      return (
        <select
          value={String(value ?? '')}
          onChange={e => onChange(field.key, e.target.value)}
          className={baseInputClass}
        >
          <option value="">Select...</option>
          {field.options?.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      );
    case 'checkbox':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={e => onChange(field.key, e.target.checked)}
            className="rounded border-gray-300 text-blue-500 focus:ring-blue-500"
          />
          <span className="text-gray-700">{field.label}</span>
        </label>
      );
    case 'number':
      return (
        <input
          type="number"
          value={value != null ? String(value) : ''}
          onChange={e => onChange(field.key, e.target.value === '' ? null : Number(e.target.value))}
          placeholder={field.placeholder}
          className={baseInputClass}
        />
      );
    default:
      return (
        <input
          type="text"
          value={String(value ?? '')}
          onChange={e => onChange(field.key, e.target.value)}
          placeholder={field.placeholder}
          className={baseInputClass}
        />
      );
  }
}

export function PropertiesPanel({ selectedNode, onUpdateNode }: PropertiesPanelProps) {
  const handleFieldChange = useCallback((key: string, value: unknown) => {
    if (!selectedNode) return;
    const nodeData = selectedNode.data as PathwayNodeData;
    const newProperties = { ...nodeData.properties, [key]: value };

    // Determine the label from the first available title-like field
    const label = String(
      newProperties.title ?? newProperties.name ?? newProperties.description ?? newProperties.code ?? nodeData.label
    );

    onUpdateNode(selectedNode.id, newProperties, label);
  }, [selectedNode, onUpdateNode]);

  if (!selectedNode) {
    return (
      <div className="w-72 bg-white border-l border-gray-200 p-4 flex-shrink-0">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Properties
        </h3>
        <p className="text-sm text-gray-400">Select a node to edit its properties</p>
      </div>
    );
  }

  const nodeData = selectedNode.data as PathwayNodeData;
  const nodeType = nodeData.pathwayNodeType;
  const config = NODE_CONFIG[nodeType];
  const fields = PROPERTY_FIELDS[nodeType];

  return (
    <div className="w-72 bg-white border-l border-gray-200 overflow-y-auto flex-shrink-0">
      {/* Header */}
      <div className={clsx('px-4 py-3 border-b border-gray-200', config.color)}>
        <div className={clsx('flex items-center gap-2', config.textColor)}>
          <span>{config.icon}</span>
          <span className="text-sm font-semibold">{config.label}</span>
        </div>
        <div className={clsx('text-xs mt-0.5 opacity-80', config.textColor)}>
          ID: {nodeData.pathwayNodeId}
        </div>
      </div>

      {/* Fields */}
      <div className="p-4 space-y-3">
        {fields.map(field => (
          <div key={field.key}>
            {field.type !== 'checkbox' && (
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {field.label}
                {field.required && <span className="text-red-400 ml-0.5">*</span>}
              </label>
            )}
            <FieldInput
              field={field}
              value={nodeData.properties[field.key]}
              onChange={handleFieldChange}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/components/editor/PropertiesPanel.tsx
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add properties panel with type-specific form fields"
```

---

### Task 12: Editor Toolbar

**Files:**
- Create: `prism-admin-dashboard/src/components/editor/EditorToolbar.tsx`

- [ ] **Step 1: Create the toolbar**

Create `prism-admin-dashboard/src/components/editor/EditorToolbar.tsx`:

```tsx
'use client';

import { Button } from '@/components/ui/Button';
import {
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  ArrowsPointingOutIcon,
  ViewColumnsIcon,
} from '@heroicons/react/24/outline';

interface EditorToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onAutoLayout: () => void;
  onFitView: () => void;
  pathwayTitle: string;
  pathwayVersion: string;
  isDraft: boolean;
}

export function EditorToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onAutoLayout,
  onFitView,
  pathwayTitle,
  pathwayVersion,
  isDraft,
}: EditorToolbarProps) {
  return (
    <div className="h-14 bg-white border-b border-gray-200 px-4 flex items-center justify-between flex-shrink-0">
      {/* Left: Pathway info */}
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold text-gray-900 truncate max-w-[300px]">
          {pathwayTitle || 'Untitled Pathway'}
        </h1>
        <span className="text-xs font-mono text-gray-400">v{pathwayVersion}</span>
        {isDraft && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-medium">
            Draft
          </span>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={onUndo}
          disabled={!canUndo}
          leftIcon={<ArrowUturnLeftIcon className="h-4 w-4" />}
        >
          Undo
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRedo}
          disabled={!canRedo}
          leftIcon={<ArrowUturnRightIcon className="h-4 w-4" />}
        >
          Redo
        </Button>
        <div className="w-px h-6 bg-gray-200 mx-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={onAutoLayout}
          leftIcon={<ViewColumnsIcon className="h-4 w-4" />}
        >
          Auto Layout
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onFitView}
          leftIcon={<ArrowsPointingOutIcon className="h-4 w-4" />}
        >
          Fit View
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/components/editor/EditorToolbar.tsx
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add editor toolbar with undo/redo and layout controls"
```

---

### Task 13: PathwayCanvas — Main React Flow Wrapper

**Files:**
- Create: `prism-admin-dashboard/src/components/graph/PathwayCanvas.tsx`

- [ ] **Step 1: Create the main canvas component**

Create `prism-admin-dashboard/src/components/graph/PathwayCanvas.tsx`:

```tsx
'use client';

import { useCallback, useRef, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { nodeTypes } from './nodes';
import { NODE_CONFIG } from './nodeConfig';
import { validateConnection, wouldCreateCycle } from './EdgeConstraintValidator';
import { applyAutoLayout } from './AutoLayout';
import { NodePalette } from './NodePalette';
import { PropertiesPanel } from '@/components/editor/PropertiesPanel';
import { EditorToolbar } from '@/components/editor/EditorToolbar';
import { useUndoRedo } from '@/lib/hooks/useUndoRedo';
import type { PathwayNodeType, PathwayNodeData, PathwayEdgeData } from '@/types';

interface PathwayCanvasProps {
  initialNodes?: Node[];
  initialEdges?: Edge[];
  pathwayTitle?: string;
  pathwayVersion?: string;
  isDraft?: boolean;
  readOnly?: boolean;
}

let nodeIdCounter = 0;
function generateNodeId(nodeType: PathwayNodeType): string {
  nodeIdCounter++;
  const prefix = nodeType.toLowerCase().replace(/([A-Z])/g, '-$1').replace(/^-/, '');
  return `${prefix}-new-${nodeIdCounter}`;
}

function PathwayCanvasInner({
  initialNodes = [],
  initialEdges = [],
  pathwayTitle = 'Untitled Pathway',
  pathwayVersion = '1.0',
  isDraft = true,
  readOnly = false,
}: PathwayCanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const { takeSnapshot, undo, redo, canUndo, canRedo } = useUndoRedo(nodes, edges, setNodes, setEdges);

  // Track selected node for properties panel
  const selectedNode = useMemo(() => {
    return nodes.find(n => n.selected) ?? null;
  }, [nodes]);

  // Handle new connections with edge constraint validation
  const onConnect = useCallback((connection: Connection) => {
    const validTypes = validateConnection(connection, nodes);
    if (validTypes.length === 0) return;
    if (connection.source && connection.target && wouldCreateCycle(connection.source, connection.target, edges)) return;

    takeSnapshot();

    const edgeType = validTypes[0]; // Use first valid edge type
    const newEdge: Edge = {
      id: `e-${connection.source}-${connection.target}-${edgeType}`,
      source: connection.source!,
      target: connection.target!,
      label: edgeType.replace(/_/g, ' '),
      data: {
        pathwayEdgeType: edgeType,
      } satisfies PathwayEdgeData,
    };
    setEdges(eds => [...eds, newEdge]);
  }, [nodes, edges, setEdges, takeSnapshot]);

  // Wrap onNodesChange to capture snapshots on delete
  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    const hasDelete = changes.some(c => c.type === 'remove');
    if (hasDelete) takeSnapshot();
    onNodesChange(changes);
  }, [onNodesChange, takeSnapshot]);

  // Wrap onEdgesChange to capture snapshots on delete
  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    const hasDelete = changes.some(c => c.type === 'remove');
    if (hasDelete) takeSnapshot();
    onEdgesChange(changes);
  }, [onEdgesChange, takeSnapshot]);

  // Handle drop from NodePalette
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();

    const nodeType = event.dataTransfer.getData('application/reactflow-nodetype') as PathwayNodeType;
    if (!nodeType || !NODE_CONFIG[nodeType]) return;

    takeSnapshot();

    const position = screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });

    const config = NODE_CONFIG[nodeType];
    const nodeId = generateNodeId(nodeType);

    const newNode: Node = {
      id: nodeId,
      type: nodeType,
      position,
      data: {
        pathwayNodeType: nodeType,
        pathwayNodeId: nodeId,
        label: `New ${config.label}`,
        properties: {},
      } satisfies PathwayNodeData,
    };

    setNodes(nds => [...nds, newNode]);
  }, [screenToFlowPosition, setNodes, takeSnapshot]);

  // Update node properties from PropertiesPanel
  const handleUpdateNode = useCallback((nodeId: string, properties: Record<string, unknown>, label: string) => {
    setNodes(nds => nds.map(n => {
      if (n.id !== nodeId) return n;
      return {
        ...n,
        data: {
          ...(n.data as PathwayNodeData),
          properties,
          label,
        },
      };
    }));
  }, [setNodes]);

  // Auto-layout
  const handleAutoLayout = useCallback(() => {
    takeSnapshot();
    const layoutedNodes = applyAutoLayout(nodes, edges);
    setNodes(layoutedNodes);
    window.requestAnimationFrame(() => fitView({ padding: 0.2 }));
  }, [nodes, edges, setNodes, fitView, takeSnapshot]);

  // Fit view
  const handleFitView = useCallback(() => {
    fitView({ padding: 0.2 });
  }, [fitView]);

  // Keyboard shortcuts
  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'z') {
      event.preventDefault();
      if (event.shiftKey) {
        redo();
      } else {
        undo();
      }
    }
  }, [undo, redo]);

  return (
    <div className="flex flex-col h-full" onKeyDown={onKeyDown} tabIndex={-1}>
      <EditorToolbar
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onAutoLayout={handleAutoLayout}
        onFitView={handleFitView}
        pathwayTitle={pathwayTitle}
        pathwayVersion={pathwayVersion}
        isDraft={isDraft}
      />

      <div className="flex flex-1 overflow-hidden">
        {!readOnly && <NodePalette />}

        <div ref={reactFlowWrapper} className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={readOnly ? undefined : handleNodesChange}
            onEdgesChange={readOnly ? undefined : handleEdgesChange}
            onConnect={readOnly ? undefined : onConnect}
            onDragOver={readOnly ? undefined : onDragOver}
            onDrop={readOnly ? undefined : onDrop}
            nodeTypes={nodeTypes}
            fitView
            snapToGrid
            snapGrid={[16, 16]}
            deleteKeyCode={readOnly ? null : 'Delete'}
            multiSelectionKeyCode="Shift"
            panOnScroll
            zoomOnScroll
          >
            <Background gap={16} size={1} />
            <Controls />
            <MiniMap
              nodeColor={(node) => {
                const data = node.data as PathwayNodeData;
                const config = NODE_CONFIG[data.pathwayNodeType];
                // Extract the color name from the Tailwind class for the minimap
                const colorMap: Record<string, string> = {
                  'bg-blue-500': '#3b82f6',
                  'bg-emerald-500': '#10b981',
                  'bg-amber-500': '#f59e0b',
                  'bg-gray-500': '#6b7280',
                  'bg-purple-500': '#a855f7',
                  'bg-teal-500': '#14b8a6',
                  'bg-orange-500': '#f97316',
                  'bg-slate-500': '#64748b',
                  'bg-indigo-500': '#6366f1',
                  'bg-emerald-600': '#059669',
                  'bg-cyan-500': '#06b6d4',
                };
                return colorMap[config.color] ?? '#6b7280';
              }}
              zoomable
              pannable
            />
          </ReactFlow>
        </div>

        {!readOnly && (
          <PropertiesPanel
            selectedNode={selectedNode}
            onUpdateNode={handleUpdateNode}
          />
        )}
      </div>
    </div>
  );
}

/**
 * PathwayCanvas wraps the inner component with ReactFlowProvider.
 * This is required so that useReactFlow() works inside the component.
 */
export function PathwayCanvas(props: PathwayCanvasProps) {
  return (
    <ReactFlowProvider>
      <PathwayCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
```

- [ ] **Step 2: Verify build**

Run:
```bash
npm --prefix /home/claude/workspace/prism-admin-dashboard run build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/components/graph/PathwayCanvas.tsx
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: add PathwayCanvas with drag-drop, constraints, layout, and undo/redo"
```

---

### Task 14: Wire Editor Page

**Files:**
- Modify: `prism-admin-dashboard/src/app/pathways/[id]/page.tsx`

- [ ] **Step 1: Replace the stub with the graph editor**

Replace the contents of `prism-admin-dashboard/src/app/pathways/[id]/page.tsx` with:

```tsx
'use client';

import { use } from 'react';
import { useQuery } from '@apollo/client/react';
import { GET_PATHWAY } from '@/lib/graphql/queries/pathways';
import { PathwayCanvas } from '@/components/graph/PathwayCanvas';
import { Spinner } from '@/components/ui/Spinner';
import type { Pathway } from '@/types';

export default function PathwayEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, loading, error } = useQuery<{ pathway: Pathway | null }>(GET_PATHWAY, {
    variables: { id },
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !data?.pathway) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm text-red-700">
            {error ? `Failed to load pathway: ${error.message}` : 'Pathway not found'}
          </p>
        </div>
      </div>
    );
  }

  const pathway = data.pathway;

  return (
    <div className="h-screen flex flex-col">
      <PathwayCanvas
        pathwayTitle={pathway.title}
        pathwayVersion={pathway.version}
        isDraft={pathway.status === 'DRAFT'}
        readOnly={pathway.status !== 'DRAFT'}
      />
    </div>
  );
}
```

Note: This page currently loads the pathway metadata but starts with an empty canvas. Plan 3 (Serialization) will add the deserialization of PathwayJson into React Flow nodes/edges, and the save/publish flow.

- [ ] **Step 2: Verify build**

Run:
```bash
npm --prefix /home/claude/workspace/prism-admin-dashboard run build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git -C /home/claude/workspace/prism-admin-dashboard add src/app/pathways/[id]/page.tsx
git -C /home/claude/workspace/prism-admin-dashboard commit -m "feat: wire pathway editor page with PathwayCanvas"
```

---

## Plan Summary

After completing all 14 tasks, the admin dashboard will have:

- **React Flow canvas** with pan, zoom, snap-to-grid, minimap, and controls
- **11 custom node components** with type-specific colors, icons, and data display
- **Node palette** — drag any of the 11 node types from a categorized sidebar onto the canvas
- **Edge constraint validation** — only valid connections per `VALID_EDGE_ENDPOINTS` are allowed, with cycle detection
- **Auto-layout** — dagre hierarchical layout with one click
- **Properties panel** — select a node to edit all its type-specific fields in a form
- **Undo/redo** — Ctrl+Z / Ctrl+Shift+Z with 50-step history
- **Editor toolbar** — pathway title, version badge, undo/redo buttons, layout and fit-view buttons
- **Read-only mode** — controlled via `readOnly` prop (for non-DRAFT pathways)

The canvas starts empty (loading from PathwayJson is Plan 3). Admins can add nodes, connect them, edit properties, and undo changes — but save/publish is Plan 3.

**Next plans:**
- **Plan 3:** Serialization + save/publish (PathwayJson ↔ React Flow, Zod validation, import flow)
- **Plan 4:** JSON editor (Monaco, bidirectional sync)
- **Plan 5:** Preview/simulation mode
- **Plan 6:** Version history
- **Plan 7:** LLM pathway spec document
