import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import QuestionsForm from '../components/QuestionsForm.jsx';

const STATUS = {
  running: ['The agent is filling the form', 'running'],
  waiting: ['Waiting for you', 'waiting'],
  ready: ['Ready for you to submit', 'ready'],
  stopped: ['Stopped', 'stopped'],
  incomplete: ['Stopped before finishing', 'incomplete'],
  failed: ['Could not finish', 'failed'],
};
const ACTION = { fill: 'Typed', select: 'Chose', check: 'Ticked', upload: 'Uploaded', dropdown: 'Picked', click: 'Clicked', open: 'Opened' };

// agent notes are written for developers: say them in everyday words
const plain = (t) => t.replace(/\b(the )?offline AI\b/gi, 'ApplyMate').replace(/\bLLM\b/g, 'ApplyMate');

// "1793819991805-FrontPic.pdf" -> "FrontPic.pdf"
const fileName = (v = '') => v.replace(/^\d{10,}-/, '');

// Form questions carry hints and long instructions. Keep only the part a student needs to recognise it.
function short(label = '', max = 60) {
  let s = label.replace(/\s*\([^)]*\)/g, '').replace(/^Optional:\s*/i, '').trim();
  s = s.replace(/^Please upload\s+(?:(?:a|an|the|your)\s+)?/i, '').replace(/\s+(?:here|below)\b.*$/i, '');
  s = s.split(/(?<=[.?!])\s/)[0].replace(/[.:]$/, '').trim() || label;
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

const FIELD_ACTIONS = ['fill', 'select', 'check', 'upload', 'dropdown'];

// One page of the form: a one-line summary, answers hidden until the student opens it.
function PageRow({ step: s, sameTitle, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const fields = s.items.filter((it) => FIELD_ACTIONS.includes(it.action));
  const failed = fields.filter((it) => !it.ok).length;
  const files = fields.filter((it) => it.action === 'upload' && it.ok).length;
  const typed = fields.length - files - failed;
  const notes = s.items.filter((it) => it.note || it.pause || it.reached || (it.action === 'open'));
  const stop = s.items.find((it) => it.pause === 'ready-to-submit');
  const pause = s.items.find((it) => it.pause && it.pause !== 'ready-to-submit');
  const hasDetail = fields.length > 0 || notes.length > 0;

  const parts = [];
  if (typed) parts.push(`${typed} answer${typed > 1 ? 's' : ''}`);
  if (files) parts.push(`${files} file${files > 1 ? 's' : ''}`);
  const summary = s.nav ? (s.items.some((it) => it.reached) ? 'Form found' : 'Searching…') : parts.join(' · ') || 'Nothing new to fill';
  const state = failed ? 'bad' : pause ? 'warn' : (fields.length || s.nav || stop) ? 'ok' : 'idle';

  return (
    <li className={`pg-row ${open ? 'open' : ''}`}>
      <button className="pg-head" onClick={() => hasDetail && setOpen(!open)} aria-expanded={open} disabled={!hasDetail}>
        <span className={`pg-dot ${state}`}>
          <Icon name={state === 'bad' ? 'x' : state === 'warn' ? 'pause' : s.nav ? 'globe' : 'check'} size={13} />
        </span>
        <span className="pg-name">
          {s.nav ? s.title : `Page ${s.n}`}
          {!s.nav && !sameTitle && <span className="muted"> · {s.title}</span>}
        </span>
        <span className={`pg-sum ${state === 'idle' ? 'muted' : ''}`}>
          {failed > 0 && <span className="tag-bad">{failed} not filled</span>}
          {summary}
        </span>
        {hasDetail && <Icon name="chevron" size={15} className="pg-chev" />}
      </button>
      {open && (
        <div className="pg-body">
          {notes.map((it, j) => (
            <p key={`n${j}`} className={`pg-note ${it.pause && it.pause !== 'ready-to-submit' ? 'warn' : ''}`}>
              {it.reached ? <>Found {it.note.replace(/^Reached /, '')}</> : it.action === 'open' ? <>Opened “{it.label}”</> : it.note}
            </p>
          ))}
          {fields.length > 0 && (
            <dl className="pg-answers">
              {fields.map((it, j) => (
                <div key={j} className={it.ok ? '' : 'bad'}>
                  <dt title={it.label}>{short(it.label)}</dt>
                  <dd>
                    {it.action === 'upload' && <Icon name="file" size={13} />}
                    {it.ok ? (it.action === 'upload' ? fileName(it.value) : it.value || '✓') : <span className="err">{it.error || 'Could not fill'}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </li>
  );
}

const shortUrl = (u) => { try { const x = new URL(u); return x.host + x.pathname; } catch { return u || ''; } };

// Turn the agent's log lines into steps with a checklist of fields
function parseLog(lines = []) {
  const steps = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const step = line.match(/STEP (\d+)\s+\|\s+(.*?)\s+\|\s+(\d+)\/(\d+) fields filled/);
    if (step) {
      cur = { n: +step[1], title: step[2], filled: +step[3], total: +step[4], items: [] };
      steps.push(cur);
      continue;
    }
    if (/SUMMARY/.test(line)) { cur = null; continue; }
    if (/FINDING THE APPLICATION FORM/.test(line)) {
      cur = { nav: true, title: 'Finding the application form', items: [] };
      steps.push(cur);
      continue;
    }
    if (!cur) continue;
    const follow = line.match(/^\s+🧭 Following “(.*?)”(?: → (\S+))?/);
    if (follow) { cur.items.push({ ok: true, action: 'open', label: follow[1], value: shortUrl(follow[2]) }); continue; }
    const reached = line.match(/^\s+✅ ((?:Reached|You opened) .*)$/);
    if (reached) { cur.items.push({ reached: true, note: reached[1] }); continue; }
    const act = line.match(/^\s+(✅|❌)\s+(\w+)\s+(.*?)(?:\s+→\s+(.*))?$/);
    if (act) {
      const [label, ...rest] = act[3].split(' = ');
      cur.items.push({ ok: act[1] === '✅', action: act[2], label, value: rest.join(' = '), error: act[4] });
      continue;
    }
    const note = line.match(/^\s+(ℹ|⏭|🧠|🍪|⚠|📍)\s+(.*)$/);
    if (note) cur.items.push({ note: plain(note[2]) });
    const pause = line.match(/^⏸\s+([A-Z-]+):\s+(.*)$/);
    if (pause) cur.items.push({ pause: pause[1].toLowerCase(), note: plain(pause[2]) });
  }
  return steps;
}

export default function ApplyRun() {
  const { id } = useParams();
  const outlet = useOutletContext() || {};
  const [app, setApp] = useState(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [openAll, setOpenAll] = useState(null);
  const logRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    let timer;
    let alive = true;
    const tick = async () => {
      try {
        const d = await api(`/applications/${id}`);
        if (!alive) return;
        setApp((prev) => {
          // refresh the bell when the run changes state (needs you / ready / stopped)
          if (prev && prev.status !== d.application.status) outlet.refreshNotifications?.();
          return d.application;
        });
        if (['running', 'waiting'].includes(d.application.status)) timer = setTimeout(tick, 1000);
      } catch (e) {
        setError(e.message);
      }
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [id, sending]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [app?.log?.length, showLog]);

  const [saved, setSaved] = useState([]);
  useEffect(() => { api('/profile').then((d) => setSaved(d.profile?.answers || [])).catch(() => {}); }, [app?.pause?.reason]);

  const respond = async (answer, answers) => {
    setSending(true);
    try {
      await api(`/applications/${id}/respond`, { method: 'POST', body: { answer, ...(answers ? { answers } : {}) } });
      outlet.refreshNotifications?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  // start the same application again (the student already gave permission for it)
  const retry = async () => {
    setSending(true);
    setError('');
    try {
      const d = await api('/applications', { method: 'POST', body: { opportunityId: app.opportunity?._id, consent: true, ...(app.formUrl ? { formUrl: app.formUrl } : {}) } });
      navigate(`/app/applications/${d.id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  if (!app) return <div className="empty">{error || 'Loading…'}</div>;

  const [label, cls] = STATUS[app.status] || [app.status, 'stopped'];
  const o = app.opportunity || {};
  const steps = parseLog(app.log);
  const all = steps.flatMap((s) => s.items);
  const done = all.filter((i) => i.ok && !['click', 'open'].includes(i.action)).length;
  const scans = steps.filter((s) => !s.nav).length;
  const problems = all.filter((i) => i.ok === false).length;
  const summary = app.result?.summary;
  const live = ['running', 'waiting'].includes(app.status);
  const pages = steps.filter((s) => !s.nav);
  const last = pages[pages.length - 1];
  const pagesTotal = pages.length;
  // every page usually has the same portal title: say it once, not on every row
  const sharedTitle = pages.length > 1 && pages.every((p) => p.title === pages[0].title) ? pages[0].title : null;
  const attention = all.filter((i) => i.ok === false || (i.pause && i.pause !== 'ready-to-submit'));
  const uploads = all.filter((i) => i.ok && i.action === 'upload' && i.value);
  const files = Object.entries(uploads.reduce((m, u) => {
    const f = fileName(u.value);
    (m[f] = m[f] || []).push(u.label);
    return m;
  }, {}));

  return (
    <div>
      <Link to="/app/activity" className="small" style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginBottom: 10 }}>
        <Icon name="chevron" size={14} className="flip" /> Agent activity
      </Link>
      <div className="page-head" style={{ alignItems: 'center' }}>
        <div>
          <h1>{o.title}</h1>
          <p>{[o.org, o.location].filter(Boolean).join(', ')}</p>
        </div>
        <span className={`run-status ${cls}`} role="status">
          {live && <span className="pulse" />} {label}
        </span>
      </div>

      <RunStages app={app} steps={steps} />
      {live && pagesTotal > 0 && (
        <div aria-label="Progress on the current page">
          <div className="run-progress-label"><span>Step {last.n}: {last.title}</span><span className="num">{last.filled} of {last.total} answers filled</span></div>
          <div className="run-progress"><span style={{ width: `${Math.round((last.filled / Math.max(1, last.total)) * 100)}%` }} /></div>
        </div>
      )}

      <section className="panel stats-row" aria-label="Run summary">
        <div><strong>{done}</strong><span>fields filled</span></div>
        <div><strong>{problems}</strong><span>problems</span></div>
        <div><strong>{scans}</strong><span>pages read</span></div>
        <div><strong>{summary ? `${summary.totalSeconds}s` : live ? '…' : '–'}</strong><span>total time</span></div>
      </section>

      {app.status === 'waiting' && app.pause && (
        <section className="your-turn" aria-live="polite">
          <h2><Icon name={app.pause.kind === 'confirm' ? 'shield' : 'pause'} />
            {app.pause.reason === 'account' ? 'Your account on this portal' : app.pause.reason === 'create-account' ? 'Create your account' : app.pause.reason === 'verify-email' ? 'Confirm your email' : app.pause.kind === 'confirm' ? 'Your permission is needed' : app.pause.kind === 'questions' ? 'A few questions for you' : 'Your turn'}</h2>
          <p className="msg">{app.pause.message}</p>
          {app.pause.kind === 'questions' && app.pause.questions?.length ? (
            <QuestionsForm key={app.pause.message} questions={app.pause.questions} saved={saved} busy={sending}
              submitLabel="Save answers and continue" onSubmit={(answers) => respond(true, answers)}
              onCancel={() => respond(false)} cancelLabel="Stop the agent" />
          ) : app.pause.kind === 'confirm' ? (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn btn-warn" disabled={sending} onClick={() => respond(true)}>
                <Icon name={app.pause.reason === 'account' ? 'user' : 'upload'} /> {app.pause.yes || 'Yes, upload my documents'}</button>
              <button className="btn btn-secondary" disabled={sending} onClick={() => respond(false)}>{app.pause.no || 'No, I’ll upload them myself'}</button>
            </div>
          ) : (
            <>
              <p className="small" style={{ color: 'var(--saffron-ink)' }}>Do this in the browser window the agent opened, then come back here.</p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-warn" disabled={sending} onClick={() => respond(true)}><Icon name="check" /> I’ve done it, continue</button>
                <button className="btn btn-secondary" disabled={sending} onClick={() => respond(false)}>Stop the agent</button>
              </div>
            </>
          )}
        </section>
      )}

      {app.status === 'ready' && (
        <section className="done-box">
          <h2><Icon name="check" /> The form is filled</h2>
          <p>{app.result?.message}</p>
          <p className="small muted">ApplyMate never submits for you. Check every field in the browser window, then press the submit button yourself, and move this application to “Submitted” in your tracker.</p>
          <div><Link to="/app/tracker" className="btn btn-secondary btn-sm"><Icon name="board" size={15} /> Open tracker</Link></div>
        </section>
      )}

      {['stopped', 'incomplete', 'failed'].includes(app.status) && app.result?.message && (
        <div className="notice notice-warn pre" style={{ marginBottom: 18 }}>
          <Icon name="alert" />
          <div className="stack" style={{ gap: 10 }}>
            <span>{app.result.message}</span>
            {app.status === 'failed' && (
              <div><button className="btn btn-primary btn-sm" disabled={sending} onClick={retry}><Icon name="refresh" size={15} /> {sending ? 'Starting…' : 'Try again'}</button></div>
            )}
          </div>
        </div>
      )}
      {error && <div className="notice notice-error" style={{ marginBottom: 18 }}><Icon name="alert" />{error}</div>}

      <div className="run-grid">
        <section className="panel">
          <div className="panel-head">
            <div style={{ minWidth: 0 }}>
              <h2>What the agent did</h2>
              {sharedTitle && <div className="small muted">{pages.length} pages on {sharedTitle}</div>}
            </div>
            {pages.length > 1 ? (
              <button className="linkish" onClick={() => setOpenAll(openAll ? null : true)}>{openAll ? 'Collapse all' : 'Show all answers'}</button>
            ) : live && <span className="small muted">Updates live</span>}
          </div>
          {steps.length === 0 && !live ? (
            <div className="empty small"><Icon name="info" size={22} />The agent stopped before it opened the scholarship’s website, so nothing was filled.</div>
          ) : steps.length === 0 ? (
            <div className="empty small"><span className="pulse" style={{ color: 'var(--indigo)' }} />Getting ready and opening the scholarship’s website… The first run can take about a minute.</div>
          ) : (
            <ol className="run-pages">
              {steps.map((s, i) => (
                <PageRow key={`${i}-${openAll}`} step={s} sameTitle={s.title === sharedTitle}
                  defaultOpen={openAll || (live && i === steps.length - 1) || s.items.some((it) => it.ok === false || (it.pause && it.pause !== 'ready-to-submit'))} />
              ))}
            </ol>
          )}
        </section>

        <aside className="run-side">
          <div className="panel panel-pad">
            <h3 className="side-h"><Icon name="alert" size={16} /> Check before you submit</h3>
            {attention.length === 0 ? (
              <p className="side-ok"><Icon name="check" size={16} /> {live ? 'No problems so far.' : 'No problems found. Still give every page a quick look.'}</p>
            ) : (
              <ul className="side-list">
                {attention.map((it, i) => (
                  <li key={i} className={it.ok === false ? 'bad' : 'warn'}>
                    <Icon name={it.ok === false ? 'x' : 'pause'} size={14} />
                    <span>{it.ok === false ? <><b>{short(it.label)}</b> could not be filled</> : it.note}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {files.length > 0 && (
            <div className="panel panel-pad">
              <h3 className="side-h"><Icon name="file" size={16} /> Files uploaded <span className="count">{uploads.length}</span></h3>
              <ul className="file-list">
                {files.map(([name, uses]) => (
                  <li key={name}>
                    <span className="file-ico"><Icon name="file" size={15} /></span>
                    <div>
                      <div className="file-name">{name}</div>
                      <div className="small muted">{uses.length === 1 ? short(uses[0], 48) : `Used for ${uses.length} questions`}</div>
                    </div>
                  </li>
                ))}
              </ul>
              {files.length < uploads.length && (
                <p className="small" style={{ color: 'var(--saffron-ink)', marginTop: 10 }}>The same file was used for several questions. Make sure each one is the right document.</p>
              )}
            </div>
          )}

          <details className="panel run-how">
            <summary>
              <span className="run-how-ico"><Icon name="info" size={16} /></span>
              How this run works
              <Icon name="chevron" size={15} className="run-how-chev" />
            </summary>
            <ul>
              <li><span className="t-indigo"><Icon name="globe" size={15} /></span>Finds the application form by itself</li>
              <li><span className="t-green"><Icon name="check" size={15} /></span>Fills each question from your profile</li>
              <li><span className="t-saffron"><Icon name="pause" size={15} /></span>Asks you for essays, robot checks and missing details</li>
              <li><span className="t-sky"><Icon name="shield" size={15} /></span>Never submits. You press submit yourself</li>
            </ul>
          </details>

          <div>
            <button className="linkish small" onClick={() => setShowLog(!showLog)} aria-expanded={showLog}>
              {showLog ? 'Hide technical log' : 'Show technical log'}
            </button>
            {showLog && <pre className="log" ref={logRef} style={{ marginTop: 8 }}>{(app.log || []).join('\n')}</pre>}
          </div>
        </aside>
      </div>
    </div>
  );
}

// Four plain stages so the student sees at a glance where the agent is.
function RunStages({ app, steps }) {
  const log = (app.log || []).join('\n');
  const pageCount = steps.filter((s) => !s.nav).length;
  const account = /\b(LOGIN|CREATE-ACCOUNT|VERIFY-EMAIL|ACCOUNT)\b/.test(log) || app.pause?.reason === 'login';
  let now = 0;
  if (pageCount > 0 || account) now = 1;
  if (pageCount > 0) now = 2;
  if (app.status === 'ready') now = 4;
  const stages = ['Find the real form', account ? 'Your account' : 'Open the form', 'Fill every page', 'Ready for you'];
  return (
    <div className="run-stages" aria-label="Run stages">
      {stages.map((t, i) => {
        const cls = i < now ? 'done' : i === now ? 'now' : '';
        return (
          <div key={t} className={`run-stage ${cls}`}>
            <span className="dot">{i < now ? <Icon name="check" size={14} /> : i + 1}</span>{t}
          </div>
        );
      })}
    </div>
  );
}
