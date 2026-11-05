import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import ConsentDialog from '../components/ConsentDialog.jsx';

export const STAGES = [
  ['saved', 'Saved', 'var(--muted)'],
  ['in_progress', 'In progress', 'var(--sky-ink)'],
  ['ready', 'Ready to submit', 'var(--saffron)'],
  ['submitted', 'Submitted', 'var(--indigo)'],
  ['interview', 'Interview', 'var(--indigo-deep)'],
  ['accepted', 'Accepted', 'var(--green)'],
  ['rejected', 'Not selected', 'var(--red)'],
];
const LABEL = Object.fromEntries(STAGES.map(([k, l]) => [k, l]));
const COLOR = Object.fromEntries(STAGES.map(([k, , c]) => [k, c]));
// Board columns (some hold two stages; the card shows which)
const COLUMNS = [
  ['Saved', ['saved'], 'var(--muted)'],
  ['In progress', ['in_progress', 'ready'], 'var(--saffron)'],
  ['Submitted', ['submitted'], 'var(--indigo)'],
  ['Interview', ['interview'], 'var(--indigo-deep)'],
  ['Decision', ['accepted', 'rejected'], 'var(--green)'],
];

export default function Tracker() {
  const [tracks, setTracks] = useState(null);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  const [consentFor, setConsentFor] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    api('/tracker').then((d) => setTracks(d.tracks)).catch((e) => setError(e.message));
  }, []);

  const update = async (id, body) => {
    const d = await api(`/tracker/${id}`, { method: 'PATCH', body });
    setTracks((ts) => ts.map((t) => (t._id === id ? d.track : t)));
    if (open?._id === id) setOpen(d.track);
  };
  const remove = async (id) => {
    await api(`/tracker/${id}`, { method: 'DELETE' });
    setTracks((ts) => ts.filter((t) => t._id !== id));
    setOpen(null);
  };

  if (!tracks) return <div className="empty">{error || 'Loading tracker…'}</div>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Application tracker</h1>
          <p>Every opportunity you’re working on, from saved to decision. The agent moves cards to “In progress” and “Ready to submit” for you; you move them after you submit.</p>
        </div>
      </div>

      {tracks.length === 0 ? (
        <div className="panel empty">
          <Icon name="board" size={28} />
          <strong style={{ color: 'var(--ink)' }}>Nothing tracked yet</strong>
          <span>Save a scholarship or job, or apply with the agent, and it appears here.</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link to="/app/scholarships" className="btn btn-primary">Browse scholarships</Link>
            <Link to="/app/jobs" className="btn btn-secondary">Browse jobs</Link>
          </div>
        </div>
      ) : (
        <div className="board">
          {COLUMNS.map(([label, stages, color]) => {
            const items = tracks.filter((t) => stages.includes(t.stage));
            return (
              <section key={label} className="col" aria-label={label}>
                <div className="col-head">
                  <span><span className="dot" style={{ background: color }} />{label}</span>
                  <span className="muted num">{items.length}</span>
                </div>
                {items.map((t) => (
                  <button key={t._id} className="tcard" onClick={() => setOpen(t)}>
                    <span className="tag" style={{ alignSelf: 'flex-start' }}>
                      <Icon name={t.opportunity?.type === 'job' ? 'briefcase' : 'cap'} size={13} />
                      {t.opportunity?.type === 'job' ? 'Job' : 'Scholarship'}
                    </span>
                    <span className="t">{t.opportunity?.title || 'Removed opportunity'}</span>
                    {stages.length > 1 && (
                      <span className="tiny" style={{ color: COLOR[t.stage], fontWeight: 600 }}>{LABEL[t.stage]}</span>
                    )}
                    {t.deadline && <DeadlineTag date={t.deadline} />}
                    {t.notes && <span className="tiny muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.notes}</span>}
                  </button>
                ))}
              </section>
            );
          })}
        </div>
      )}

      {open && <Drawer t={open} onClose={() => setOpen(null)} onUpdate={update} onRemove={remove} onApply={() => setConsentFor(open.opportunity)} />}
      {consentFor && (
        <ConsentDialog opportunity={consentFor} onCancel={() => setConsentFor(null)} onStarted={(id) => navigate(`/app/applications/${id}`)} />
      )}
    </div>
  );
}

function DeadlineTag({ date }) {
  const days = Math.ceil((new Date(date) - Date.now()) / 86400000);
  const cls = days < 0 ? 'tag-red' : days <= 7 ? 'tag-saffron' : 'tag-sky';
  return (
    <span className={`tag ${cls}`} style={{ alignSelf: 'flex-start' }}>
      <Icon name="clock" size={13} />
      {days < 0 ? 'Deadline passed' : days === 0 ? 'Due today' : `Due in ${days} day${days === 1 ? '' : 's'}`}
    </span>
  );
}

function Drawer({ t, onClose, onUpdate, onRemove, onApply }) {
  const [notes, setNotes] = useState(t.notes || '');
  const [deadline, setDeadline] = useState(t.deadline ? t.deadline.slice(0, 10) : '');
  const [saved, setSaved] = useState(false);
  const o = t.opportunity || {};

  useEffect(() => {
    setNotes(t.notes || '');
    setDeadline(t.deadline ? t.deadline.slice(0, 10) : '');
  }, [t._id]);

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  const save = async () => {
    await onUpdate(t._id, { notes, deadline: deadline || null });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <>
      <div className="overlay" style={{ zIndex: 55, background: 'rgba(17,19,40,.25)' }} onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={o.title}>
        <div className="panel-head">
          <h2 style={{ fontSize: 16 }}>{o.title}</h2>
          <button className="btn btn-quiet btn-icon" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="drawer-body">
          <div className="small muted">{[o.org, o.location].filter(Boolean).join(', ')}</div>

          <label className="field">Stage
            <select value={t.stage} onChange={(e) => onUpdate(t._id, { stage: e.target.value })}>
              {STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="field">Deadline <span className="hint">You get a reminder 7 days before.</span>
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </label>
          <label className="field">Notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Referees asked, documents still needed, interview date…" />
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={save}>Save changes</button>
            {saved && <span className="small" style={{ color: 'var(--green)' }}>Changes saved</span>}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {o.status !== 'closed' && <button className="btn btn-secondary" onClick={onApply}><Icon name="bolt" /> Apply with agent</button>}
            {o.url && <a className="btn btn-secondary" href={o.url} target="_blank" rel="noreferrer"><Icon name="external" /> Open page</a>}
          </div>

          {t.runs?.length > 0 && (
            <div>
              <h3 style={{ marginBottom: 8 }}>Agent runs</h3>
              {t.runs.map((r) => (
                <Link key={r._id} to={`/app/applications/${r._id}`} className="list-row" style={{ padding: '8px 0' }}>
                  <Icon name="bolt" size={16} />
                  <span className="grow small">{new Date(r.createdAt).toLocaleString('en-GB')}</span>
                  <span className="tag">{r.status}</span>
                </Link>
              ))}
            </div>
          )}

          <div>
            <h3 style={{ marginBottom: 10 }}>History</h3>
            <ol className="timeline">
              {[...(t.history || [])].reverse().map((h, i) => (
                <li key={i}>
                  <strong>{LABEL[h.stage] || h.stage}</strong> <span className="muted">{h.note ? `${h.note}, ` : ''}{new Date(h.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                </li>
              ))}
            </ol>
          </div>

          <button className="btn btn-quiet" style={{ alignSelf: 'flex-start', color: 'var(--red)' }} onClick={() => onRemove(t._id)}>
            <Icon name="trash" /> Remove from tracker
          </button>
        </div>
      </aside>
    </>
  );
}
