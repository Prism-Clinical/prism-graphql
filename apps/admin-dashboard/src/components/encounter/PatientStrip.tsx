'use client';

export default function PatientStrip() {
  return (
    <div className="enc-patient-strip">
      <div className="enc-patient-info">
        <div>
          <div className="enc-pt-name enc-display" style={{ fontFamily: 'var(--font-newsreader)' }}>
            Maria Johnson
          </div>
          <div className="enc-pt-meta-line" style={{ fontFamily: 'var(--font-jetbrains)' }}>
            <span className="enc-pt-meta-ga">28&#8314;&#178; wk</span>
            <span className="enc-pt-meta-sep">&middot;</span>
            <span>G3P1011</span>
            <span className="enc-pt-meta-sep">&middot;</span>
            <span>EDD Jun 18</span>
            <span className="enc-pt-meta-sep">&middot;</span>
            <span>DOB 04/12/92</span>
            <span className="enc-pt-meta-sep">&middot;</span>
            <span className="enc-pt-meta-risk">High risk &middot; GDM + CHTN</span>
          </div>
        </div>
      </div>
      <div className="enc-pt-vitals-row">
        <div className="enc-vital-box alert">
          <div className="enc-vital-box-lbl enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>BP</div>
          <div className="enc-vital-box-val">128/82</div>
        </div>
        <div className="enc-vital-box">
          <div className="enc-vital-box-lbl enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>Weight</div>
          <div className="enc-vital-box-val">168</div>
        </div>
        <div className="enc-vital-box">
          <div className="enc-vital-box-lbl enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>FHR</div>
          <div className="enc-vital-box-val">142</div>
        </div>
        <div className="enc-vital-box">
          <div className="enc-vital-box-lbl enc-mono" style={{ fontFamily: 'var(--font-jetbrains)' }}>Fundal</div>
          <div className="enc-vital-box-val">28</div>
        </div>
      </div>
    </div>
  );
}
