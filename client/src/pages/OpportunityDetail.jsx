// One scholarship or job: what it is, who can apply, what to prepare, and how the agent applies.
// Scholarship details are read from the programme's own website by the server (scrapers/details.js).
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import ConsentDialog from '../components/ConsentDialog.jsx';
import QuestionsForm from '../components/QuestionsForm.jsx';
import { FORM_CHECK } from './Opportunities.jsx';

// documents a programme lists -> the document types saved in the profile
const DOC_MATCH = [
  [/curriculum|\bcv\b|résumé|resume/i, 'cv', 'CV'],
  [/transcript|marks? sheet|records/i, 'transcript', 'Transcript'],
  [/degree|diploma/i, 'degree', 'Degree certificate'],
  [/passport/i, 'passport', 'Passport copy'],
  [/photo|picture/i, 'photo', 'Photo'],
  [/language|ielts|toefl|english|german/i, 'languageCert', 'Language certificate'],
  [/motivation|statement of purpose|personal statement/i, 'motivationLetter', 'Motivation letter'],
  [/cnic|national id/i, 'cnicCopy', 'CNIC copy'],
];
// profile details almost every application form asks for
const BASICS = [
  ['personal', 'nationality', 'Nationality'], ['personal', 'gender', 'Gender'], ['personal', 'dateOfBirth', 'Date of birth'],
  ['personal', 'phone', 'Phone'], ['personal', 'placeOfBirth', 'Place of birth'], ['address', 'country', 'Country of residence'],
  ['address', 'city', 'City'], ['address', 'postalCode', 'Postal code'], ['languages', 'motherTongue', 'Mother tongue'],
  ['languages', 'english', 'English level'],
];

function Readiness({ o, profile, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [editAll, setEditAll] = useState(false);
  if (!profile) return null;
  const docs = [];
  for (const d of o.documents || []) {
    const m = DOC_MATCH.find(([re]) => re.test(d));
    if (m && !docs.some((x) => x.type === m[1])) docs.push({ type: m[1], name: m[2], have: !!profile.documents?.[m[1]] });
    else if (!m) docs.push({ type: '', name: d, have: null });
  }
  const basics = BASICS.filter(([s, k]) => !profile[s]?.[k]).map(([, , label]) => label);
  const norm = (x) => String(x || '').toLowerCase().replace(/\*/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 160);
  const answered = new Set((profile.answers || []).filter((a) => a.value || a.hasFile).map((a) => a.q));
  const qs = (o.formQuestions || []);
  const open = qs.filter((q) => !answered.has(norm(q.label)));
  const missingDocs = docs.filter((d) => d.have === false);
  const ready = !missingDocs.length && !basics.length && !open.filter((q) => q.required).length;

  const save = async (answers) => {
    setBusy(true);
    try {
      const d = await api('/profile/answers', { method: 'POST', body: { answers } });
      onSaved(d.profile); setDone('Saved. The agent will use these answers on the form.');
    } finally { setBusy(false); }
  };

  return (
    <section className="panel panel-pad detail-section readiness">
      <h2><Icon name={ready ? 'check' : 'alert'} size={18} /> Before you apply {ready ? ': you have everything the agent needs' : ''}</h2>
      {!ready && <p className="small muted">Get these ready first, so the agent can fill the whole form without stopping.</p>}
      {docs.length > 0 && (
        <ul className="ready-list">
          {docs.map((d) => (
            <li key={d.name} className={d.have ? 'ok' : d.have === false ? 'missing' : ''}>
              <Icon name={d.have ? 'check' : d.have === false ? 'x' : 'file'} size={14} />
              {d.name}{d.have === false && <> · <Link to="/app/profile">upload in Profile → Documents</Link></>}
              {d.have === null && <span className="tiny muted"> (prepare it yourself; the form will ask for it)</span>}
            </li>
          ))}
        </ul>
      )}
      {basics.length > 0 && (
        <p className="small">Missing in your profile: <b>{basics.join(', ')}</b> · <Link to="/app/profile">complete your profile</Link></p>
      )}
      {qs.length > 0 && (
        <>
          <h3 style={{ marginTop: 12 }}>What this form will ask you <span className="tiny muted">({qs.length - open.length} of {qs.length} ready)</span></h3>
          <p className="small muted">Answer these once here and the agent fills them into the form for you. Your answers are saved in your profile, so other forms can use them too.</p>
          {open.length > 0 || editAll ? (
            <QuestionsForm key={(editAll ? qs : open).map((q) => q.label).join('|')} questions={editAll ? qs : open} saved={profile.answers || []} busy={busy}
              onSubmit={async (a) => { await save(a); setEditAll(false); }} submitLabel="Save my answers" />
          ) : <p className="small"><Icon name="check" size={14} /> All answered.</p>}
          {qs.length > open.length && !editAll && <button className="linkish tiny" onClick={() => setEditAll(true)}>Change my answers</button>}
          {done && <p className="small" style={{ color: 'var(--green)' }}>{done}</p>}
        </>
      )}
    </section>
  );
}

const STATUS = { open: ['Applications open', 'tag-green'], upcoming: ['Opens soon', 'tag-sky'], closed: ['Closed this cycle', ''], varies: ['Deadline per course', 'tag-saffron'] };
const SOURCE = { demo: 'Demo portal', official: 'Official programme', erasmus: 'Erasmus Mundus', rozee: 'Rozee.pk', link: 'Added by link' };

const uniq = (...lists) => [...new Set(lists.flat().filter(Boolean).map((s) => s.trim()))];

function Section({ icon, title, items, note }) {
  if (!items?.length) return null;
  return (
    <section className="panel panel-pad detail-section">
      <h2><Icon name={icon} size={18} /> {title}</h2>
      <ul>{items.map((t) => <li key={t}>{t}</li>)}</ul>
      {note && <p className="tiny muted" style={{ marginTop: 8 }}>{note}</p>}
    </section>
  );
}

export default function OpportunityDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [o, setO] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [consent, setConsent] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState(null);

  const load = (fresh) =>
    api(`/opportunities/${id}${fresh ? '?fresh=1' : ''}`).then((d) => setO(d.opportunity)).catch((e) => setError(e.message));

  useEffect(() => {
    setO(null);
    load();
    api('/profile').then((d) => setProfile(d.profile)).catch(() => {});
    api('/tracker').then((t) => setSaved(t.tracks.some((x) => x.opportunity?._id === id))).catch(() => {});
  }, [id]);

  if (error) return <div className="notice notice-error"><Icon name="alert" />{error}</div>;
  if (!o) {
    return (
      <div className="empty">
        <span className="pulse" style={{ color: 'var(--indigo)' }} />
        Reading the programme’s website for requirements and deadlines…
      </div>
    );
  }

  const d = o.details || {};
  const [statusLabel, statusCls] = STATUS[o.status] || [];
  const closed = o.status === 'closed';
  const isJob = o.type === 'job';
  const fromSite = d.pages?.length ? `Read from ${new URL(d.pages[0]).hostname.replace(/^www\./, '')} on ${new Date(o.detailsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.` : '';

  const requirements = uniq(o.eligibility || [], d.requirements || []);
  const documents = uniq(o.documents || [], d.documents || []);
  const deadlines = uniq(o.deadline ? [o.deadline] : [], d.deadlines || []);
  const funding = uniq(o.covers ? [o.covers] : [], d.scholarship || []);
  const howTo = uniq(o.howToApply || [], d.howToApply || []);

  const save = async () => {
    if (saved) return navigate('/app/tracker');
    await api('/tracker', { method: 'POST', body: { opportunityId: o._id } });
    setSaved(true);
  };

  return (
    <div className="detail">
      <Link to={isJob ? '/app/jobs' : '/app/scholarships'} className="small back-link">
        <Icon name="chevron" size={14} className="flip" /> {isJob ? 'Jobs' : 'Scholarships'}
      </Link>

      <header className="panel detail-head">
        <div className="detail-head-main">
          <div className="opp-top">
            <span className={`tag ${o.source === 'demo' ? 'tag-saffron' : 'tag-indigo'}`}>{SOURCE[o.source] || o.source}</span>
            {statusLabel && <span className={`tag ${statusCls}`}>{statusLabel}</span>}
            {FORM_CHECK[o.formCheck?.result] && (
              <span className={`tag ${FORM_CHECK[o.formCheck.result][1]}`}
                title={`Checked on ${new Date(o.formCheck.checkedAt).toLocaleDateString('en-GB')}`}>
                {FORM_CHECK[o.formCheck.result][0]}
              </span>
            )}
          </div>
          <h1>{o.title}</h1>
          <div className="opp-meta">
            {o.org && <span><Icon name={isJob ? 'briefcase' : 'cap'} size={15} />{o.org}</span>}
            {o.location && <span><Icon name="globe" size={15} />{o.location}</span>}
            {o.level && <span>{o.level}</span>}
            {o.salary && <span>{o.salary}</span>}
          </div>
          {(d.summary || o.description) && <p className="detail-summary">{d.summary || o.description}</p>}
          {o.statusNote && <p className="small muted">{o.statusNote}</p>}
          {o.formCheck?.checkedAt && o.formCheck.result !== 'reachable' && (
            <p className="small muted">
              {o.formCheck.result === 'sign-in'
                ? `Checked on ${new Date(o.formCheck.checkedAt).toLocaleDateString('en-GB')}: you will need to sign in to the scholarship’s website first. The agent opens the sign-in page and waits while you type your password.`
                : `Checked on ${new Date(o.formCheck.checkedAt).toLocaleDateString('en-GB')}: the agent could not find the form by itself yet. You can still start it; if it gets stuck, it will ask you to open the form in the browser window.`}
            </p>
          )}
          {o.match.suitable === false && (
            <div className="not-suitable small"><Icon name="info" size={15} /> Not suitable for your profile: {o.match.blockers.join('; ')}</div>
          )}
        </div>
        <div className="detail-fit">
          <strong className={o.match.score >= 70 ? 'score-high' : o.match.score >= 40 ? 'score-mid' : 'score-low'}>{o.match.score}%</strong>
          <span>fit for you</span>
          <ul>{o.match.reasons.slice(0, 4).map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      </header>

      <div className="detail-grid">
        <div className="stack" style={{ gap: 14 }}>
          {!isJob && <Readiness o={o} profile={profile} onSaved={setProfile} />}
          <Section icon="check" title="Requirements and eligibility" items={requirements} />
          <Section icon="file" title="Documents to prepare" items={documents}
            note="ApplyMate uploads the documents saved in your profile, and asks you first on real websites." />
          <Section icon="clock" title="Dates and deadlines" items={deadlines} />
          <Section icon="cap" title="Funding" items={funding} />
          <Section icon="activity" title="How to apply" items={howTo} />
          {!requirements.length && !documents.length && !d.summary && !isJob && (
            <div className="notice notice-warn"><Icon name="alert" />
              {d.error || 'The programme’s website did not list requirements in a form ApplyMate could read.'} Open the official page for full details.
            </div>
          )}
          {isJob && o.description && <section className="panel panel-pad"><h2>About the job</h2><p style={{ marginTop: 8 }}>{o.description}</p></section>}
        </div>

        <aside className="stack detail-side" style={{ gap: 12 }}>
          <div className="panel panel-pad apply-box">
            <h2>Apply with the agent</h2>
            <p className="small muted">
              {o.source === 'demo'
                ? 'The agent opens the demo form and fills it from your profile.'
                : 'The agent opens the official website, finds the application form by itself and fills it from your profile. It asks you only for passwords, codes, “I’m not a robot” checks, essays and the final submit.'}
            </p>
            <button className="btn btn-primary" onClick={() => setConsent(true)}>
              <Icon name="bolt" /> Apply with agent
            </button>
            {closed && <p className="tiny" style={{ color: 'var(--saffron-ink)' }}>Applications are closed this cycle. The portal may not accept a new application until the next call opens.</p>}
            <button className="btn btn-secondary" onClick={save}>
              <Icon name={saved ? 'bookmarkFilled' : 'bookmark'} /> {saved ? 'In tracker' : 'Save to tracker'}
            </button>
            <a className="btn btn-quiet btn-sm" href={o.url} target="_blank" rel="noreferrer"><Icon name="external" size={15} /> Official page</a>
          </div>

          {d.applyLinks?.length > 0 && (
            <div className="panel panel-pad">
              <h3 style={{ marginBottom: 6 }}>Application links found</h3>
              <ul className="link-list">
                {d.applyLinks.slice(0, 4).map((l) => <li key={l.href}><a href={l.href} target="_blank" rel="noreferrer">{l.text}</a></li>)}
              </ul>
            </div>
          )}

          {!isJob && o.source !== 'demo' && (
            <p className="tiny muted">
              {fromSite || (o.verified ? `Programme facts checked ${o.verified}.` : '')} Always confirm dates on the official page.{' '}
              <button className="linkish tiny" disabled={refreshing} onClick={async () => { setRefreshing(true); await load(true); setRefreshing(false); }}>
                {refreshing ? 'Reading again…' : 'Read the website again'}
              </button>
            </p>
          )}
        </aside>
      </div>

      {consent && (
        <ConsentDialog opportunity={o} onCancel={() => setConsent(false)} onStarted={(appId) => navigate(`/app/applications/${appId}`)} />
      )}
    </div>
  );
}
