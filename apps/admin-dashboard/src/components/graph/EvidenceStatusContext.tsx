'use client';

import { createContext, useContext, useMemo } from 'react';
import type { AdminEvidenceEntry } from '@/types';

export const EVIDENCE_ELIGIBLE_TYPES = new Set([
  'Stage', 'Step', 'DecisionPoint', 'Criterion',
  'Medication', 'LabTest', 'Procedure',
]);

interface EvidenceStatusContextValue {
  nodesWithEvidence: Set<string>;
  isEligible: (nodeType: string) => boolean;
  openQuickAddEvidence: (nodeIdentifier: string, nodeLabel: string) => void;
}

const noop = () => {};

const EvidenceStatusContext = createContext<EvidenceStatusContextValue>({
  nodesWithEvidence: new Set(),
  isEligible: () => false,
  openQuickAddEvidence: noop,
});

interface EvidenceStatusProviderProps {
  entries: AdminEvidenceEntry[];
  onQuickAddEvidence?: (nodeIdentifier: string, nodeLabel: string) => void;
  children: React.ReactNode;
}

export function EvidenceStatusProvider({ entries, onQuickAddEvidence, children }: EvidenceStatusProviderProps) {
  const value = useMemo<EvidenceStatusContextValue>(() => {
    const nodesWithEvidence = new Set(entries.map((e) => e.nodeIdentifier));
    return {
      nodesWithEvidence,
      isEligible: (nodeType: string) => EVIDENCE_ELIGIBLE_TYPES.has(nodeType),
      openQuickAddEvidence: onQuickAddEvidence ?? noop,
    };
  }, [entries, onQuickAddEvidence]);

  return (
    <EvidenceStatusContext.Provider value={value}>
      {children}
    </EvidenceStatusContext.Provider>
  );
}

export function useEvidenceStatus() {
  return useContext(EvidenceStatusContext);
}
