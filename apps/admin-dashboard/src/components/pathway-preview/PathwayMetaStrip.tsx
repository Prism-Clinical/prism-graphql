'use client';

import type { PathwayCategory } from '@/types';

interface PathwayMetaStripProps {
  category: PathwayCategory;
  scope: string | null;
  targetPopulation: string | null;
  nodeCount: number;
  stageCount: number;
  stepCount: number;
  conditionCount: number;
}

const CATEGORY_LABELS: Record<PathwayCategory, string> = {
  CHRONIC_DISEASE: 'Chronic Disease',
  ACUTE_CARE: 'Acute Care',
  PREVENTIVE_CARE: 'Preventive Care',
  POST_PROCEDURE: 'Post-Procedure',
  MEDICATION_MANAGEMENT: 'Medication Mgmt',
  LIFESTYLE_MODIFICATION: 'Lifestyle',
  MENTAL_HEALTH: 'Mental Health',
  PEDIATRIC: 'Pediatric',
  GERIATRIC: 'Geriatric',
  OBSTETRIC: 'Obstetric',
};

export default function PathwayMetaStrip({
  category,
  scope,
  targetPopulation,
  nodeCount,
  stageCount,
  stepCount,
  conditionCount,
}: PathwayMetaStripProps) {
  return (
    <div className="enc-patient-strip">
      <div className="enc-patient-info">
        <div>
          <div className="enc-pt-name" style={{ fontSize: 18 }}>
            {CATEGORY_LABELS[category] ?? category}
          </div>
          <div className="enc-pt-meta-line">
            {scope && (
              <>
                <span>Scope: {scope}</span>
                {targetPopulation && <span className="enc-pt-meta-sep">&middot;</span>}
              </>
            )}
            {targetPopulation && (
              <span>Population: {targetPopulation}</span>
            )}
            {!scope && !targetPopulation && (
              <span style={{ fontStyle: 'italic' }}>No scope or population defined</span>
            )}
          </div>
        </div>
      </div>
      <div className="enc-pt-vitals-row">
        <SummaryBox label="Nodes" value={nodeCount} />
        <SummaryBox label="Stages" value={stageCount} />
        <SummaryBox label="Steps" value={stepCount} />
        <SummaryBox label="Conditions" value={conditionCount} />
      </div>
    </div>
  );
}

function SummaryBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="enc-vital-box">
      <div className="enc-vital-box-lbl">{label}</div>
      <div className="enc-vital-box-val">{value}</div>
    </div>
  );
}
