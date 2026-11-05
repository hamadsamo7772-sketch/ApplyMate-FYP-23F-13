import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';

const DEGREE_FIELDS = (title, discipline, board) => [
  ['programTitle', 'Programme / certificate', { hint: title }],
  ['discipline', 'Discipline / group', { hint: discipline }],
  ['board', 'Board / university', { hint: board }],
  ['school', 'School / college / campus'],
  ['sector', 'Sector', { options: ['Public Sector', 'Private Sector'] }],
  ['country', 'Country', { hint: 'Pakistan' }], ['city', 'City'],
  ['startDate', 'Start date', { type: 'date' }], ['endDate', 'End / passing date', { type: 'date' }],
  ['rollNumber', 'Roll / registration number'],
  ['totalMarks', 'Total marks'], ['obtainedMarks', 'Obtained marks'],
  ['cgpa', 'CGPA (if graded by CGPA)'], ['cgpaScale', 'Out of', { hint: '4.00' }],
  ['incomplete', 'Still studying?', { options: ['No', 'Yes'] }],
];

// Same keys as agent/profile-keys.js: the agent reads these directly
const SECTIONS = [
  {
    id: 'personal', title: 'Personal details',
    fields: [
      ['fullName', 'Full name'], ['firstName', 'First name'], ['middleName', 'Middle name', { hint: 'leave empty if none' }], ['lastName', 'Last name'],
      ['fatherName', "Father's / guardian's name"],
      ['gender', 'Gender', { options: ['Male', 'Female', 'Other'] }],
      ['dateOfBirth', 'Date of birth', { type: 'date' }],
      ['email', 'Email', { type: 'email' }], ['phone', 'Phone', { hint: '03xxxxxxxxx' }],
      ['cnic', 'CNIC', { hint: '12345-1234567-1' }], ['nationality', 'Nationality'],
      ['title', 'Title', { options: ['Mr', 'Ms', 'Mx'] }],
      ['domicile', 'Domicile', { hint: 'e.g. Sindh Urban' }],
      ['maritalStatus', 'Marital status', { options: ['Single', 'Married', 'Divorced', 'Widowed'] }],
      ['placeOfBirth', 'Place of birth (city)'], ['countryOfBirth', 'Country of birth'],
      ['passportNumber', 'Passport number', { hint: 'needed for international scholarships' }],
      ['passportExpiry', 'Passport valid until', { type: 'date' }],
    ],
  },
  {
    id: 'address', title: 'Address',
    fields: [['street', 'Postal address', { wide: true }], ['city', 'City'], ['province', 'Province'], ['postalCode', 'Postal code'], ['country', 'Country']],
  },
  {
    id: 'education', title: 'Education',
    fields: [['lastDegree', 'Highest degree completed', { hint: 'e.g. BS Computer Science' }], ['institution', 'University / institution'],
      ['cgpa', 'CGPA'], ['gradeScale', 'Best possible grade', { hint: 'e.g. 4.00' }],
      ['fieldOfStudy', 'Subject / major', { hint: 'e.g. Computer Science' }],
      ['institutionCity', 'University city'], ['institutionCountry', 'University country'],
      ['startDate', 'Studies started', { type: 'date' }], ['endDate', 'Graduation (expected)', { type: 'date' }],
      ['program', 'Program you are applying for', { hint: 'e.g. MS Computer Science' }]],
  },
  {
    id: 'eduMatric', title: 'Matric / O-level', group: 'Education history',
    note: 'Portals like HEC ask for every degree separately. The agent adds each one from here.',
    fields: DEGREE_FIELDS('Matric', 'Science', 'BISE Sukkur'),
  },
  { id: 'eduInter', title: 'Intermediate / A-level', group: 'Education history', fields: DEGREE_FIELDS('Intermediate', 'Pre-Engineering', 'BISE Sukkur') },
  { id: 'eduBachelor', title: 'Bachelor’s', group: 'Education history', fields: DEGREE_FIELDS('BS Computer Science', 'Computer Science', 'Sukkur IBA University') },
  { id: 'eduMaster', title: 'Master’s / MS / MPhil', group: 'Education history', fields: DEGREE_FIELDS('MS …', '', '') },
  {
    id: 'languages', title: 'Languages',
    note: 'International scholarships (DAAD, Chevening, Erasmus) ask for these.',
    fields: [['motherTongue', 'Mother tongue', { hint: 'e.g. Sindhi' }],
      ['english', 'English level', { options: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] }],
      ['englishTest', 'English test', { hint: 'e.g. IELTS Academic' }], ['englishScore', 'Test score', { hint: 'e.g. 7.0' }],
      ['german', 'German level', { options: ['None', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'] }]],
  },
  {
    id: 'statements', title: 'Statements',
    note: 'Write these once in your own words. The agent pastes them into motivation / statement fields and checks each form’s length limit first.',
    fields: [
      ['motivation', 'Motivation / statement of purpose', { wide: true, textarea: true, hint: 'Why this field, why abroad, what you will do after your studies…' }],
      ['careerGoals', 'Career goals / plans after the scholarship', { wide: true, textarea: true }],
    ],
  },
  {
    id: 'job', title: 'Work',
    fields: [['currentTitle', 'Current job title'], ['employer', 'Employer'], ['experienceYears', 'Years of experience'],
      ['expectedSalary', 'Expected monthly salary (PKR)'], ['currentSalary', 'Current monthly salary (PKR)'],
      ['noticePeriod', 'Notice period / availability']],
  },
  {
    id: 'preferences', title: 'What you’re looking for',
    note: 'Used to rank scholarships and jobs for you.',
    fields: [
      ['degreeLevel', 'Scholarship level', { options: ['Bachelors', 'Masters', 'PhD', 'Short course'] }],
      ['studyField', 'Field of study', { hint: 'e.g. computer science' }],
      ['jobKeywords', 'Job keywords', { wide: true, hint: 'Comma separated, e.g. web developer, react, mern' }],
      ['preferredCities', 'Preferred cities', { wide: true, hint: 'e.g. Sukkur, Karachi, Remote' }],
      ['previousScholarships', 'Scholarships you held before', { wide: true, hint: 'e.g. DAAD 2019, HEC need-based (some programmes are only for former holders)' }],
    ],
  },
];

const DOCS = [['cv', 'CV / résumé'], ['transcript', 'Transcript'], ['cnicCopy', 'CNIC copy'], ['photo', 'Photo'],
  ['passport', 'Passport copy'], ['degree', 'Degree certificate'], ['languageCert', 'Language certificate'], ['motivationLetter', 'Motivation letter']];
const TABS = [...SECTIONS.map((s) => [s.id, s.title]), ['documents', 'Documents & CV import'], ['notifications', 'Notifications']];

export default function Profile() {
  const [profile, setProfile] = useState(null);
  // the dashboard links straight to a section: /app/profile?tab=languages
  const [params] = useSearchParams();
  const wanted = params.get('tab');
  const [tab, setTab] = useState(wanted || 'personal');
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/profile').then((d) => {
      setProfile(d.profile);
      // new users with no documents start at the CV import
      if (!wanted && !d.profile.documents?.cv && !d.profile.education?.lastDegree) setTab('documents');
    }).catch((e) => setMsg({ ok: false, text: e.message }));
  }, []);

  useEffect(() => {
    const warn = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (!profile) return <div className="empty">{msg?.text || 'Loading profile…'}</div>;

  const set = (section, key) => (e) => {
    setDirty(true);
    setMsg(null);
    setProfile({ ...profile, [section]: { ...(profile[section] || {}), [key]: e.target.value } });
  };

  const save = async (data = profile) => {
    setBusy(true);
    try {
      const body = Object.fromEntries(SECTIONS.map((s) => [s.id, data[s.id] || {}]));
      const d = await api('/profile', { method: 'PUT', body });
      setProfile(d.profile);
      setDirty(false);
      setMsg({ ok: true, text: 'Profile saved.' });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const filled = (s) => s.fields.filter(([k]) => profile[s.id]?.[k]).length;
  const section = SECTIONS.find((s) => s.id === tab);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Profile & documents</h1>
          <p>Fill this once. The agent uses it for every application. It stays on this computer, and the AI only sees field names, never these values.</p>
        </div>
      </div>

      <div className="profile-layout">
        <nav className="subnav" aria-label="Profile sections">
          {TABS.map(([id, label], i) => {
            const s = SECTIONS.find((x) => x.id === id);
            const prev = SECTIONS.find((x) => x.id === TABS[i - 1]?.[0]);
            return (
              <div key={id} style={{ display: 'contents' }}>
                {s?.group && s.group !== prev?.group && <div className="subnav-group tiny muted">{s.group}</div>}
                <button className={`${tab === id ? 'on' : ''} ${s?.group ? 'sub' : ''}`} onClick={() => setTab(id)} aria-current={tab === id}>
                  {label}
                  {s && <span className="tiny muted num">{filled(s)}/{s.fields.length}</span>}
                </button>
              </div>
            );
          })}
        </nav>

        <div>
          {section && (
            <form className="panel panel-pad" onSubmit={(e) => { e.preventDefault(); save(); }}>
              <h2>{section.title}</h2>
              {section.note && <p className="small muted" style={{ marginTop: 4 }}>{section.note}</p>}
              <div className="form-grid" style={{ marginTop: 18 }}>
                {section.fields.map(([key, label, opt = {}]) => (
                  <label key={key} className={`field ${opt.wide ? 'field-wide' : ''}`}>
                    {label}
                    {opt.options ? (
                      <select value={profile[section.id]?.[key] || ''} onChange={set(section.id, key)}>
                        <option value="">Select…</option>
                        {opt.options.map((o) => <option key={o}>{o}</option>)}
                      </select>
                    ) : opt.textarea ? (
                      <>
                        <textarea rows={8} value={profile[section.id]?.[key] || ''} onChange={set(section.id, key)} placeholder={opt.hint || ''} />
                        <span className="hint">{(profile[section.id]?.[key] || '').length} characters</span>
                      </>
                    ) : (
                      <input type={opt.type || 'text'} value={profile[section.id]?.[key] || ''} onChange={set(section.id, key)} placeholder={opt.hint || ''} />
                    )}
                  </label>
                ))}
              </div>
              <div className="savebar">
                {msg && <span className={`small`} style={{ color: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.text}</span>}
                {dirty && !msg && <span className="small muted">Unsaved changes</span>}
                <button className="btn btn-primary" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save profile'}</button>
              </div>
            </form>
          )}

          {tab === 'documents' && <Documents profile={profile} setProfile={setProfile} onImported={(p) => { setProfile(p); save(p); }} />}
          {tab === 'notifications' && <NotificationSettings />}
        </div>
      </div>
    </div>
  );
}

function Documents({ profile, setProfile, onImported }) {
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [review, setReview] = useState(null);

  const upload = async (type, file) => {
    if (!file) return;
    setError('');
    const form = new FormData();
    form.append('file', file);
    try {
      const d = await api(`/profile/documents/${type}`, { method: 'POST', form });
      setProfile(d.profile);
    } catch (e) {
      setError(e.message);
    }
  };
  const removeDoc = async (type) => {
    const d = await api(`/profile/documents/${type}`, { method: 'DELETE' });
    setProfile(d.profile);
  };

  const runImport = async () => {
    setImporting(true);
    setError('');
    setReview(null);
    try {
      const d = await api('/profile/cv-import', { method: 'POST' });
      const rows = Object.entries(d.suggestions).map(([key, value]) => ({
        key, value, label: LABELS[key] || key, current: d.current[key] || '',
        use: !d.current[key], // pre-select only fields that are empty now
      }));
      setReview({ rows, note: d.note, usedAI: d.usedAI });
    } catch (e) {
      setError(e.message);
    } finally {
      setImporting(false);
    }
  };

  const apply = () => {
    const next = JSON.parse(JSON.stringify(profile));
    for (const r of review.rows.filter((x) => x.use)) {
      const [s, k] = r.key.split('.');
      next[s] = { ...(next[s] || {}), [k]: r.value };
    }
    onImported(next);
    setReview({ ...review, applied: review.rows.filter((x) => x.use).length });
  };

  const hasCv = !!profile.documents?.cv;

  return (
    <div className="stack">
      <section className="import">
        <span className="doc" style={{ border: 'none', padding: 0 }}><span className="icon-box"><Icon name="scan" /></span></span>
        <div style={{ flex: 1 }}>
          <h2>Import from your CV</h2>
          <p className="small muted" style={{ marginTop: 3 }}>
            The local AI reads your CV on this computer and suggests values for your profile. You choose what to keep.
          </p>
        </div>
        <button className="btn btn-primary" disabled={!hasCv || importing} onClick={runImport} title={hasCv ? '' : 'Upload your CV first'}>
          <Icon name="scan" /> {importing ? 'Reading your CV…' : 'Import from CV'}
        </button>
      </section>
      {!hasCv && <p className="small muted">Upload your CV below first (PDF or Word).</p>}
      {importing && <div className="notice notice-info"><Icon name="cpu" />Reading your CV. This takes about 30–60 seconds.</div>}
      {error && <div className="notice notice-error"><Icon name="alert" />{error}</div>}

      {review && (
        <section className="panel">
          <div className="panel-head">
            <h2>Review what was found</h2>
            <span className="small muted">{review.rows.length} values</span>
          </div>
          <div className="panel-pad" style={{ paddingTop: 8 }}>
            {review.note && <div className="notice notice-warn" style={{ marginBottom: 10 }}><Icon name="alert" />{review.note}</div>}
            {review.rows.length === 0 ? (
              <p className="muted">Nothing could be read from this CV.</p>
            ) : (
              <table className="review">
                <thead><tr><th style={{ width: 30 }}><span className="sr-only">Use</span></th><th>Field</th><th>From your CV</th><th>In your profile now</th></tr></thead>
                <tbody>
                  {review.rows.map((r, i) => (
                    <tr key={r.key}>
                      <td><input type="checkbox" checked={r.use} aria-label={`Use ${r.label}`}
                        onChange={(e) => setReview({ ...review, rows: review.rows.map((x, j) => (j === i ? { ...x, use: e.target.checked } : x)) })} /></td>
                      <td>{r.label}</td>
                      <td className="new">{r.value}</td>
                      <td className="old">{r.current || 'Empty'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14, alignItems: 'center' }}>
              {review.applied !== undefined && <span className="small" style={{ color: 'var(--green)' }}>{review.applied} values added to your profile and saved.</span>}
              <button className="btn btn-secondary" onClick={() => setReview(null)}>Close</button>
              {review.rows.length > 0 && review.applied === undefined && (
                <button className="btn btn-primary" onClick={apply}>Use {review.rows.filter((r) => r.use).length} selected values</button>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="panel panel-pad">
        <h2>Documents</h2>
        <p className="small muted" style={{ marginTop: 4 }}>PDF, Word, JPG or PNG up to 5 MB. Stored on this computer. The agent uploads them only after you allow it.</p>
        <div className="docs" style={{ marginTop: 16 }}>
          {DOCS.map(([type, label]) => {
            const d = profile.documents?.[type];
            return (
              <div key={type} className={`doc ${d ? 'has' : ''}`}>
                <span className="icon-box"><Icon name={d ? 'check' : 'file'} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong className="small" style={{ display: 'block' }}>{label}</strong>
                  <span className="tiny muted" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d ? d.originalName : 'Not uploaded'}</span>
                </div>
                <label className="btn btn-secondary btn-sm btn-file">
                  {d ? 'Replace' : 'Upload'}
                  <input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => upload(type, e.target.files[0])} />
                </label>
                {d && <button className="btn btn-quiet btn-sm btn-icon" aria-label={`Remove ${label}`} onClick={() => removeDoc(type)}><Icon name="trash" size={15} /></button>}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function NotificationSettings() {
  const [s, setS] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => { api('/notifications/settings').then(setS).catch(() => {}); }, []);
  if (!s) return <div className="empty">Loading…</div>;

  const toggle = async (on) => {
    const d = await api('/notifications/settings', { method: 'PUT', body: { emailNotifications: on } });
    setS(d);
  };
  const test = async () => {
    setMsg(null);
    try {
      await api('/notifications/test-email', { method: 'POST' });
      setMsg({ ok: true, text: 'Test email sent. Check your inbox.' });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
  };

  return (
    <section className="panel panel-pad stack" style={{ gap: 16 }}>
      <div>
        <h2>Notifications</h2>
        <p className="small muted" style={{ marginTop: 4 }}>The bell at the top always shows when the agent needs you, when a form is ready to submit, and when a tracked deadline is within 7 days.</p>
      </div>
      <label className="switch">
        <input type="checkbox" checked={!!s.settings?.emailNotifications} disabled={!s.emailAvailable} onChange={(e) => toggle(e.target.checked)} />
        <span><strong>Also send these by email</strong><br /><span className="small muted">To the email you signed up with.</span></span>
      </label>
      {!s.emailAvailable && (
        <div className="notice notice-info"><Icon name="mail" />
          <span className="small">Email isn’t set up on this computer yet. Add your Gmail SMTP details to the <code>.env</code> file (see README), then restart the server.</span>
        </div>
      )}
      {s.emailAvailable && <button className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={test}><Icon name="mail" /> Send a test email</button>}
      {msg && <div className={`notice ${msg.ok ? 'notice-ok' : 'notice-error'}`}><Icon name={msg.ok ? 'check' : 'alert'} />{msg.text}</div>}
    </section>
  );
}

const LABELS = {
  'personal.fullName': 'Full name', 'personal.firstName': 'First name', 'personal.lastName': 'Last name',
  'personal.fatherName': "Father's name", 'personal.gender': 'Gender', 'personal.dateOfBirth': 'Date of birth',
  'personal.email': 'Email', 'personal.phone': 'Phone', 'personal.cnic': 'CNIC', 'personal.nationality': 'Nationality',
  'address.street': 'Address', 'address.city': 'City', 'address.province': 'Province', 'address.country': 'Country',
  'education.lastDegree': 'Highest degree', 'education.institution': 'Institution', 'education.cgpa': 'CGPA',
  'job.currentTitle': 'Job title', 'job.experienceYears': 'Years of experience',
  'preferences.studyField': 'Field of study', 'preferences.jobKeywords': 'Job keywords',
};
