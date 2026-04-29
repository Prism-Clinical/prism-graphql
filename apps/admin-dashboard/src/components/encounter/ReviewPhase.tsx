'use client';

import { useState } from 'react';

interface ReviewPhaseProps {
  onBackToAssessment: () => void;
}

function ApprovedItem({ icon, iconType, name, detail }: {
  icon: string; iconType: string; name: string; detail: string;
}) {
  return (
    <div
      className="enc-plan-item"
      style={{ background: 'var(--ok-soft)', borderColor: 'var(--ok-soft)', opacity: 0.85, pointerEvents: 'none' }}
    >
      <div className={`enc-plan-item-icon ${iconType}`} style={{ fontFamily: 'var(--font-jetbrains)' }}>
        {icon}
      </div>
      <div className="enc-plan-item-body" style={{ fontFamily: 'var(--font-manrope)' }}>
        <div className="enc-plan-item-name">
          {name}{' '}
          <span style={{ color: 'var(--ok)', fontWeight: 600, fontSize: 11 }}>&#10003;</span>
        </div>
        <div className="enc-plan-item-detail">{detail}</div>
      </div>
    </div>
  );
}

const LONG_NOTE = (
  <>
    <div style={{ marginBottom: 16 }}>
      <div className="enc-note-section-label enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
        Subjective
      </div>
      <p>
        28w2d G3P1011 presents for routine prenatal care. Patient reports feeling well overall with
        good fetal movement. Endorses mostly adherent GDM diet with reported lapses on weekends. Home
        blood pressure readings 120s&ndash;130s/78&ndash;84, max 132/84 this week. Denies headaches,
        visual changes, or right upper quadrant pain. Denies vaginal bleeding, leaking fluid, or
        contractions. Taking all medications as prescribed.
      </p>
    </div>
    <div style={{ marginBottom: 16 }}>
      <div className="enc-note-section-label enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
        Objective
      </div>
      <p>
        <strong>Vitals:</strong> BP 128/82, Weight 168 lbs (+22 lbs). <strong>Fetal:</strong> FHR
        142, Fundal height 28 cm &mdash; consistent with GA. <strong>Exam:</strong> Trace bilateral
        pedal edema, non-pitting. Abdomen soft, non-tender, gravid.{' '}
        <strong>Labs (3d ago):</strong> FG 94 (at target), 2hr PP 128 (above target &lt;120). HbA1c
        5.8%. Urine protein negative.
      </p>
    </div>
    <div>
      <div className="enc-note-section-label enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
        Assessment &amp; Plan
      </div>
      <p style={{ marginBottom: 10 }}>
        <strong>1. Gestational diabetes (O24.410)</strong> &mdash; 2hr post-prandial above target
        with reported weekend dietary lapses. HbA1c within goal. Plan: increase Metformin to 750mg
        BID, recheck glucose @30w, reinforce weekend dietary compliance.
      </p>
      <p style={{ marginBottom: 10 }}>
        <strong>2. Chronic hypertension in pregnancy (O10.012)</strong> &mdash; BP borderline
        elevated with home readings trending up. No proteinuria, no PEC symptoms. Continue ASA
        through 36w. Order urine P:C ratio. Growth ultrasound @30w per institutional protocol.
      </p>
      <p>
        <strong>3. Routine prenatal care, 28 weeks (Z34.83)</strong> &mdash; Fundal height
        appropriate, FHR reassuring. Administer Tdap. Rh+ (no RhoGAM). RTC 2 weeks.
      </p>
    </div>
  </>
);

const SHORT_NOTE = (
  <div style={{ marginBottom: 16 }}>
    <div className="enc-note-section-label enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
      A/P &middot; Short Form
    </div>
    <p>28w2d routine. Well, good FM, meds compliant.</p>
    <p style={{ marginTop: 10 }}>
      <strong>GDM (O24.410):</strong> 2hr PP 128&uarr;. &uarr; Met 750 BID. Recheck @30w. Diet
      reinforce weekends.
    </p>
    <p style={{ marginTop: 10 }}>
      <strong>CHTN (O10.012):</strong> BP 128/82. No PEC sxs. Prot neg. Cont ASA. P:C ratio.
      Growth US @30w.
    </p>
    <p style={{ marginTop: 10 }}>
      <strong>Routine 28w (Z34.83):</strong> FH=dates. FHR 142. Tdap today. Rh+. RTC 2w.
    </p>
  </div>
);

export default function ReviewPhase({ onBackToAssessment }: ReviewPhaseProps) {
  const [noteForm, setNoteForm] = useState<'long' | 'short'>('long');

  return (
    <div className="enc-phase-content">
      <div className="enc-phase-heading">
        <div>
          <h1 className="enc-display" style={{ fontFamily: 'var(--font-newsreader)' }}>
            Review &amp; <em>sign</em>
          </h1>
          <div className="enc-subtitle" style={{ fontFamily: 'var(--font-manrope)' }}>
            Everything you approved, consolidated. Review the order manifest and note below, then
            sign to push to EHR.
          </div>
        </div>
        <div className="enc-phase-heading-right enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
          Ready<br />
          <strong style={{ fontFamily: 'var(--font-newsreader)' }}>to sign</strong>
        </div>
      </div>

      {/* Order Manifest */}
      <div style={{ marginBottom: 24 }}>
        <div className="enc-ev-h enc-mono" style={{ fontFamily: 'var(--font-jetbrains)', marginBottom: 12 }}>
          <span>&#9670; Order Manifest &mdash; 8 items approved</span>
          <span className="enc-ev-pill done">ready to push</span>
        </div>

        {/* GDM orders */}
        <div className="enc-manifest-group-head enc-mono" style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--src-list)' }}>
          <div className="enc-manifest-group-mark" style={{ background: 'var(--src-list)' }}>L</div>
          Gestational Diabetes &middot; O24.410
        </div>
        <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <ApprovedItem icon="Rx" iconType="rx" name="Increase Metformin 500 \u2192 750mg BID" detail="Medication adjustment \u00B7 new order" />
          <ApprovedItem icon="Lab" iconType="lab" name="Repeat fasting + 2hr PP glucose @ 30w" detail="Lab order \u00B7 fasting specimen" />
          <ApprovedItem icon="Edu" iconType="edu" name="Weekend dietary counseling" detail="Patient education \u00B7 targeted" />
        </div>

        {/* CHTN orders */}
        <div className="enc-manifest-group-head enc-mono" style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--src-list)' }}>
          <div className="enc-manifest-group-mark" style={{ background: 'var(--src-list)' }}>L</div>
          Chronic Hypertension &middot; O10.012
        </div>
        <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <ApprovedItem icon="Lab" iconType="lab" name="Urine protein:creatinine ratio" detail="Spot urine \u00B7 today" />
          <ApprovedItem icon="US" iconType="img" name="Growth ultrasound @ 30 weeks" detail="Imaging order \u00B7 OB growth scan" />
          <ApprovedItem icon="Rx" iconType="rx" name="Continue ASA 81mg daily \u2192 36w" detail="Medication \u00B7 continue existing" />
        </div>

        {/* Routine orders */}
        <div className="enc-manifest-group-head enc-mono" style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--src-verbal)' }}>
          <div className="enc-manifest-group-mark" style={{ background: 'var(--src-verbal)' }}>V</div>
          Routine Prenatal 28w &middot; Z34.83
        </div>
        <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <ApprovedItem icon="Vac" iconType="vac" name="Tdap vaccine \u2014 today" detail="Immunization \u00B7 27\u201336w window" />
          <div className="enc-plan-item" style={{ opacity: 0.5, pointerEvents: 'none' }}>
            <div className="enc-plan-item-icon vac" style={{ fontFamily: 'var(--font-jetbrains)' }}>Vac</div>
            <div className="enc-plan-item-body" style={{ fontFamily: 'var(--font-manrope)' }}>
              <div className="enc-plan-item-name">
                RhoGAM &mdash; not indicated{' '}
                <span style={{ color: 'var(--ok)', fontWeight: 600, fontSize: 11 }}>&#10003; auto</span>
              </div>
              <div className="enc-plan-item-detail">Patient Rh-positive</div>
            </div>
          </div>
        </div>

        <div
          style={{
            textAlign: 'center', padding: 10, background: 'var(--panel-2)', borderRadius: 6,
            fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.15em',
          }}
          className="enc-mono"
        >
          <span style={{ fontFamily: 'var(--font-jetbrains)' }}>Need to change something?</span>
          <button
            className="enc-btn"
            style={{ marginLeft: 10, padding: '5px 12px', fontFamily: 'var(--font-manrope)' }}
            onClick={onBackToAssessment}
          >
            &larr; Back to Assessment &amp; Plan
          </button>
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--rule)', margin: '24px 0' }} />

      {/* Visit Note */}
      <div className="enc-note-container">
        <div className="enc-note-header">
          <div className="enc-note-date enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
            Visit Note &middot; Apr 14, 2026
          </div>
          <div className="enc-note-toggle-wrap">
            <button
              className={`enc-note-toggle-btn ${noteForm === 'long' ? 'active' : ''}`}
              style={{ fontFamily: 'var(--font-jetbrains)' }}
              onClick={() => setNoteForm('long')}
            >
              Long
            </button>
            <button
              className={`enc-note-toggle-btn ${noteForm === 'short' ? 'active' : ''}`}
              style={{ fontFamily: 'var(--font-jetbrains)' }}
              onClick={() => setNoteForm('short')}
            >
              Short
            </button>
          </div>
        </div>
        <div className="enc-note-body" style={{ fontFamily: 'var(--font-newsreader)' }}>
          {noteForm === 'long' ? LONG_NOTE : SHORT_NOTE}
        </div>
        <div className="enc-note-footer">
          <button className="enc-btn" style={{ fontFamily: 'var(--font-manrope)' }}>Edit Note</button>
          <button
            className="enc-btn enc-btn-primary"
            style={{ fontFamily: 'var(--font-manrope)' }}
            onClick={() => alert('Signed. Orders and note pushed to athenahealth.')}
          >
            Sign &amp; Push to EHR
          </button>
        </div>
      </div>
    </div>
  );
}
