'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useLazyQuery } from '@apollo/client';
import {
  ArrowPathIcon,
  ChevronRightIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  BeakerIcon,
  HeartIcon,
  ShieldCheckIcon,
  ClipboardDocumentListIcon,
  UserIcon,
  SparklesIcon,
  DocumentMagnifyingGlassIcon,
  WrenchScrewdriverIcon,
  ClipboardDocumentCheckIcon,
  XMarkIcon,
  BoltIcon,
  EyeDropperIcon,
  CalendarDaysIcon,
  AcademicCapIcon,
  ArrowRightCircleIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as StarSolid } from '@heroicons/react/24/solid';
import { Recommendation, PatientContext, LayerSummary, MatchReason } from '@/lib/hooks/useRecommendationEngine';
import { GET_CARE_PLAN_TEMPLATE } from '@/lib/graphql/queries/carePlans';

// Intervention type from GraphQL
interface TemplateIntervention {
  type: string;
  description: string;
  medicationCode?: string;
  procedureCode?: string;
  defaultScheduleDays?: number;
}

// Goal type from GraphQL
interface TemplateGoal {
  description: string;
  defaultTargetValue?: string;
  defaultTargetDays?: number;
  priority: string;
}

// Care plan template from GraphQL
interface CarePlanTemplate {
  id: string;
  name: string;
  description?: string;
  category: string;
  conditionCodes: string[];
  guidelineSource?: string;
  evidenceGrade?: string;
  defaultGoals: TemplateGoal[];
  defaultInterventions: TemplateIntervention[];
}

// Types for node positions (for connection calculations)
interface NodePosition {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Connection {
  fromId: string;
  toId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

// Types for the decision tree
interface DecisionFactor {
  type: 'condition' | 'medication' | 'lab' | 'demographic' | 'history';
  label: string;
  value: string;
  impact: 'high' | 'medium' | 'low';
}

interface DecisionNode {
  id: string;
  type: 'root' | 'decision' | 'branch' | 'recommendation';
  title: string;
  description: string;
  confidence: number;
  factors: DecisionFactor[];
  children: DecisionNode[];
  isSelected?: boolean;
  isExpanded?: boolean;
  alternativeCount?: number;
  isRecommendedPath?: boolean;
  recommendation?: {
    carePlanId: string;
    carePlanName: string;
    category: string;
    matchScore: number;
  };
}

interface DecisionExplorerModalProps {
  isOpen: boolean;
  onClose: () => void;
  recommendation: Recommendation;
  patientContext: PatientContext;
  layerSummaries: LayerSummary[];
}

const factorIcons: Record<string, React.ReactNode> = {
  condition: <HeartIcon className="h-4 w-4" />,
  medication: <BeakerIcon className="h-4 w-4" />,
  lab: <ClipboardDocumentListIcon className="h-4 w-4" />,
  demographic: <UserIcon className="h-4 w-4" />,
  history: <ShieldCheckIcon className="h-4 w-4" />,
};

// Helper to get intervention type icon and color
const getInterventionStyle = (type: string) => {
  switch (type) {
    case 'MEDICATION':
      return { color: '#f472b6', bg: 'rgba(244, 114, 182, 0.2)', label: 'Medication' };
    case 'PROCEDURE':
      return { color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.2)', label: 'Procedure' };
    case 'LAB':
      return { color: '#4ade80', bg: 'rgba(74, 222, 128, 0.2)', label: 'Lab Test' };
    case 'MONITORING':
      return { color: '#facc15', bg: 'rgba(250, 204, 21, 0.2)', label: 'Monitoring' };
    case 'REFERRAL':
      return { color: '#c084fc', bg: 'rgba(192, 132, 252, 0.2)', label: 'Referral' };
    case 'EDUCATION':
      return { color: '#2dd4bf', bg: 'rgba(45, 212, 191, 0.2)', label: 'Education' };
    case 'FOLLOW_UP':
      return { color: '#fb923c', bg: 'rgba(251, 146, 60, 0.2)', label: 'Follow-Up' };
    case 'LIFESTYLE':
      return { color: '#a3e635', bg: 'rgba(163, 230, 53, 0.2)', label: 'Lifestyle' };
    default:
      return { color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.2)', label: type };
  }
};

// Build decision tree from recommendation data
function buildDecisionTree(
  recommendation: Recommendation,
  patientContext: PatientContext,
  layerSummaries: LayerSummary[],
  carePlanTemplate?: CarePlanTemplate | null
): DecisionNode {
  // Map reasons to factors with impact
  const mapReasonToFactor = (reason: MatchReason): DecisionFactor => {
    let type: DecisionFactor['type'] = 'condition';
    let impact: DecisionFactor['impact'] = reason.scoreImpact > 5 ? 'high' : reason.scoreImpact > 0 ? 'medium' : 'low';

    if (reason.reasonType.includes('age') || reason.reasonType.includes('sex')) {
      type = 'demographic';
    } else if (reason.reasonType.includes('medication') || reason.reasonType.includes('drug')) {
      type = 'medication';
    } else if (reason.reasonType.includes('lab')) {
      type = 'lab';
    } else if (reason.reasonType.includes('history') || reason.reasonType.includes('comorbid')) {
      type = 'history';
    }

    return {
      type,
      label: reason.reasonType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      value: reason.description,
      impact,
    };
  };

  // Root node - Patient Context
  const root: DecisionNode = {
    id: 'patient-context',
    type: 'root',
    title: 'Patient Evaluation',
    description: `${patientContext.age ? `${patientContext.age}yo` : ''} ${patientContext.sex || ''} presenting with ${patientContext.condition_codes.join(', ')}`.trim(),
    confidence: 1.0,
    factors: [
      ...patientContext.condition_codes.map(code => ({
        type: 'condition' as const,
        label: 'ICD-10',
        value: code,
        impact: 'high' as const,
      })),
      ...(patientContext.age ? [{
        type: 'demographic' as const,
        label: 'Age',
        value: `${patientContext.age} years`,
        impact: 'medium' as const,
      }] : []),
      ...(patientContext.sex ? [{
        type: 'demographic' as const,
        label: 'Sex',
        value: patientContext.sex,
        impact: 'low' as const,
      }] : []),
    ],
    isExpanded: true,
    isSelected: true,
    isRecommendedPath: true,
    children: [],
  };

  // Layer 1 - Primary Matching
  const layer1 = layerSummaries.find(l => l.layer === 1);
  const layer1Node: DecisionNode = {
    id: 'layer-1',
    type: 'branch',
    title: 'Layer 1: Primary Matching',
    description: layer1 ? `Found ${layer1.candidateCount} matching care plans based on condition codes` : 'Code-based matching',
    confidence: 0.95,
    factors: (recommendation.matchedCodes || []).map(code => ({
      type: 'condition' as const,
      label: 'Matched Code',
      value: code,
      impact: 'high' as const,
    })),
    isExpanded: true,
    isRecommendedPath: true,
    alternativeCount: layer1?.candidateCount || 1,
    children: [],
  };

  // Layer 2 - Variant Selection (if applicable)
  let layer2Node: DecisionNode | null = null;
  const layer2 = layerSummaries.find(l => l.layer === 2);

  if (recommendation.variantName || (layer2 && layer2.candidateCount > 0)) {
    layer2Node = {
      id: 'layer-2',
      type: 'branch',
      title: 'Layer 2: Variant Selection',
      description: recommendation.variantName
        ? `Selected variant: ${recommendation.variantName}${recommendation.variantGroupName ? ` (${recommendation.variantGroupName})` : ''}`
        : 'Evaluating patient-specific variants',
      confidence: 0.88,
      factors: [
        ...(recommendation.variantName ? [{
          type: 'condition' as const,
          label: 'Variant',
          value: recommendation.variantName,
          impact: 'high' as const,
        }] : []),
        ...(recommendation.variantGroupName ? [{
          type: 'history' as const,
          label: 'Variant Group',
          value: recommendation.variantGroupName,
          impact: 'medium' as const,
        }] : []),
      ],
      isExpanded: true,
      isRecommendedPath: true,
      alternativeCount: layer2?.candidateCount || 1,
      children: [],
    };
  }

  // Layer 3 - Personalization
  const layer3 = layerSummaries.find(l => l.layer === 3);
  const layer3Node: DecisionNode = {
    id: 'layer-3',
    type: 'branch',
    title: 'Layer 3: Personalization',
    description: 'ML-based scoring and ranking based on patient context',
    confidence: recommendation.score / 100,
    factors: recommendation.reasons.slice(0, 4).map(mapReasonToFactor),
    isExpanded: true,
    isRecommendedPath: true,
    alternativeCount: layer3?.candidateCount || 1,
    children: [],
  };

  // Final Recommendation Node
  const recommendationNode: DecisionNode = {
    id: 'recommendation',
    type: 'recommendation',
    title: recommendation.title,
    description: `Rank #${recommendation.rank} with score ${recommendation.score.toFixed(1)}`,
    confidence: recommendation.score / 100,
    factors: [],
    isExpanded: true,
    isRecommendedPath: true,
    children: [],
    recommendation: {
      carePlanId: recommendation.carePlanId,
      carePlanName: recommendation.title,
      category: recommendation.matchType || 'CARE_PLAN',
      matchScore: recommendation.score / 100,
    },
  };

  // Add intervention branches if care plan template is provided
  if (carePlanTemplate && carePlanTemplate.defaultInterventions.length > 0) {
    // Group interventions by type
    const interventionsByType: Record<string, TemplateIntervention[]> = {};
    carePlanTemplate.defaultInterventions.forEach(intervention => {
      if (!interventionsByType[intervention.type]) {
        interventionsByType[intervention.type] = [];
      }
      interventionsByType[intervention.type].push(intervention);
    });

    // Create branch nodes for each intervention type
    Object.entries(interventionsByType).forEach(([type, interventions], idx) => {
      const style = getInterventionStyle(type);
      const typeBranch: DecisionNode = {
        id: `intervention-type-${type.toLowerCase()}`,
        type: 'branch',
        title: `${style.label}s (${interventions.length})`,
        description: `${interventions.length} ${style.label.toLowerCase()} intervention(s) available`,
        confidence: 0.90,
        factors: [],
        isExpanded: idx === 0, // Expand first type by default
        isRecommendedPath: true,
        alternativeCount: interventions.length,
        children: interventions.map((intervention, i) => ({
          id: `intervention-${type.toLowerCase()}-${i}`,
          type: 'decision' as const,
          title: intervention.description.length > 50
            ? intervention.description.substring(0, 47) + '...'
            : intervention.description,
          description: intervention.description,
          confidence: 0.85,
          factors: [
            ...(intervention.medicationCode ? [{
              type: 'medication' as const,
              label: 'Medication Code',
              value: intervention.medicationCode,
              impact: 'high' as const,
            }] : []),
            ...(intervention.procedureCode ? [{
              type: 'condition' as const,
              label: 'Procedure Code',
              value: intervention.procedureCode,
              impact: 'high' as const,
            }] : []),
            ...(intervention.defaultScheduleDays ? [{
              type: 'demographic' as const,
              label: 'Duration',
              value: `${intervention.defaultScheduleDays} days`,
              impact: 'medium' as const,
            }] : []),
          ],
          isExpanded: false,
          isRecommendedPath: i === 0, // First intervention is recommended
          children: [],
        })),
      };
      recommendationNode.children.push(typeBranch);
    });

    // Add goals as a separate branch if available
    if (carePlanTemplate.defaultGoals.length > 0) {
      const goalsBranch: DecisionNode = {
        id: 'goals',
        type: 'branch',
        title: `Treatment Goals (${carePlanTemplate.defaultGoals.length})`,
        description: 'Expected outcomes and targets',
        confidence: 0.95,
        factors: [],
        isExpanded: false,
        isRecommendedPath: true,
        children: carePlanTemplate.defaultGoals.map((goal, i) => ({
          id: `goal-${i}`,
          type: 'decision' as const,
          title: goal.description.length > 50
            ? goal.description.substring(0, 47) + '...'
            : goal.description,
          description: goal.description,
          confidence: goal.priority === 'HIGH' ? 0.95 : goal.priority === 'MEDIUM' ? 0.80 : 0.65,
          factors: [
            {
              type: 'condition' as const,
              label: 'Priority',
              value: goal.priority,
              impact: goal.priority === 'HIGH' ? 'high' as const : goal.priority === 'MEDIUM' ? 'medium' as const : 'low' as const,
            },
            ...(goal.defaultTargetDays ? [{
              type: 'demographic' as const,
              label: 'Target',
              value: `${goal.defaultTargetDays} days`,
              impact: 'medium' as const,
            }] : []),
          ],
          isExpanded: false,
          isRecommendedPath: goal.priority === 'HIGH',
          children: [],
        })),
      };
      recommendationNode.children.push(goalsBranch);
    }
  }

  // Build the tree structure
  layer3Node.children = [recommendationNode];

  if (layer2Node) {
    layer2Node.children = [layer3Node];
    layer1Node.children = [layer2Node];
  } else {
    layer1Node.children = [layer3Node];
  }

  root.children = [layer1Node];

  // Add alternative branches for visualization
  if (patientContext.comorbidities && patientContext.comorbidities.length > 0) {
    const comorbidityBranch: DecisionNode = {
      id: 'comorbidity-branch',
      type: 'branch',
      title: 'Comorbidity Considerations',
      description: `Evaluating impact of ${patientContext.comorbidities.length} comorbid condition(s)`,
      confidence: 0.75,
      factors: patientContext.comorbidities.map(code => ({
        type: 'condition' as const,
        label: 'Comorbidity',
        value: code,
        impact: 'medium' as const,
      })),
      isExpanded: false,
      isRecommendedPath: false,
      children: [],
    };
    root.children.push(comorbidityBranch);
  }

  if (patientContext.risk_factors && patientContext.risk_factors.length > 0) {
    const riskBranch: DecisionNode = {
      id: 'risk-branch',
      type: 'branch',
      title: 'Risk Factor Assessment',
      description: `Identified ${patientContext.risk_factors.length} risk factor(s)`,
      confidence: 0.70,
      factors: patientContext.risk_factors.map(rf => ({
        type: 'history' as const,
        label: 'Risk Factor',
        value: rf,
        impact: 'medium' as const,
      })),
      isExpanded: false,
      isRecommendedPath: false,
      children: [],
    };
    root.children.push(riskBranch);
  }

  return root;
}

// Connection Layer - renders all connections as an SVG overlay
function ConnectionsLayer({
  tree,
  containerRef,
}: {
  tree: DecisionNode;
  containerRef: React.RefObject<HTMLDivElement>;
}) {
  const [renderKey, setRenderKey] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setRenderKey(k => k + 1), 100),
      setTimeout(() => setRenderKey(k => k + 1), 300),
      setTimeout(() => setRenderKey(k => k + 1), 600),
    ];
    return () => timers.forEach(clearTimeout);
  }, [tree]);

  if (!containerRef.current) return null;

  const scrollWidth = containerRef.current.scrollWidth;
  const scrollHeight = containerRef.current.scrollHeight;
  const containerRect = containerRef.current.getBoundingClientRect();

  const connections: Connection[] = [];

  const findConnections = (node: DecisionNode) => {
    if (!node.children || node.children.length === 0) return;
    if (!node.isExpanded) return;

    const parentEl = containerRef.current?.querySelector(`[data-node-id="${node.id}"]`) as HTMLDivElement | null;
    if (!parentEl) return;

    const parentRect = parentEl.getBoundingClientRect();
    const parentX = parentRect.left + parentRect.width / 2 - containerRect.left;
    const parentY = parentRect.bottom - containerRect.top;

    node.children.forEach((child) => {
      const childEl = containerRef.current?.querySelector(`[data-node-id="${child.id}"]`) as HTMLDivElement | null;
      if (!childEl) return;

      const childRect = childEl.getBoundingClientRect();
      const childX = childRect.left + childRect.width / 2 - containerRect.left;
      const childY = childRect.top - containerRect.top;

      connections.push({
        fromId: node.id,
        toId: child.id,
        fromX: parentX,
        fromY: parentY,
        toX: childX,
        toY: childY,
      });

      findConnections(child);
    });
  };

  findConnections(tree);

  if (connections.length === 0) return null;

  return (
    <svg
      className="absolute top-0 left-0 pointer-events-none"
      width={scrollWidth}
      height={scrollHeight}
      style={{ overflow: 'visible' }}
    >
      <defs>
        <linearGradient id="modal-connection-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="1" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.6" />
        </linearGradient>
        <filter id="modal-connection-glow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {connections.map((conn, idx) => {
        const midY = (conn.fromY + conn.toY) / 2;
        const isVertical = Math.abs(conn.fromX - conn.toX) < 5;
        const curveOffset = isVertical ? 20 : 0;
        const pathD = `M ${conn.fromX} ${conn.fromY} Q ${conn.fromX + curveOffset} ${midY}, ${conn.toX} ${conn.toY}`;

        return (
          <g key={`${conn.fromId}-${conn.toId}-${idx}`}>
            <path
              d={pathD}
              fill="none"
              stroke="#a78bfa"
              strokeWidth="8"
              strokeLinecap="round"
              opacity="0.3"
            />
            <path
              d={pathD}
              fill="none"
              stroke="#a78bfa"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <circle cx={conn.fromX} cy={conn.fromY} r="6" fill="#a78bfa" />
            <circle cx={conn.toX} cy={conn.toY} r="5" fill="#8b5cf6" />
            <circle r="4" fill="#c4b5fd">
              <animateMotion
                dur={`${1.5 + idx * 0.1}s`}
                repeatCount="indefinite"
                path={pathD}
              />
            </circle>
          </g>
        );
      })}
    </svg>
  );
}

// Individual Node Card Component
function NodeCard({
  node,
  isSelected,
  onSelect,
  onExpand,
}: {
  node: DecisionNode;
  isSelected: boolean;
  onSelect: (node: DecisionNode) => void;
  onExpand: (nodeId: string) => void;
}) {
  const hasChildren = node.children && node.children.length > 0;
  const isRoot = node.type === 'root';
  const isRecommendation = node.type === 'recommendation';
  const isBranch = node.type === 'branch';
  const confidenceLevel = Math.round(node.confidence * 100);
  const isOnRecommendedPath = node.isRecommendedPath;
  const shouldHighlight = isOnRecommendedPath;
  const isDimmed = !isOnRecommendedPath && !isRoot;

  const getColors = () => {
    if (isRoot) return { primary: '#fbbf24', secondary: '#f59e0b', glow: 'rgba(251, 191, 36, 0.5)', bg: 'rgba(251, 191, 36, 0.1)' };
    if (isRecommendation) return { primary: '#34d399', secondary: '#10b981', glow: 'rgba(52, 211, 153, 0.5)', bg: 'rgba(52, 211, 153, 0.1)' };
    if (isBranch) return { primary: '#a78bfa', secondary: '#8b5cf6', glow: 'rgba(167, 139, 250, 0.5)', bg: 'rgba(167, 139, 250, 0.1)' };
    return { primary: '#60a5fa', secondary: '#3b82f6', glow: 'rgba(96, 165, 250, 0.4)', bg: 'rgba(96, 165, 250, 0.1)' };
  };

  const colors = getColors();
  const cardWidth = isRoot ? 220 : 200;

  const getStars = () => {
    if (confidenceLevel >= 85) return 3;
    if (confidenceLevel >= 70) return 2;
    return 1;
  };

  return (
    <div
      data-node-id={node.id}
      className={`
        relative cursor-pointer transition-all duration-300 group
        ${isSelected ? 'scale-105 z-20' : 'hover:scale-[1.02] hover:-translate-y-1 z-10'}
        ${isDimmed ? 'opacity-40' : 'opacity-100'}
      `}
      onClick={() => onSelect(node)}
      style={{ width: `${cardWidth}px` }}
    >
      {/* Recommended badge */}
      {shouldHighlight && !isRoot && (
        <div
          className="absolute -top-2 left-1/2 -translate-x-1/2 z-30 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider whitespace-nowrap"
          style={{
            background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
            color: '#1e1b4b',
            boxShadow: '0 0 12px rgba(251, 191, 36, 0.6)',
          }}
        >
          {isRecommendation ? '★ Recommended' : '★ Best Path'}
        </div>
      )}

      {/* Outer glow effect */}
      <div
        className={`
          absolute -inset-2 rounded-2xl blur-xl transition-opacity duration-500
          ${isSelected ? 'opacity-100' : shouldHighlight && !isDimmed ? 'opacity-60' : 'opacity-0 group-hover:opacity-60'}
        `}
        style={{
          background: shouldHighlight ? 'rgba(251, 191, 36, 0.4)' : colors.glow
        }}
      />

      {/* Main card */}
      <div
        className="relative rounded-xl overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${colors.bg}, rgba(15, 23, 42, 0.95))`,
          border: shouldHighlight
            ? '2px solid rgba(251, 191, 36, 0.6)'
            : `2px solid ${isSelected ? colors.primary : colors.secondary}40`,
          boxShadow: isSelected
            ? `0 0 30px ${colors.glow}, inset 0 1px 0 rgba(255,255,255,0.1)`
            : shouldHighlight
            ? '0 0 20px rgba(251, 191, 36, 0.3), 0 4px 20px rgba(0,0,0,0.4)'
            : `0 4px 20px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)`,
        }}
      >
        {/* Top accent bar */}
        <div
          className="h-1"
          style={{
            background: shouldHighlight
              ? 'linear-gradient(90deg, #fbbf24, #f59e0b)'
              : `linear-gradient(90deg, ${colors.primary}, ${colors.secondary})`
          }}
        />

        {/* Card content */}
        <div className="p-3">
          {/* Header row */}
          <div className="flex items-start justify-between mb-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{
                background: `linear-gradient(135deg, ${colors.primary}30, ${colors.secondary}20)`,
                border: `1px solid ${colors.primary}50`,
              }}
            >
              {isRoot ? (
                <DocumentMagnifyingGlassIcon className="h-5 w-5" style={{ color: colors.primary }} />
              ) : isRecommendation ? (
                <ClipboardDocumentCheckIcon className="h-5 w-5" style={{ color: colors.primary }} />
              ) : (
                <WrenchScrewdriverIcon className="h-5 w-5" style={{ color: colors.primary }} />
              )}
            </div>
            <div
              className="px-2 py-0.5 rounded text-[10px] font-bold"
              style={{
                background: `${colors.primary}20`,
                color: colors.primary,
                border: `1px solid ${colors.primary}40`,
              }}
            >
              {confidenceLevel}%
            </div>
          </div>

          {/* Title */}
          <h3 className="font-bold text-sm leading-tight mb-1" style={{ color: '#e2e8f0' }}>
            {node.title}
          </h3>

          {/* Description */}
          <p className="text-[10px] text-slate-400 leading-tight mb-2 line-clamp-2">
            {node.description}
          </p>

          {/* Factors preview */}
          {node.factors.length > 0 && !isRecommendation && (
            <div className="flex flex-wrap gap-1 mb-2">
              {node.factors.slice(0, 2).map((factor, idx) => (
                <span
                  key={idx}
                  className="text-[9px] px-1.5 py-0.5 rounded"
                  style={{ background: 'rgba(71, 85, 105, 0.5)', color: '#94a3b8' }}
                >
                  {factor.label}
                </span>
              ))}
              {node.factors.length > 2 && (
                <span className="text-[9px] text-slate-500">+{node.factors.length - 2}</span>
              )}
            </div>
          )}

          {/* Recommendation preview */}
          {isRecommendation && node.recommendation && (
            <div
              className="p-2 rounded-lg mb-2"
              style={{
                background: 'rgba(16, 185, 129, 0.15)',
                border: '1px solid rgba(52, 211, 153, 0.3)',
              }}
            >
              <p className="text-[10px] font-medium leading-tight text-emerald-400">
                {node.recommendation.carePlanName}
              </p>
            </div>
          )}

          {/* Footer row */}
          <div className="flex items-center justify-between">
            <div className="flex gap-0.5">
              {[...Array(3)].map((_, i) => (
                <StarSolid
                  key={i}
                  className="h-3 w-3"
                  style={{
                    color: i < getStars() ? '#fbbf24' : '#374151',
                    filter: i < getStars() ? 'drop-shadow(0 0 2px rgba(251, 191, 36, 0.8))' : 'none',
                  }}
                />
              ))}
            </div>
            {node.alternativeCount && node.alternativeCount > 1 && (
              <div
                className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(139, 92, 246, 0.3)', color: '#a78bfa' }}
              >
                {node.alternativeCount} candidates
              </div>
            )}
          </div>
        </div>

        {/* Expand button */}
        {hasChildren && !isRecommendation && (
          <button
            className="w-full py-2 flex items-center justify-center gap-1 transition-all"
            style={{
              background: node.isExpanded
                ? `linear-gradient(135deg, ${colors.primary}30, ${colors.secondary}20)`
                : 'rgba(30, 41, 59, 0.5)',
              borderTop: '1px solid rgba(71, 85, 105, 0.3)',
            }}
            onClick={(e) => {
              e.stopPropagation();
              onExpand(node.id);
            }}
          >
            <ChevronRightIcon
              className={`h-4 w-4 transition-transform duration-300 ${node.isExpanded ? 'rotate-90' : ''}`}
              style={{ color: node.isExpanded ? colors.primary : '#64748b' }}
            />
            <span
              className="text-[10px] font-medium"
              style={{ color: node.isExpanded ? colors.primary : '#64748b' }}
            >
              {node.isExpanded ? 'Collapse' : `Expand (${node.children.length})`}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

// Tree Layout Component
function TreeLayout({
  node,
  selectedNodeId,
  onSelect,
  onExpand,
}: {
  node: DecisionNode;
  selectedNodeId: string | null;
  onSelect: (node: DecisionNode) => void;
  onExpand: (nodeId: string) => void;
}) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = node.isExpanded;

  return (
    <div className="flex flex-col items-center">
      <NodeCard
        node={node}
        isSelected={selectedNodeId === node.id}
        onSelect={onSelect}
        onExpand={onExpand}
      />

      {hasChildren && isExpanded && (
        <div className="flex gap-4 mt-16">
          {node.children.map((child) => (
            <TreeLayout
              key={child.id}
              node={child}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
              onExpand={onExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Main Skill Tree Component
function SkillTree({
  tree,
  selectedNodeId,
  onSelect,
  onExpand,
}: {
  tree: DecisionNode;
  selectedNodeId: string | null;
  onSelect: (node: DecisionNode) => void;
  onExpand: (nodeId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsReady(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative min-w-max transition-opacity duration-300"
      style={{ opacity: isReady ? 1 : 0 }}
    >
      <ConnectionsLayer tree={tree} containerRef={containerRef} />
      <TreeLayout
        node={tree}
        selectedNodeId={selectedNodeId}
        onSelect={onSelect}
        onExpand={onExpand}
      />
    </div>
  );
}

// Detail Panel
function SkillDetailPanel({
  node,
  onClose,
}: {
  node: DecisionNode | null;
  onClose?: () => void;
}) {
  if (!node) {
    return (
      <div className="h-full flex flex-col items-center justify-center">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
          style={{
            background: 'rgba(71, 85, 105, 0.3)',
            border: '2px dashed #475569',
          }}
        >
          <ClipboardDocumentCheckIcon className="h-8 w-8 text-slate-600" />
        </div>
        <p className="text-slate-500 text-sm">Select a node</p>
        <p className="text-slate-600 text-xs mt-1">to view details</p>
      </div>
    );
  }

  const getTypeColor = () => {
    if (node.type === 'recommendation') return { bg: 'rgba(16, 185, 129, 0.2)', border: '#10b981', text: '#34d399' };
    if (node.type === 'branch') return { bg: 'rgba(139, 92, 246, 0.2)', border: '#8b5cf6', text: '#a78bfa' };
    if (node.type === 'root') return { bg: 'rgba(251, 191, 36, 0.2)', border: '#f59e0b', text: '#fbbf24' };
    return { bg: 'rgba(96, 165, 250, 0.2)', border: '#3b82f6', text: '#60a5fa' };
  };

  const typeColor = getTypeColor();
  const confidenceLevel = Math.round(node.confidence * 100);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div
        className="p-4 rounded-xl"
        style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.9))',
          border: `1px solid ${typeColor.border}`,
          boxShadow: `0 0 20px ${typeColor.bg}`,
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <span
            className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
            style={{ background: typeColor.bg, color: typeColor.text, border: `1px solid ${typeColor.border}` }}
          >
            {node.type === 'root' ? 'Patient' : node.type === 'recommendation' ? 'Care Plan' : 'Processing Layer'}
          </span>
          <div className="flex gap-0.5">
            {[...Array(3)].map((_, i) => (
              <StarSolid
                key={i}
                className="h-3 w-3"
                style={{
                  color: i < (confidenceLevel >= 85 ? 3 : confidenceLevel >= 70 ? 2 : 1) ? '#fbbf24' : '#374151',
                  filter: i < (confidenceLevel >= 85 ? 3 : confidenceLevel >= 70 ? 2 : 1)
                    ? 'drop-shadow(0 0 3px rgba(251, 191, 36, 0.8))'
                    : 'none',
                }}
              />
            ))}
          </div>
        </div>
        <h2
          className="text-xl font-bold"
          style={{ color: typeColor.text, textShadow: `0 0 20px ${typeColor.bg}` }}
        >
          {node.title}
        </h2>
        <p className="text-slate-400 text-sm mt-1">{node.description}</p>

        {/* Confidence bar */}
        <div className="mt-3">
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-slate-500 uppercase tracking-wide">Confidence</span>
            <span style={{ color: typeColor.text }}>{confidenceLevel}%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${confidenceLevel}%`,
                background: `linear-gradient(90deg, ${typeColor.border}, ${typeColor.text})`,
                boxShadow: `0 0 10px ${typeColor.bg}`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Recommendation card */}
      {node.recommendation && (
        <div
          className="p-4 rounded-xl relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(5, 150, 105, 0.1))',
            border: '1px solid rgba(52, 211, 153, 0.5)',
          }}
        >
          <div className="relative">
            <div className="flex items-center gap-2 mb-2">
              <ClipboardDocumentCheckIcon className="h-5 w-5 text-emerald-400" />
              <span className="text-emerald-400 text-xs font-bold uppercase tracking-wider">Selected Care Plan</span>
            </div>
            <p className="text-emerald-300 font-bold">{node.recommendation.carePlanName}</p>
            <div className="flex items-center gap-3 mt-2 text-xs text-emerald-500">
              <span className="px-2 py-0.5 rounded bg-emerald-900/50">{node.recommendation.category.replace(/_/g, ' ')}</span>
              <span>{Math.round(node.recommendation.matchScore * 100)}% match</span>
            </div>
          </div>
        </div>
      )}

      {/* Clinical factors */}
      {node.factors.length > 0 && (
        <div>
          <h3 className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-2">
            {node.type === 'root' ? 'Patient Context' : 'Decision Factors'}
          </h3>
          <div className="space-y-2">
            {node.factors.map((factor, idx) => {
              const impactColor = factor.impact === 'high' ? '#ef4444' : factor.impact === 'medium' ? '#f59e0b' : '#22c55e';
              return (
                <div
                  key={idx}
                  className="flex items-center gap-3 p-2 rounded-lg"
                  style={{
                    background: 'rgba(30, 41, 59, 0.6)',
                    border: '1px solid #334155',
                  }}
                >
                  <div
                    className="w-8 h-8 rounded flex items-center justify-center"
                    style={{ background: 'rgba(71, 85, 105, 0.5)' }}
                  >
                    {factorIcons[factor.type]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-300 text-xs font-medium truncate">{factor.label}</p>
                    <p className="text-slate-500 text-[10px] truncate">{factor.value}</p>
                  </div>
                  <div
                    className="px-2 py-0.5 rounded text-[9px] font-bold uppercase"
                    style={{
                      background: `${impactColor}20`,
                      color: impactColor,
                      border: `1px solid ${impactColor}40`,
                    }}
                  >
                    {factor.impact}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Children preview */}
      {node.children.length > 0 && (
        <div>
          <h3 className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-2">
            Next Steps ({node.children.length})
          </h3>
          <div className="space-y-2">
            {node.children.map((child) => {
              const childColor = child.type === 'recommendation'
                ? { bg: 'rgba(16, 185, 129, 0.2)', text: '#34d399' }
                : { bg: 'rgba(139, 92, 246, 0.2)', text: '#a78bfa' };
              return (
                <div
                  key={child.id}
                  className="flex items-center gap-3 p-2 rounded-lg"
                  style={{
                    background: 'rgba(30, 41, 59, 0.6)',
                    border: '1px solid #334155',
                  }}
                >
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center"
                    style={{ background: childColor.bg }}
                  >
                    {child.type === 'recommendation' ? (
                      <ClipboardDocumentCheckIcon className="h-3 w-3" style={{ color: childColor.text }} />
                    ) : (
                      <WrenchScrewdriverIcon className="h-3 w-3" style={{ color: childColor.text }} />
                    )}
                  </div>
                  <span className="text-slate-300 text-xs font-medium flex-1 truncate">{child.title}</span>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded"
                    style={{
                      background: child.confidence >= 0.85 ? 'rgba(34, 197, 94, 0.2)' :
                        child.confidence >= 0.7 ? 'rgba(245, 158, 11, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                      color: child.confidence >= 0.85 ? '#22c55e' :
                        child.confidence >= 0.7 ? '#f59e0b' : '#ef4444',
                    }}
                  >
                    {Math.round(child.confidence * 100)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DecisionExplorerModal({
  isOpen,
  onClose,
  recommendation,
  patientContext,
  layerSummaries,
}: DecisionExplorerModalProps) {
  const [tree, setTree] = useState<DecisionNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<DecisionNode | null>(null);
  const [carePlanTemplate, setCarePlanTemplate] = useState<CarePlanTemplate | null>(null);

  // Fetch care plan template with interventions
  const [fetchCarePlanTemplate, { loading: templateLoading }] = useLazyQuery(GET_CARE_PLAN_TEMPLATE, {
    onCompleted: (data) => {
      if (data?.carePlanTemplate) {
        setCarePlanTemplate(data.carePlanTemplate);
      }
    },
    onError: (error) => {
      console.error('Error fetching care plan template:', error);
    },
  });

  // Fetch template when modal opens
  useEffect(() => {
    if (isOpen && recommendation?.carePlanId) {
      fetchCarePlanTemplate({ variables: { id: recommendation.carePlanId } });
    }
  }, [isOpen, recommendation?.carePlanId, fetchCarePlanTemplate]);

  // Build tree when modal opens and template is loaded
  useEffect(() => {
    if (isOpen && recommendation && patientContext) {
      const builtTree = buildDecisionTree(recommendation, patientContext, layerSummaries, carePlanTemplate);
      setTree(builtTree);
      setSelectedNode(null);
    }
  }, [isOpen, recommendation, patientContext, layerSummaries, carePlanTemplate]);

  const handleNodeSelect = useCallback((node: DecisionNode) => {
    setSelectedNode(node);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const handleNodeExpand = useCallback((nodeId: string) => {
    setTree((prevTree) => {
      if (!prevTree) return null;
      const toggleExpand = (node: DecisionNode): DecisionNode => {
        if (node.id === nodeId) {
          return { ...node, isExpanded: !node.isExpanded };
        }
        return {
          ...node,
          children: node.children.map(toggleExpand),
        };
      };
      return toggleExpand(prevTree);
    });
  }, []);

  const handleReset = useCallback(() => {
    if (recommendation && patientContext) {
      const builtTree = buildDecisionTree(recommendation, patientContext, layerSummaries, carePlanTemplate);
      setTree(builtTree);
      setSelectedNode(null);
    }
  }, [recommendation, patientContext, layerSummaries, carePlanTemplate]);

  if (!isOpen || !tree) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Custom styles */}
      <style jsx global>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>

      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal container */}
      <div
        className="absolute inset-4 md:inset-8 lg:inset-12 flex flex-col rounded-2xl overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #0f172a, #1e293b)',
          border: '1px solid rgba(139, 92, 246, 0.3)',
          boxShadow: '0 0 60px rgba(139, 92, 246, 0.2)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-3 flex-shrink-0"
          style={{
            background: 'rgba(15, 23, 42, 0.9)',
            borderBottom: '1px solid rgba(71, 85, 105, 0.5)',
          }}
        >
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <BoltIcon className="h-5 w-5 text-yellow-400" />
              <h1
                className="text-xl font-bold"
                style={{
                  background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                Decision Explorer
              </h1>
            </div>

            <div
              className="px-3 py-1 rounded-lg text-xs font-medium"
              style={{
                background: 'rgba(139, 92, 246, 0.2)',
                border: '1px solid rgba(139, 92, 246, 0.4)',
                color: '#a78bfa',
              }}
            >
              #{recommendation.rank} {recommendation.title}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-6 text-xs ml-4">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{
                    background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
                    boxShadow: '0 0 8px rgba(251, 191, 36, 0.6)',
                  }}
                />
                <span className="text-slate-400">Patient</span>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{
                    background: 'linear-gradient(135deg, #a78bfa, #8b5cf6)',
                    boxShadow: '0 0 8px rgba(167, 139, 250, 0.6)',
                  }}
                />
                <span className="text-slate-400">Layer</span>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{
                    background: 'linear-gradient(135deg, #34d399, #10b981)',
                    boxShadow: '0 0 8px rgba(52, 211, 153, 0.6)',
                  }}
                />
                <span className="text-slate-400">Care Plan</span>
              </div>
            </div>
          </div>

          <div className="flex gap-3 items-center">
            <button
              onClick={handleReset}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all hover:scale-105"
              style={{
                background: 'rgba(30, 41, 59, 0.8)',
                border: '1px solid #475569',
                color: '#94a3b8',
              }}
            >
              <ArrowPathIcon className="h-4 w-4 inline mr-2" />
              Reset
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all hover:scale-105"
              style={{
                background: 'rgba(239, 68, 68, 0.2)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                color: '#f87171',
              }}
            >
              <XMarkIcon className="h-4 w-4 inline mr-2" />
              Close
            </button>
          </div>
        </div>

        {/* Tree container */}
        <div
          className="flex-1 overflow-auto p-8"
          style={{
            backgroundImage: `
              radial-gradient(circle at 50% 50%, rgba(139, 92, 246, 0.03) 0%, transparent 50%),
              linear-gradient(rgba(71, 85, 105, 0.1) 1px, transparent 1px),
              linear-gradient(90deg, rgba(71, 85, 105, 0.1) 1px, transparent 1px)
            `,
            backgroundSize: '100% 100%, 40px 40px, 40px 40px',
          }}
        >
          <div className="min-w-max flex justify-center pt-8">
            <SkillTree
              tree={tree}
              selectedNodeId={selectedNode?.id || null}
              onSelect={handleNodeSelect}
              onExpand={handleNodeExpand}
            />
          </div>
        </div>
      </div>

      {/* Side drawer */}
      {selectedNode && (
        <>
          <div
            className="absolute inset-0 z-[100]"
            onClick={handleClosePanel}
          />
          <div
            className="absolute top-4 md:top-8 lg:top-12 right-4 md:right-8 lg:right-12 bottom-4 md:bottom-8 lg:bottom-12 w-[380px] z-[101] flex flex-col rounded-r-2xl"
            style={{
              background: 'linear-gradient(180deg, #0f172a, #1e293b)',
              borderLeft: '1px solid rgba(139, 92, 246, 0.3)',
              boxShadow: '-10px 0 40px rgba(0, 0, 0, 0.5), 0 0 60px rgba(139, 92, 246, 0.1)',
              animation: 'slideIn 0.3s ease-out',
            }}
          >
            <div
              className="px-4 py-3 flex items-center justify-between flex-shrink-0"
              style={{
                background: 'rgba(15, 23, 42, 0.8)',
                borderBottom: '1px solid rgba(71, 85, 105, 0.5)',
              }}
            >
              <div className="flex items-center gap-2">
                <StarSolid className="h-4 w-4 text-yellow-400" />
                <span className="text-slate-300 font-medium text-sm">Node Details</span>
              </div>
              <button
                onClick={handleClosePanel}
                className="p-1 rounded-lg hover:bg-slate-700/50 transition-colors"
              >
                <XMarkIcon className="h-5 w-5 text-slate-400" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <SkillDetailPanel node={selectedNode} onClose={handleClosePanel} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
