'use client';

export default function CopilotSidebar() {
  return (
    <div className="enc-copilot">
      <div className="enc-copilot-head">
        <div className="enc-copilot-icon enc-display" style={{ fontFamily: 'var(--font-newsreader)' }}>
          P
        </div>
        <div>
          <div className="enc-copilot-title" style={{ fontFamily: 'var(--font-manrope)' }}>
            Prism Copilot
          </div>
          <div className="enc-copilot-sub enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
            Ambient &middot; contextual
          </div>
        </div>
        <div className="enc-copilot-status enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
          <div className="enc-copilot-status-dot" />
          Active
        </div>
      </div>

      <div className="enc-copilot-body">
        {/* Transcript ticker */}
        <div className="enc-transcript-ticker" style={{ fontFamily: 'var(--font-manrope)' }}>
          <div className="speaker" style={{ fontFamily: 'var(--font-jetbrains)' }}>
            Dr. Chen &middot; 2:14 PM
          </div>
          &ldquo;We&rsquo;re going to focus on her routine 28-week visit today, plus her diabetes
          and blood pressure.&rdquo;
        </div>

        {/* At this step */}
        <div className="enc-copilot-section">
          <div className="enc-cp-h enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
            &#9670; At this step
          </div>
          <div className="enc-cp-msg" style={{ fontFamily: 'var(--font-manrope)' }}>
            You have <strong>3 diagnoses set</strong> and you&rsquo;re confirming evidence. Once
            you confirm the GDM attributes, the plan recommendations will unlock for that diagnosis.
          </div>
        </div>

        {/* Provenance summary */}
        <div className="enc-copilot-section govern">
          <div className="enc-cp-h enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
            &#9672; Provenance summary
          </div>
          <div className="enc-cp-msg" style={{ fontFamily: 'var(--font-manrope)' }}>
            Today&rsquo;s diagnoses came from:
          </div>
          <div className="enc-cp-rows" style={{ fontFamily: 'var(--font-jetbrains)' }}>
            <div className="enc-cp-row">
              <span>
                <span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--src-list)', borderRadius: 2, marginRight: 6 }} />
                From problem list
              </span>
              <strong>2</strong>
            </div>
            <div className="enc-cp-row">
              <span>
                <span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--src-verbal)', borderRadius: 2, marginRight: 6 }} />
                From your conversation
              </span>
              <strong>1</strong>
            </div>
            <div className="enc-cp-row">
              <span>
                <span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--src-manual)', borderRadius: 2, marginRight: 6 }} />
                Manual add
              </span>
              <strong>0</strong>
            </div>
          </div>
        </div>

        {/* Preference layers */}
        <div className="enc-copilot-section pref">
          <div className="enc-cp-h enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>
            &#9673; Preference Layers
          </div>
          <div className="enc-cp-msg" style={{ fontFamily: 'var(--font-manrope)' }}>
            3 layers active. <strong>1 conflict</strong> on growth US timing.
          </div>
          <div className="enc-cp-pref-rows" style={{ fontFamily: 'var(--font-manrope)' }}>
            <div className="enc-cp-pref-row">
              <div className="enc-cp-pref-lbl-dot" style={{ background: 'var(--inst)' }} />
              <div><strong>Memorial MH</strong> &middot; 3 overrides</div>
            </div>
            <div className="enc-cp-pref-row">
              <div className="enc-cp-pref-lbl-dot" style={{ background: 'var(--accent)' }} />
              <div><strong>Dr. Chen</strong> &middot; 47 patients learned</div>
            </div>
            <div className="enc-cp-pref-row">
              <div className="enc-cp-pref-lbl-dot" style={{ background: 'var(--pt)' }} />
              <div><strong>Patient</strong> &middot; 2 preferences</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
