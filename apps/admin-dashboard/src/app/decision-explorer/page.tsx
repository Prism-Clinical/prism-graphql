'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  ArrowPathIcon,
  ChevronRightIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  QuestionMarkCircleIcon,
  BeakerIcon,
  HeartIcon,
  ShieldCheckIcon,
  ClipboardDocumentListIcon,
  UserIcon,
  SparklesIcon,
  StarIcon,
  BoltIcon,
  DocumentMagnifyingGlassIcon,
  WrenchScrewdriverIcon,
  ClipboardDocumentCheckIcon,
  XMarkIcon,
  ChevronDownIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as StarSolid } from '@heroicons/react/24/solid';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import Link from 'next/link';
import {
  usePathways,
  useDecisionTree,
  ClinicalPathway,
  DecisionTreeResult,
  PatientContext,
} from '@/lib/hooks/usePathways';

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
  isRecommendedPath?: boolean; // Part of the system-recommended path
  recommendation?: {
    carePlanId: string;
    carePlanName: string;
    category: string;
    matchScore: number;
  };
}

// Mock data for demonstration - branching decision tree
// Structure: Root (Diagnosis) -> Middle nodes (Actions) -> Leaves (Full Care Plans)
const mockDecisionTree: DecisionNode = {
  id: 'root',
  type: 'root',
  title: 'Type 2 Diabetes Mellitus',
  description: 'Primary diagnosis with comorbid hypertension and obesity',
  confidence: 0.94,
  factors: [
    { type: 'condition', label: 'ICD-10', value: 'E11.9 - Type 2 DM', impact: 'high' },
    { type: 'lab', label: 'HbA1c', value: '7.8% (above target)', impact: 'high' },
    { type: 'demographic', label: 'Age', value: '52 years', impact: 'medium' },
    { type: 'condition', label: 'Comorbidities', value: 'HTN, Obesity (BMI 31)', impact: 'high' },
  ],
  isExpanded: true,
  isSelected: true,
  isRecommendedPath: true,
  alternativeCount: 3,
  children: [
    // Pathway 1: Medication Intensification (RECOMMENDED)
    {
      id: 'med-intensify',
      type: 'branch',
      title: 'Rx: Add GLP-1 Agonist',
      description: 'Prescribe semaglutide for glycemic and weight control',
      confidence: 0.87,
      factors: [
        { type: 'medication', label: 'Current Therapy', value: 'Metformin 1000mg BID', impact: 'medium' },
        { type: 'history', label: 'Adherence', value: '92% compliance rate', impact: 'high' },
        { type: 'lab', label: 'eGFR', value: '78 mL/min (safe for GLP-1)', impact: 'medium' },
      ],
      isExpanded: true,
      isRecommendedPath: true,
      alternativeCount: 2,
      children: [
        {
          id: 'action-glp1-standard',
          type: 'branch',
          title: 'Standard Titration',
          isRecommendedPath: true,
          description: 'Start low dose, titrate monthly over 4 months',
          confidence: 0.85,
          factors: [
            { type: 'medication', label: 'Starting Dose', value: 'Semaglutide 0.25mg weekly', impact: 'medium' },
            { type: 'lab', label: 'Target HbA1c', value: '< 7.0%', impact: 'high' },
          ],
          isExpanded: true,
          children: [
            {
              id: 'rec-glp1-standard',
              type: 'recommendation',
              title: 'GLP-1 Intensive Plan',
              description: 'Complete care plan with medication, monitoring, and lifestyle support',
              confidence: 0.85,
              factors: [],
              children: [],
              isRecommendedPath: true,
              recommendation: {
                carePlanId: 'cp-001',
                carePlanName: 'Diabetes GLP-1 Intensification Protocol',
                category: 'CHRONIC_CARE',
                matchScore: 0.85,
              },
            },
          ],
        },
        {
          id: 'action-glp1-aggressive',
          type: 'branch',
          title: 'Accelerated Titration',
          description: 'Faster dose escalation for motivated patients',
          confidence: 0.72,
          factors: [
            { type: 'medication', label: 'Titration', value: 'Increase every 2 weeks', impact: 'high' },
            { type: 'history', label: 'GI Tolerance', value: 'Monitor closely for nausea', impact: 'medium' },
          ],
          isExpanded: false,
          children: [
            {
              id: 'rec-glp1-aggressive',
              type: 'recommendation',
              title: 'Rapid GLP-1 Plan',
              description: 'Aggressive treatment with close monitoring',
              confidence: 0.72,
              factors: [],
              children: [],
              recommendation: {
                carePlanId: 'cp-002',
                carePlanName: 'Accelerated Diabetes Control Protocol',
                category: 'CHRONIC_CARE',
                matchScore: 0.72,
              },
            },
          ],
        },
      ],
    },
    // Pathway 2: Additional Testing First
    {
      id: 'further-eval',
      type: 'branch',
      title: 'Lab: Comprehensive Testing',
      description: 'Order additional labs before treatment changes',
      confidence: 0.79,
      factors: [
        { type: 'lab', label: 'Lipid Panel', value: 'Due for annual check', impact: 'medium' },
        { type: 'lab', label: 'Urine Albumin', value: 'Screen for nephropathy', impact: 'high' },
        { type: 'lab', label: 'Thyroid Panel', value: 'Baseline before GLP-1', impact: 'medium' },
      ],
      isExpanded: true,
      alternativeCount: 2,
      children: [
        {
          id: 'action-full-workup',
          type: 'branch',
          title: 'Complete Metabolic Panel',
          description: 'Full workup including cardiac risk assessment',
          confidence: 0.76,
          factors: [
            { type: 'lab', label: 'Tests Ordered', value: 'CMP, Lipids, TSH, UACR, ECG', impact: 'high' },
            { type: 'history', label: 'Family Hx', value: 'Father MI at 58', impact: 'high' },
          ],
          isExpanded: false,
          children: [
            {
              id: 'rec-full-workup',
              type: 'recommendation',
              title: 'Comprehensive Eval Plan',
              description: 'Full metabolic and cardiac workup before intensification',
              confidence: 0.76,
              factors: [],
              children: [],
              recommendation: {
                carePlanId: 'cp-003',
                carePlanName: 'Diabetes Comprehensive Evaluation',
                category: 'DIAGNOSTIC',
                matchScore: 0.76,
              },
            },
          ],
        },
        {
          id: 'action-targeted-labs',
          type: 'branch',
          title: 'Targeted Lab Panel',
          description: 'Essential labs only to minimize cost',
          confidence: 0.68,
          factors: [
            { type: 'lab', label: 'Tests Ordered', value: 'HbA1c, UACR only', impact: 'medium' },
            { type: 'history', label: 'Cost Concern', value: 'High deductible plan', impact: 'medium' },
          ],
          isExpanded: false,
          children: [
            {
              id: 'rec-targeted-labs',
              type: 'recommendation',
              title: 'Focused Lab Plan',
              description: 'Cost-effective monitoring with essential tests',
              confidence: 0.68,
              factors: [],
              children: [],
              recommendation: {
                carePlanId: 'cp-004',
                carePlanName: 'Diabetes Essential Monitoring',
                category: 'DIAGNOSTIC',
                matchScore: 0.68,
              },
            },
          ],
        },
      ],
    },
    // Pathway 3: Lifestyle and Referrals
    {
      id: 'lifestyle-referral',
      type: 'branch',
      title: 'Referral: Lifestyle Medicine',
      description: 'Refer to nutrition and diabetes education',
      confidence: 0.74,
      factors: [
        { type: 'history', label: 'Diet History', value: 'No prior nutrition counseling', impact: 'high' },
        { type: 'condition', label: 'BMI', value: '31 - Class I Obesity', impact: 'high' },
        { type: 'demographic', label: 'Motivation', value: 'Patient interested in lifestyle changes', impact: 'high' },
      ],
      isExpanded: true,
      alternativeCount: 3,
      children: [
        {
          id: 'action-diabetes-ed',
          type: 'branch',
          title: 'Diabetes Self-Management',
          description: 'DSMES program with certified diabetes educator',
          confidence: 0.78,
          factors: [
            { type: 'history', label: 'Program', value: 'ADA-recognized DSMES', impact: 'high' },
            { type: 'history', label: 'Coverage', value: 'Medicare/insurance covered', impact: 'medium' },
          ],
          isExpanded: false,
          children: [
            {
              id: 'rec-dsmes',
              type: 'recommendation',
              title: 'DSMES Education Plan',
              description: 'Structured diabetes education with ongoing support',
              confidence: 0.78,
              factors: [],
              children: [],
              recommendation: {
                carePlanId: 'cp-005',
                carePlanName: 'Diabetes Self-Management Education',
                category: 'EDUCATION',
                matchScore: 0.78,
              },
            },
          ],
        },
        {
          id: 'action-nutrition',
          type: 'branch',
          title: 'Medical Nutrition Therapy',
          description: 'Refer to registered dietitian for MNT',
          confidence: 0.71,
          factors: [
            { type: 'history', label: 'Sessions', value: '3-4 visits with RD', impact: 'medium' },
            { type: 'condition', label: 'Goal', value: '5-7% weight loss', impact: 'high' },
          ],
          isExpanded: false,
          children: [
            {
              id: 'rec-mnt',
              type: 'recommendation',
              title: 'Nutrition Therapy Plan',
              description: 'Individualized MNT with weight management focus',
              confidence: 0.71,
              factors: [],
              children: [],
              recommendation: {
                carePlanId: 'cp-006',
                carePlanName: 'Medical Nutrition Therapy Protocol',
                category: 'NUTRITION',
                matchScore: 0.71,
              },
            },
          ],
        },
        {
          id: 'action-exercise',
          type: 'branch',
          title: 'Exercise Prescription',
          description: 'Structured physical activity program',
          confidence: 0.65,
          factors: [
            { type: 'history', label: 'Current Activity', value: 'Sedentary lifestyle', impact: 'high' },
            { type: 'condition', label: 'Clearance', value: 'No cardiac contraindications', impact: 'medium' },
          ],
          isExpanded: false,
          children: [
            {
              id: 'rec-exercise',
              type: 'recommendation',
              title: 'Exercise Program Plan',
              description: 'Progressive aerobic and resistance training',
              confidence: 0.65,
              factors: [],
              children: [],
              recommendation: {
                carePlanId: 'cp-007',
                carePlanName: 'Diabetes Exercise Prescription',
                category: 'LIFESTYLE',
                matchScore: 0.65,
              },
            },
          ],
        },
      ],
    },
  ],
};

const factorIcons: Record<string, React.ReactNode> = {
  condition: <HeartIcon className="h-4 w-4" />,
  medication: <BeakerIcon className="h-4 w-4" />,
  lab: <ClipboardDocumentListIcon className="h-4 w-4" />,
  demographic: <UserIcon className="h-4 w-4" />,
  history: <ShieldCheckIcon className="h-4 w-4" />,
};

const impactColors: Record<string, string> = {
  high: 'bg-red-100 text-red-700 border-red-200',
  medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  low: 'bg-green-100 text-green-700 border-green-200',
};

// Connection Layer - renders all connections as an SVG overlay
// This component calculates coordinates at render time for fresh values
function ConnectionsLayer({
  tree,
  containerRef,
  manualPathIds,
  isManualMode,
  isCustomPathApplied,
}: {
  tree: DecisionNode;
  containerRef: React.RefObject<HTMLDivElement>;
  manualPathIds: Set<string>;
  isManualMode: boolean;
  isCustomPathApplied: boolean;
}) {
  const [renderKey, setRenderKey] = useState(0);

  // Force re-render periodically to get fresh coordinates
  useEffect(() => {
    const timers = [
      setTimeout(() => setRenderKey(k => k + 1), 100),
      setTimeout(() => setRenderKey(k => k + 1), 300),
      setTimeout(() => setRenderKey(k => k + 1), 600),
    ];
    return () => timers.forEach(clearTimeout);
  }, [tree]);

  if (!containerRef.current) return null;

  // Calculate the SVG dimensions to cover all content
  const scrollWidth = containerRef.current.scrollWidth;
  const scrollHeight = containerRef.current.scrollHeight;
  const containerRect = containerRef.current.getBoundingClientRect();

  // Calculate connections at render time by querying the DOM
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
        <linearGradient id="connection-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="1" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.6" />
        </linearGradient>
        <filter id="connection-glow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {connections.map((conn, idx) => {
        const midY = (conn.fromY + conn.toY) / 2;

        // Always use curved path - add slight horizontal offset for vertical connections
        const isVertical = Math.abs(conn.fromX - conn.toX) < 5;
        const curveOffset = isVertical ? 20 : 0;

        // Use quadratic bezier for a smooth curve
        const pathD = `M ${conn.fromX} ${conn.fromY} Q ${conn.fromX + curveOffset} ${midY}, ${conn.toX} ${conn.toY}`;

        // Determine if this connection should be dimmed
        // Dim if custom path applied (not in manual mode) and either endpoint is not on the path
        const isOnPath = manualPathIds.has(conn.fromId) && manualPathIds.has(conn.toId);
        const shouldDim = isCustomPathApplied && !isManualMode && !isOnPath;
        const connectionOpacity = shouldDim ? 0.15 : 1;
        const strokeColor = shouldDim ? '#64748b' : '#a78bfa';
        const dotColor = shouldDim ? '#64748b' : '#8b5cf6';

        return (
          <g key={`${conn.fromId}-${conn.toId}-${idx}`} opacity={connectionOpacity}>
            {/* Glow effect behind the line */}
            <path
              d={pathD}
              fill="none"
              stroke={strokeColor}
              strokeWidth="8"
              strokeLinecap="round"
              opacity="0.3"
            />
            {/* Main curved path */}
            <path
              d={pathD}
              fill="none"
              stroke={strokeColor}
              strokeWidth="3"
              strokeLinecap="round"
            />
            {/* Start dot */}
            <circle cx={conn.fromX} cy={conn.fromY} r="6" fill={strokeColor} />
            {/* End dot */}
            <circle cx={conn.toX} cy={conn.toY} r="5" fill={dotColor} />
            {/* Animated particle - only show on active connections */}
            {!shouldDim && (
              <circle r="4" fill="#c4b5fd">
                <animateMotion
                  dur={`${1.5 + idx * 0.1}s`}
                  repeatCount="indefinite"
                  path={pathD}
                />
              </circle>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// Individual Node Card Component (no connection rendering)
function NodeCard({
  node,
  isSelected,
  onSelect,
  onExpand,
  isManualMode,
  manuallySelectedIds,
  manualPathIds,
  onManualSelect,
  isCustomPathApplied,
}: {
  node: DecisionNode;
  isSelected: boolean;
  onSelect: (node: DecisionNode) => void;
  onExpand: (nodeId: string) => void;
  isManualMode: boolean;
  manuallySelectedIds: Set<string>;
  manualPathIds: Set<string>;
  onManualSelect?: (nodeId: string) => void;
  isCustomPathApplied?: boolean;
}) {
  const hasChildren = node.children && node.children.length > 0;
  const isRoot = node.type === 'root';
  const isRecommendation = node.type === 'recommendation';
  const isBranch = node.type === 'branch';
  const confidenceLevel = Math.round(node.confidence * 100);
  const isOnRecommendedPath = node.isRecommendedPath;
  const isManuallySelected = manuallySelectedIds.has(node.id);
  const isOnManualPath = manualPathIds.has(node.id);
  const hasSelections = manuallySelectedIds.size > 0;

  // Determine if node should be highlighted or dimmed based on mode
  // In manual mode: highlight selected paths with blue outline, NO dimming (user can see all options)
  // Custom path applied (outside manual mode): highlight custom path, dim others
  // Not in manual mode and no custom path: highlight recommended path
  const showRecommendedBadge = !isManualMode && !isCustomPathApplied && isOnRecommendedPath;
  const showManualBadge = isOnManualPath && hasSelections;
  const shouldHighlight = isManualMode || isCustomPathApplied
    ? isOnManualPath
    : isOnRecommendedPath;
  // Only dim when custom path is applied (not during selection in manual mode)
  // Never dim manually selected nodes or nodes on the selected path
  const isDimmed = isManuallySelected || isOnManualPath
    ? false
    : isCustomPathApplied && !isManualMode
      ? !isRoot
      : !isManualMode && (!isOnRecommendedPath && !isRoot);

  // Get colors based on node type
  const getColors = () => {
    if (isRoot) return { primary: '#fbbf24', secondary: '#f59e0b', glow: 'rgba(251, 191, 36, 0.5)', bg: 'rgba(251, 191, 36, 0.1)' };
    if (isRecommendation) return { primary: '#34d399', secondary: '#10b981', glow: 'rgba(52, 211, 153, 0.5)', bg: 'rgba(52, 211, 153, 0.1)' };
    if (isBranch) return { primary: '#a78bfa', secondary: '#8b5cf6', glow: 'rgba(167, 139, 250, 0.5)', bg: 'rgba(167, 139, 250, 0.1)' };
    return { primary: '#60a5fa', secondary: '#3b82f6', glow: 'rgba(96, 165, 250, 0.4)', bg: 'rgba(96, 165, 250, 0.1)' };
  };

  const colors = getColors();
  const cardWidth = isRoot ? 200 : 180;

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
      {/* Recommended badge - only show when NOT in manual mode */}
      {showRecommendedBadge && !isRoot && (
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

      {/* Manual path badge - show for nodes on the selected path */}
      {showManualBadge && !isRoot && (
        <div
          className="absolute -top-2 left-1/2 -translate-x-1/2 z-30 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider whitespace-nowrap"
          style={{
            background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
            color: '#fff',
            boxShadow: '0 0 12px rgba(59, 130, 246, 0.6)',
          }}
        >
          {isManuallySelected ? '✓ Your Selection' : '★ Selected Path'}
        </div>
      )}

      {/* Outer glow effect */}
      <div
        className={`
          absolute -inset-2 rounded-2xl blur-xl transition-opacity duration-500
          ${isSelected ? 'opacity-100' : shouldHighlight && !isDimmed ? 'opacity-60' : 'opacity-0 group-hover:opacity-60'}
        `}
        style={{
          background: isOnManualPath && isManualMode
            ? 'rgba(59, 130, 246, 0.4)'
            : shouldHighlight && !isManualMode
            ? 'rgba(251, 191, 36, 0.4)'
            : colors.glow
        }}
      />

      {/* Main card */}
      <div
        className="relative rounded-xl overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${colors.bg}, rgba(15, 23, 42, 0.95))`,
          border: isOnManualPath && isManualMode
            ? '2px solid rgba(59, 130, 246, 0.6)'
            : shouldHighlight && !isManualMode
            ? '2px solid rgba(251, 191, 36, 0.6)'
            : `2px solid ${isSelected ? colors.primary : colors.secondary}40`,
          boxShadow: isSelected
            ? `0 0 30px ${colors.glow}, inset 0 1px 0 rgba(255,255,255,0.1)`
            : isOnManualPath && isManualMode
            ? '0 0 20px rgba(59, 130, 246, 0.3), 0 4px 20px rgba(0,0,0,0.4)'
            : shouldHighlight && !isManualMode
            ? '0 0 20px rgba(251, 191, 36, 0.3), 0 4px 20px rgba(0,0,0,0.4)'
            : `0 4px 20px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)`,
        }}
      >
        {/* Top accent bar */}
        <div
          className="h-1"
          style={{
            background: isOnManualPath && isManualMode
              ? 'linear-gradient(90deg, #3b82f6, #1d4ed8)'
              : shouldHighlight && !isManualMode
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
                background: isManuallySelected
                  ? 'rgba(59, 130, 246, 0.2)'
                  : 'rgba(16, 185, 129, 0.15)',
                border: isManuallySelected
                  ? '1px solid rgba(59, 130, 246, 0.4)'
                  : '1px solid rgba(52, 211, 153, 0.3)',
              }}
            >
              <p className={`text-[10px] font-medium leading-tight ${isManuallySelected ? 'text-blue-400' : 'text-emerald-400'}`}>
                {node.recommendation.carePlanName}
              </p>
            </div>
          )}

          {/* Manual select button for actions/recommendations in manual mode */}
          {(isRecommendation || isBranch) && isManualMode && onManualSelect && !isRoot && (
            <button
              className="w-full py-1.5 rounded-lg text-[10px] font-bold transition-all hover:scale-[1.02] mb-2"
              style={{
                background: isManuallySelected
                  ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                  : 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
                color: '#fff',
                boxShadow: isManuallySelected
                  ? '0 0 10px rgba(34, 197, 94, 0.3)'
                  : '0 0 10px rgba(59, 130, 246, 0.3)',
              }}
              onClick={(e) => {
                e.stopPropagation();
                onManualSelect(node.id);
              }}
            >
              {isManuallySelected ? '✓ Selected' : isRecommendation ? 'Select This Plan' : 'Select Action'}
            </button>
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
                {node.alternativeCount} paths
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

// Tree Layout Component - renders nodes in a tree structure
function TreeLayout({
  node,
  selectedNodeId,
  onSelect,
  onExpand,
  isManualMode,
  manuallySelectedIds,
  manualPathIds,
  onManualSelect,
  isCustomPathApplied,
}: {
  node: DecisionNode;
  selectedNodeId: string | null;
  onSelect: (node: DecisionNode) => void;
  onExpand: (nodeId: string) => void;
  isManualMode: boolean;
  manuallySelectedIds: Set<string>;
  manualPathIds: Set<string>;
  onManualSelect: (nodeId: string) => void;
  isCustomPathApplied: boolean;
}) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = node.isExpanded;

  return (
    <div className="flex flex-col items-center">
      {/* This node */}
      <NodeCard
        node={node}
        isSelected={selectedNodeId === node.id}
        onSelect={onSelect}
        onExpand={onExpand}
        isManualMode={isManualMode}
        manuallySelectedIds={manuallySelectedIds}
        manualPathIds={manualPathIds}
        onManualSelect={onManualSelect}
        isCustomPathApplied={isCustomPathApplied}
      />

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="flex gap-4 mt-16">
          {node.children.map((child) => (
            <TreeLayout
              key={child.id}
              node={child}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
              onExpand={onExpand}
              isManualMode={isManualMode}
              manuallySelectedIds={manuallySelectedIds}
              manualPathIds={manualPathIds}
              onManualSelect={onManualSelect}
              isCustomPathApplied={isCustomPathApplied}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Helper to count expected visible nodes in the tree
function countVisibleNodes(node: DecisionNode): number {
  let count = 1; // This node
  if (node.isExpanded && node.children && node.children.length > 0) {
    for (const child of node.children) {
      count += countVisibleNodes(child);
    }
  }
  return count;
}

// Main Skill Tree Component with connection management
function SkillTree({
  tree,
  selectedNodeId,
  onSelect,
  onExpand,
  isManualMode,
  manuallySelectedIds,
  manualPathIds,
  onManualSelect,
  isCustomPathApplied,
}: {
  tree: DecisionNode;
  selectedNodeId: string | null;
  onSelect: (node: DecisionNode) => void;
  onExpand: (nodeId: string) => void;
  isManualMode: boolean;
  manuallySelectedIds: Set<string>;
  manualPathIds: Set<string>;
  onManualSelect: (nodeId: string) => void;
  isCustomPathApplied: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);

  // Set ready after a short delay to allow initial render
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
      {/* Connection lines layer */}
      <ConnectionsLayer
        tree={tree}
        containerRef={containerRef}
        manualPathIds={manualPathIds}
        isManualMode={isManualMode}
        isCustomPathApplied={isCustomPathApplied}
      />

      {/* Tree nodes */}
      <TreeLayout
        node={tree}
        selectedNodeId={selectedNodeId}
        onSelect={onSelect}
        onExpand={onExpand}
        isManualMode={isManualMode}
        manuallySelectedIds={manuallySelectedIds}
        manualPathIds={manualPathIds}
        onManualSelect={onManualSelect}
        isCustomPathApplied={isCustomPathApplied}
      />
    </div>
  );
}

// RPG-styled Detail Panel
function SkillDetailPanel({
  node,
  onActivate,
  onClose,
}: {
  node: DecisionNode | null;
  onActivate?: (nodeId: string) => void;
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
      {/* Header with glowing title */}
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
            {node.type === 'root' ? 'Diagnosis' : node.type === 'recommendation' ? 'Care Plan' : 'Action'}
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

      {/* Recommendation card - special treatment */}
      {node.recommendation && (
        <div
          className="p-4 rounded-xl relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(5, 150, 105, 0.1))',
            border: '1px solid rgba(52, 211, 153, 0.5)',
          }}
        >
          {/* Shimmer effect */}
          <div
            className="absolute inset-0 opacity-30"
            style={{
              background: 'linear-gradient(45deg, transparent 40%, rgba(52, 211, 153, 0.3) 50%, transparent 60%)',
              animation: 'shimmer 3s infinite',
            }}
          />
          <div className="relative">
            <div className="flex items-center gap-2 mb-2">
              <ClipboardDocumentCheckIcon className="h-5 w-5 text-emerald-400" />
              <span className="text-emerald-400 text-xs font-bold uppercase tracking-wider">Full Care Plan</span>
            </div>
            <p className="text-emerald-300 font-bold">{node.recommendation.carePlanName}</p>
            <div className="flex items-center gap-3 mt-2 text-xs text-emerald-500">
              <span className="px-2 py-0.5 rounded bg-emerald-900/50">{node.recommendation.category}</span>
              <span>{Math.round(node.recommendation.matchScore * 100)}% match</span>
            </div>
            <button
              className="mt-4 w-full py-2 rounded-lg font-bold text-sm transition-all hover:scale-[1.02]"
              style={{
                background: 'linear-gradient(135deg, #10b981, #059669)',
                color: '#fff',
                boxShadow: '0 0 20px rgba(16, 185, 129, 0.4)',
              }}
              onClick={() => {
                if (onActivate) {
                  onActivate(node.id);
                }
                if (onClose) {
                  onClose();
                }
              }}
            >
              Activate Care Plan
            </button>
          </div>
        </div>
      )}

      {/* Clinical factors */}
      {node.factors.length > 0 && (
        <div>
          <h3 className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-2">
            Clinical Factors
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
                    {factor.impact === 'high' ? '+3' : factor.impact === 'medium' ? '+2' : '+1'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Available paths */}
      {node.children.length > 0 && (
        <div>
          <h3 className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-2">
            {node.type === 'root' ? 'Treatment Pathways' : 'Next Steps'} ({node.children.length})
          </h3>
          <div className="space-y-2">
            {node.children.map((child) => {
              const childColor = child.type === 'recommendation'
                ? { bg: 'rgba(16, 185, 129, 0.2)', text: '#34d399' }
                : { bg: 'rgba(139, 92, 246, 0.2)', text: '#a78bfa' };
              return (
                <div
                  key={child.id}
                  className="flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-all hover:scale-[1.02]"
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

// Helper function to find the path from root to a target node
function findPathToNode(root: DecisionNode, targetId: string): string[] {
  const path: string[] = [];

  const search = (node: DecisionNode, currentPath: string[]): boolean => {
    currentPath = [...currentPath, node.id];
    if (node.id === targetId) {
      path.push(...currentPath);
      return true;
    }
    for (const child of node.children) {
      if (search(child, currentPath)) return true;
    }
    return false;
  };

  search(root, []);
  return path;
}

// Helper function to get all descendants of a node
function getDescendantIds(node: DecisionNode): string[] {
  const ids: string[] = [];
  for (const child of node.children) {
    ids.push(child.id);
    ids.push(...getDescendantIds(child));
  }
  return ids;
}

// Helper function to find paths to multiple target nodes (including their children)
function findPathsToNodes(root: DecisionNode, targetIds: Set<string>): Set<string> {
  const allPaths = new Set<string>();

  Array.from(targetIds).forEach(targetId => {
    // Add path from root to target
    const path = findPathToNode(root, targetId);
    path.forEach(id => allPaths.add(id));

    // Also add all children/descendants of the target node
    const targetNode = getNodeById(root, targetId);
    if (targetNode) {
      getDescendantIds(targetNode).forEach(id => allPaths.add(id));
    }
  });

  return allPaths;
}

// Helper to get node by ID
function getNodeById(root: DecisionNode, targetId: string): DecisionNode | null {
  if (root.id === targetId) return root;
  for (const child of root.children) {
    const found = getNodeById(child, targetId);
    if (found) return found;
  }
  return null;
}

// Helper to convert backend tree to frontend DecisionNode format
function convertToDecisionNode(backendTree: any, isRoot: boolean = true): DecisionNode {
  return {
    id: backendTree.id,
    type: isRoot ? 'root' : backendTree.type?.toLowerCase() === 'recommendation' ? 'recommendation' : 'branch',
    title: backendTree.title,
    description: backendTree.description || '',
    confidence: backendTree.confidence || 0.7,
    factors: (backendTree.factors || []).map((f: any) => ({
      type: f.type?.toLowerCase() || 'condition',
      label: f.label || '',
      value: f.value || '',
      impact: f.impact?.toLowerCase() || 'medium',
    })),
    children: (backendTree.children || []).map((child: any) => convertToDecisionNode(child, false)),
    isExpanded: true,
    isSelected: false,
    isRecommendedPath: backendTree.isRecommendedPath || false,
    alternativeCount: (backendTree.children || []).length > 1 ? backendTree.children.length : undefined,
    recommendation: backendTree.recommendation ? {
      carePlanId: backendTree.recommendation.templateId || '',
      carePlanName: backendTree.recommendation.title || '',
      category: backendTree.recommendation.actionType || 'CARE_PLAN',
      matchScore: backendTree.recommendation.confidence || 0.7,
    } : undefined,
  };
}

// Pathway selector dropdown component
function PathwaySelector({
  pathways,
  selectedPathway,
  onSelect,
  loading,
}: {
  pathways: ClinicalPathway[];
  selectedPathway: ClinicalPathway | null;
  onSelect: (pathway: ClinicalPathway) => void;
  loading: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
        style={{
          background: 'rgba(30, 41, 59, 0.8)',
          border: '1px solid #475569',
          color: '#e2e8f0',
        }}
      >
        {loading ? (
          <Spinner size="sm" />
        ) : selectedPathway ? (
          <>
            <span>{selectedPathway.name}</span>
            <span className="text-xs text-slate-500">v{selectedPathway.version}</span>
          </>
        ) : (
          <span className="text-slate-400">Select a pathway...</span>
        )}
        <ChevronDownIcon className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div
            className="absolute top-full left-0 mt-2 w-80 max-h-96 overflow-auto rounded-lg shadow-xl z-50"
            style={{
              background: 'linear-gradient(135deg, #1e293b, #0f172a)',
              border: '1px solid #475569',
            }}
          >
            {pathways.length === 0 ? (
              <div className="p-4 text-center">
                <p className="text-slate-400 text-sm mb-3">No pathways available</p>
                <Link
                  href="/decision-explorer/pathways/new"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
                  style={{
                    background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
                    color: '#fff',
                  }}
                >
                  <PlusIcon className="h-4 w-4" />
                  Create Pathway
                </Link>
              </div>
            ) : (
              <div className="p-2">
                {pathways.map((pathway) => (
                  <button
                    key={pathway.id}
                    onClick={() => {
                      onSelect(pathway);
                      setIsOpen(false);
                    }}
                    className="w-full text-left p-3 rounded-lg transition-all hover:bg-slate-700/50"
                    style={{
                      background: selectedPathway?.id === pathway.id ? 'rgba(139, 92, 246, 0.2)' : 'transparent',
                      border: selectedPathway?.id === pathway.id ? '1px solid rgba(139, 92, 246, 0.4)' : '1px solid transparent',
                    }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-slate-200">{pathway.name}</span>
                      <span
                        className="text-xs px-2 py-0.5 rounded"
                        style={{
                          background: pathway.isPublished ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                          color: pathway.isPublished ? '#34d399' : '#f59e0b',
                        }}
                      >
                        {pathway.isPublished ? 'Published' : 'Draft'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 line-clamp-2">{pathway.description || 'No description'}</p>
                    <div className="flex gap-1 mt-2">
                      {pathway.primaryConditionCodes.slice(0, 3).map((code) => (
                        <span
                          key={code}
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ background: 'rgba(71, 85, 105, 0.5)', color: '#94a3b8' }}
                        >
                          {code}
                        </span>
                      ))}
                      {pathway.primaryConditionCodes.length > 3 && (
                        <span className="text-[10px] text-slate-500">+{pathway.primaryConditionCodes.length - 3}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function DecisionExplorerPage() {
  // Backend data hooks
  const { pathways, loading: pathwaysLoading } = usePathways({ isActive: true });
  const [selectedPathway, setSelectedPathway] = useState<ClinicalPathway | null>(null);
  const [patientContext] = useState<PatientContext | undefined>(undefined);

  // Get decision tree for selected pathway
  const { result: treeResult, loading: treeLoading } = useDecisionTree(
    selectedPathway?.id || '',
    patientContext
  );

  // Local state
  const [tree, setTree] = useState<DecisionNode>(mockDecisionTree);
  const [selectedNode, setSelectedNode] = useState<DecisionNode | null>(null);
  const [isManualMode, setIsManualMode] = useState(false);
  const [manuallySelectedIds, setManuallySelectedIds] = useState<Set<string>>(new Set());
  const [isCustomPathApplied, setIsCustomPathApplied] = useState(false);
  const [usingMockData, setUsingMockData] = useState(true);

  // Update tree when backend data arrives
  useEffect(() => {
    if (treeResult?.tree) {
      const convertedTree = convertToDecisionNode(treeResult.tree, true);
      setTree(convertedTree);
      setUsingMockData(false);
    }
  }, [treeResult]);

  // Handle pathway selection
  const handlePathwaySelect = useCallback((pathway: ClinicalPathway) => {
    setSelectedPathway(pathway);
    setSelectedNode(null);
    setManuallySelectedIds(new Set());
    setIsCustomPathApplied(false);
    setIsManualMode(false);
  }, []);

  // Calculate the paths to all manually selected nodes
  const manualPathIds = useMemo(() => {
    if (manuallySelectedIds.size === 0) return new Set<string>();
    return findPathsToNodes(tree, manuallySelectedIds);
  }, [tree, manuallySelectedIds]);

  // Get the selected action nodes for display
  const selectedActions = useMemo(() => {
    const actions: DecisionNode[] = [];
    manuallySelectedIds.forEach(id => {
      const node = getNodeById(tree, id);
      if (node) actions.push(node);
    });
    return actions;
  }, [tree, manuallySelectedIds]);

  const handleNodeSelect = useCallback((node: DecisionNode) => {
    setSelectedNode(node);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // Toggle selection of an action node (for building custom paths)
  const handleManualSelect = useCallback((nodeId: string) => {
    setManuallySelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  }, []);

  // Clear all manual selections
  const handleClearSelections = useCallback(() => {
    setManuallySelectedIds(new Set());
    setIsCustomPathApplied(false);
  }, []);

  // Apply the custom path - exit manual mode but keep selections visible
  const handleApplyCustomPath = useCallback(() => {
    if (manuallySelectedIds.size === 0) return;
    setIsCustomPathApplied(true);
    setIsManualMode(false);
    // Collapse nodes that aren't on the selected path
    setTree((prevTree) => {
      const collapseNonSelected = (node: DecisionNode): DecisionNode => {
        const isOnPath = manualPathIds.has(node.id);
        return {
          ...node,
          isExpanded: isOnPath,
          children: node.children.map(collapseNonSelected),
        };
      };
      return collapseNonSelected(prevTree);
    });
  }, [manuallySelectedIds, manualPathIds]);

  const handleToggleManualMode = useCallback(() => {
    setIsManualMode((prev) => {
      if (prev) {
        // Exiting manual mode without applying - clear selections and restore original tree
        if (!isCustomPathApplied) {
          setManuallySelectedIds(new Set());
        }
        // Restore from backend data if available, otherwise use mock
        if (selectedPathway && treeResult?.tree) {
          const convertedTree = convertToDecisionNode(treeResult.tree, true);
          setTree(convertedTree);
        } else {
          setTree(mockDecisionTree);
        }
      } else {
        // Entering manual mode - expand all nodes so providers can see all actions
        const expandAll = (node: DecisionNode): DecisionNode => ({
          ...node,
          isExpanded: true,
          children: node.children.map(expandAll),
        });
        setTree((prevTree) => expandAll(prevTree));
      }
      return !prev;
    });
  }, [isCustomPathApplied, selectedPathway, treeResult]);

  const handleNodeExpand = useCallback((nodeId: string) => {
    setTree((prevTree) => {
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
    if (selectedPathway && treeResult?.tree) {
      const convertedTree = convertToDecisionNode(treeResult.tree, true);
      setTree(convertedTree);
      setUsingMockData(false);
    } else {
      setTree(mockDecisionTree);
      setUsingMockData(true);
    }
    setSelectedNode(null);
    setIsManualMode(false);
    setManuallySelectedIds(new Set());
    setIsCustomPathApplied(false);
  }, [selectedPathway, treeResult]);

  return (
    <div className="fixed inset-0 z-50">
      {/* Custom styles for animations */}
      <style jsx global>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
        @keyframes glow-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes slideOut {
          from { transform: translateX(0); }
          to { transform: translateX(100%); }
        }
      `}</style>

      {/* Full-page tree container */}
      <div
        className="absolute inset-0 flex flex-col"
        style={{ background: 'linear-gradient(135deg, #0f172a, #1e293b)' }}
      >
        {/* Header bar */}
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

            {/* Pathway Selector */}
            <div className="ml-4">
              <PathwaySelector
                pathways={pathways}
                selectedPathway={selectedPathway}
                onSelect={handlePathwaySelect}
                loading={pathwaysLoading || treeLoading}
              />
            </div>

            {/* Data source indicator */}
            {usingMockData && (
              <div
                className="px-2 py-1 rounded text-[10px] font-medium"
                style={{
                  background: 'rgba(245, 158, 11, 0.2)',
                  color: '#f59e0b',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                }}
              >
                Demo Data
              </div>
            )}

            <div className="flex items-center gap-6 text-xs ml-4">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{
                    background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
                    boxShadow: '0 0 8px rgba(251, 191, 36, 0.6)',
                  }}
                />
                <span className="text-slate-400">Origin</span>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{
                    background: 'linear-gradient(135deg, #a78bfa, #8b5cf6)',
                    boxShadow: '0 0 8px rgba(167, 139, 250, 0.6)',
                  }}
                />
                <span className="text-slate-400">Branch</span>
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
            {/* Manual Mode Toggle */}
            <button
              onClick={handleToggleManualMode}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all hover:scale-105"
              style={{
                background: isManualMode
                  ? 'linear-gradient(135deg, #3b82f6, #1d4ed8)'
                  : 'rgba(30, 41, 59, 0.8)',
                border: isManualMode ? '1px solid #3b82f6' : '1px solid #475569',
                color: isManualMode ? '#fff' : '#94a3b8',
                boxShadow: isManualMode ? '0 0 20px rgba(59, 130, 246, 0.4)' : 'none',
              }}
            >
              {isManualMode ? (
                <>
                  <CheckCircleIcon className="h-4 w-4 inline mr-2" />
                  Manual Mode ON
                </>
              ) : (
                <>
                  <ExclamationTriangleIcon className="h-4 w-4 inline mr-2" />
                  Override Recommendation
                </>
              )}
            </button>

            {/* Custom path applied indicator (outside manual mode) */}
            {isCustomPathApplied && !isManualMode && manuallySelectedIds.size > 0 && (
              <div className="flex items-center gap-2">
                <div
                  className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
                  style={{
                    background: 'rgba(16, 185, 129, 0.2)',
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    color: '#34d399',
                  }}
                >
                  <CheckCircleIcon className="h-3.5 w-3.5" />
                  Custom path applied ({manuallySelectedIds.size} action{manuallySelectedIds.size !== 1 ? 's' : ''})
                </div>
                <button
                  onClick={handleClearSelections}
                  className="px-2 py-1.5 rounded-lg text-xs font-medium transition-all hover:scale-105"
                  style={{
                    background: 'rgba(239, 68, 68, 0.2)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    color: '#f87171',
                  }}
                >
                  Clear
                </button>
              </div>
            )}

            {/* Manual selection indicator (in manual mode) */}
            {isManualMode && manuallySelectedIds.size > 0 && (
              <div className="flex items-center gap-2">
                <div
                  className="px-3 py-1.5 rounded-lg text-xs font-medium"
                  style={{
                    background: 'rgba(59, 130, 246, 0.2)',
                    border: '1px solid rgba(59, 130, 246, 0.4)',
                    color: '#60a5fa',
                  }}
                >
                  {manuallySelectedIds.size} action{manuallySelectedIds.size !== 1 ? 's' : ''} selected
                </div>
                <button
                  onClick={handleClearSelections}
                  className="px-2 py-1.5 rounded-lg text-xs font-medium transition-all hover:scale-105"
                  style={{
                    background: 'rgba(239, 68, 68, 0.2)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    color: '#f87171',
                  }}
                >
                  Clear
                </button>
              </div>
            )}

            <div className="w-px h-6 bg-slate-700" />

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
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all hover:scale-105"
              style={{
                background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
                color: '#fff',
                boxShadow: '0 0 20px rgba(139, 92, 246, 0.4)',
              }}
            >
              <SparklesIcon className="h-4 w-4 inline mr-2" />
              New Analysis
            </button>
          </div>
        </div>

        {/* Tree container with grid background - takes remaining space */}
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
          {/* Centered tree */}
          <div className="min-w-max flex justify-center pt-8">
            <SkillTree
              tree={tree}
              selectedNodeId={selectedNode?.id || null}
              onSelect={handleNodeSelect}
              onExpand={handleNodeExpand}
              isManualMode={isManualMode}
              manuallySelectedIds={manuallySelectedIds}
              manualPathIds={manualPathIds}
              onManualSelect={handleManualSelect}
              isCustomPathApplied={isCustomPathApplied}
            />
          </div>
        </div>
      </div>

      {/* Side drawer */}
      {selectedNode && (
        <>
          {/* Backdrop */}
          <div
            className="absolute inset-0 z-[100] bg-black/40 transition-opacity duration-300"
            onClick={handleClosePanel}
          />

          {/* Drawer */}
          <div
            className="absolute top-0 right-0 h-full w-[380px] z-[101] flex flex-col"
            style={{
              background: 'linear-gradient(180deg, #0f172a, #1e293b)',
              borderLeft: '1px solid rgba(139, 92, 246, 0.3)',
              boxShadow: '-10px 0 40px rgba(0, 0, 0, 0.5), 0 0 60px rgba(139, 92, 246, 0.1)',
              animation: 'slideIn 0.3s ease-out',
            }}
          >
            {/* Drawer header */}
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
                <svg className="h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Drawer content */}
            <div className="flex-1 overflow-auto p-4">
              <SkillDetailPanel
                node={selectedNode}
                onActivate={handleManualSelect}
                onClose={handleClosePanel}
              />
            </div>
          </div>
        </>
      )}

      {/* Selected Actions Panel - floating at bottom */}
      {isManualMode && selectedActions.length > 0 && (
        <div
          className="absolute bottom-0 left-0 right-0 z-[90] p-4"
          style={{
            background: 'linear-gradient(180deg, transparent, rgba(15, 23, 42, 0.95) 20%)',
          }}
        >
          <div
            className="max-w-4xl mx-auto rounded-xl p-4"
            style={{
              background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98))',
              border: '1px solid rgba(59, 130, 246, 0.4)',
              boxShadow: '0 -4px 30px rgba(0, 0, 0, 0.5), 0 0 40px rgba(59, 130, 246, 0.15)',
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ClipboardDocumentCheckIcon className="h-5 w-5 text-blue-400" />
                <span className="text-white font-medium text-sm">Your Custom Path</span>
                <span
                  className="px-2 py-0.5 rounded text-[10px] font-bold"
                  style={{
                    background: 'rgba(59, 130, 246, 0.3)',
                    color: '#60a5fa',
                  }}
                >
                  {selectedActions.length} action{selectedActions.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleClearSelections}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:scale-105"
                  style={{
                    background: 'rgba(239, 68, 68, 0.2)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    color: '#f87171',
                  }}
                >
                  Clear All
                </button>
                <button
                  onClick={handleApplyCustomPath}
                  className="px-4 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105"
                  style={{
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                    color: '#fff',
                    boxShadow: '0 0 15px rgba(16, 185, 129, 0.4)',
                  }}
                >
                  Apply Custom Path
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedActions.map((action) => (
                <div
                  key={action.id}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg group"
                  style={{
                    background: action.type === 'recommendation'
                      ? 'rgba(16, 185, 129, 0.2)'
                      : 'rgba(139, 92, 246, 0.2)',
                    border: action.type === 'recommendation'
                      ? '1px solid rgba(52, 211, 153, 0.4)'
                      : '1px solid rgba(167, 139, 250, 0.4)',
                  }}
                >
                  {action.type === 'recommendation' ? (
                    <ClipboardDocumentCheckIcon className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <WrenchScrewdriverIcon className="h-4 w-4 text-purple-400" />
                  )}
                  <span
                    className="text-xs font-medium max-w-[200px] truncate"
                    style={{
                      color: action.type === 'recommendation' ? '#34d399' : '#a78bfa',
                    }}
                  >
                    {action.title}
                  </span>
                  <button
                    onClick={() => handleManualSelect(action.id)}
                    className="p-0.5 rounded hover:bg-white/10 transition-colors opacity-60 group-hover:opacity-100"
                  >
                    <XMarkIcon className="h-3.5 w-3.5 text-slate-400" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Applied Custom Path Summary Panel (outside manual mode) */}
      {isCustomPathApplied && !isManualMode && selectedActions.length > 0 && (
        <div
          className="absolute bottom-0 left-0 right-0 z-[90] p-4"
          style={{
            background: 'linear-gradient(180deg, transparent, rgba(15, 23, 42, 0.95) 20%)',
          }}
        >
          <div
            className="max-w-4xl mx-auto rounded-xl p-4"
            style={{
              background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98))',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              boxShadow: '0 -4px 30px rgba(0, 0, 0, 0.5), 0 0 40px rgba(16, 185, 129, 0.15)',
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CheckCircleIcon className="h-5 w-5 text-emerald-400" />
                <span className="text-white font-medium text-sm">Custom Path Applied</span>
                <span
                  className="px-2 py-0.5 rounded text-[10px] font-bold"
                  style={{
                    background: 'rgba(16, 185, 129, 0.3)',
                    color: '#34d399',
                  }}
                >
                  {selectedActions.length} action{selectedActions.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleToggleManualMode}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:scale-105"
                  style={{
                    background: 'rgba(59, 130, 246, 0.2)',
                    border: '1px solid rgba(59, 130, 246, 0.4)',
                    color: '#60a5fa',
                  }}
                >
                  Edit Selection
                </button>
                <button
                  onClick={handleClearSelections}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:scale-105"
                  style={{
                    background: 'rgba(239, 68, 68, 0.2)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    color: '#f87171',
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedActions.map((action) => (
                <div
                  key={action.id}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
                  style={{
                    background: action.type === 'recommendation'
                      ? 'rgba(16, 185, 129, 0.2)'
                      : 'rgba(139, 92, 246, 0.2)',
                    border: action.type === 'recommendation'
                      ? '1px solid rgba(52, 211, 153, 0.4)'
                      : '1px solid rgba(167, 139, 250, 0.4)',
                  }}
                >
                  {action.type === 'recommendation' ? (
                    <ClipboardDocumentCheckIcon className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <WrenchScrewdriverIcon className="h-4 w-4 text-purple-400" />
                  )}
                  <span
                    className="text-xs font-medium max-w-[200px] truncate"
                    style={{
                      color: action.type === 'recommendation' ? '#34d399' : '#a78bfa',
                    }}
                  >
                    {action.title}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
