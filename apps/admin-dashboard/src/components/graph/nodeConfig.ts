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
