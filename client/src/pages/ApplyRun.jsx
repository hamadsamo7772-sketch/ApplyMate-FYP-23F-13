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

      <section className="panel stats-row" aria-label="Run summary">
        <div><strong>{done}</strong><span>fields filled</span></div>
        <div><strong>{problems}</strong><span>problems</span></div>
        <div><strong>{scans}</strong><span>pages read</span></div>
        <div><strong>{summary ? `${summary.totalSeconds}s` : live ? '…' : '–'}</strong><span>total time</span></div>
      </section>

      {app.status === 'waiting' && app.pause && (
        <section className="your-turn" aria-live="polite">
          <h2><Icon name={app.pause.kind === 'confirm' ? 'shield' : 'pause'} />
            {app.pause.kind === 'confirm' ? 'Your permission is needed' : app.pause.kind === 'questions' ? 'A few questions for you' : 'Your turn'}</h2>
          <p className="msg">{app.pause.message}</p>
          {app.pause.kind === 'questions' && app.pause.questions?.length ? (
            <QuestionsForm key={app.pause.message} questions={app.pause.questions} saved={saved} busy={sending}
              submitLabel="Save answers and continue" onSubmit={(answers) => respond(true, answers)}
              onCancel={() => respond(false)} cancelLabel="Stop the agent" />
          ) : app.pause.kind === 'confirm' ? (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn btn-warn" disabled={sending} onClick={() => respond(true)}><Icon name="upload" /> Yes, upload my documents</button>
              <button className="btn btn-secondary" disabled={sending} onClick={() => respond(false)}>No, I’ll upload them myself</button>
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
            <h2>What the agent did</h2>
            {live && <span className="small muted">Updates live</span>}
          </div>
          {steps.length === 0 && !live ? (
            <div className="empty small"><Icon name="info" size={22} />The agent stopped before it opened the scholarship’s website, so nothing was filled.</div>
          ) : steps.length === 0 ? (
            <div className="empty small"><span className="pulse" style={{ color: 'var(--indigo)' }} />Getting ready and opening the scholarship’s website… The first run can take about a minute.</div>
          ) : (
            <ol className="steps">
              {steps.map((s, i) => (
                <li key={i} className="step">
                  <div className="step-title">
                    <span>{s.nav ? <><Icon name="search" size={14} /> {s.title}</> : `Page ${s.n}: ${s.title}`}</span>
                    {!s.nav && <span className="muted small num">{s.filled}/{s.total} filled</span>}
                  </div>
                  <ul className="fields">
                    {s.items.length === 0 && <li><span className="info">·</span><span /><span className="muted">Nothing to fill on this page</span></li>}
                    {s.items.map((it, j) => it.reached ? (
                      <li key={j}><span className="ok"><Icon name="check" size={15} /></span><span className="act">Found</span><span className="val">{it.note.replace(/^Reached /, '')}</span></li>
                    ) : it.note || it.pause ? (
                      <li key={j}>
                        <span className={it.pause === 'ready-to-submit' ? 'ok' : it.pause ? '' : 'info'} style={it.pause && it.pause !== 'ready-to-submit' ? { color: 'var(--saffron-ink)' } : undefined}>
                          <Icon name={it.pause === 'ready-to-submit' ? 'shield' : it.pause ? 'pause' : 'info'} size={14} />
                        </span>
                        <span className="act">{it.pause === 'ready-to-submit' ? 'Stopped' : it.pause ? 'Paused' : 'Note'}</span>
                        <span className={`val ${it.pause ? '' : 'muted'}`}>{it.note}</span>
                      </li>
                    ) : (
                      <li key={j}>
                        <span className={it.ok ? 'ok' : 'bad'}><Icon name={it.ok ? 'check' : 'x'} size={15} /></span>
                        <span className="act">{ACTION[it.action] || it.action}</span>
                        <span className="val">
                          {it.label}{it.value && <> <span className="muted">→</span> <b>{it.value}</b></>}
                          {it.error && <div className="small" style={{ color: 'var(--red)' }}>{it.error}</div>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="stack" style={{ gap: 12 }}>
          <div className="panel panel-pad">
            <h3 style={{ marginBottom: 8 }}>How this run works</h3>
            <ul className="checklist small">
              <li><Icon name="check" /> Finds the application form on the scholarship’s website by itself.</li>
              <li><Icon name="check" /> Reads each question and fills in the answer from your profile.</li>
              <li><Icon name="check" /> Looks at the page again after every answer, so questions that appear later are filled too.</li>
              <li><Icon name="pause" /> Asks you to step in for essays, “I’m not a robot” checks, missing details and file uploads.</li>
              <li><Icon name="shield" /> Never sends your application. You check it and press submit yourself.</li>
            </ul>
          </div>
          <div>
            <button className="linkish" onClick={() => setShowLog(!showLog)} aria-expanded={showLog}>
              {showLog ? 'Hide full details' : 'Show full details (for the ApplyMate team)'}
            </button>
            {showLog && <pre className="log" ref={logRef} style={{ marginTop: 8 }}>{(app.log || []).join('\n')}</pre>}
          </div>
        </section>
      </div>
    </div>
  );
}
