import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import ConsentDialog from '../components/ConsentDialog.jsx';

const SOURCE = { demo: 'Demo portal', official: 'Official programme', erasmus: 'Erasmus Mundus', rozee: 'Rozee.pk', link: 'Added by link' };
const STATUS = { open: ['Applications open', 'tag-green'], upcoming: ['Opens soon', 'tag-sky'], closed: ['Closed this cycle', ''], varies: ['Deadline per course', 'tag-saffron'] };

// result of "npm run check-forms" (dry run of the agent's navigator)
export const FORM_CHECK = {
  reachable: ['Form reachable', 'tag-green'],
  'sign-in': ['Sign-in needed first', 'tag-sky'],
  'not-found': ['Form not found yet', 'tag-saffron'],
};

const time = (d) => (d ? new Date(d).getTime() : Infinity);
const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

// the scholarship board: open now / opening soon / deadline passed
function columns(list) {
  const demoFirst = (a, b) => (a.source === 'demo' ? -1 : b.source === 'demo' ? 1 : 0);
  return [
    ['open', 'Open now', list.filter((o) => o.status === 'open' || o.status === 'varies')
      .sort((a, b) => demoFirst(a, b) || time(a.closesAt) - time(b.closesAt) || b.match.score - a.match.score)],
    ['upcoming', 'Opening soon', list.filter((o) => o.status === 'upcoming')
      .sort((a, b) => time(a.opensAt) - time(b.opensAt) || b.match.score - a.match.score)],
    ['closed', 'Deadline passed', list.filter((o) => o.status === 'closed' || !STATUS[o.status])
      .sort((a, b) => b.match.score - a.match.score)],
  ];
}

const FILTERS = {
  scholarship: [
    ['suitable', 'Suitable for you'],
    ['all', 'All scholarships'],
    ['official', 'Official programmes'],
    ['erasmus', 'Erasmus Mundus'],
    ['strong', 'Strong matches'],
  ],
  job: [
    ['all', 'All'],
    ['strong', 'Strong matches'],
  ],
};

export default function Opportunities({ type }) {
  const isJob = type === 'job';
  const [list, setList] = useState(null);
  const [saved, setSaved] = useState(new Set());
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [refreshing, setRefreshing] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [consentFor, setConsentFor] = useState(null);
  const navigate = useNavigate();

  const load = () =>
    Promise.all([api(`/opportunities?type=${type}`), api('/tracker')])
      .then(([o, t]) => {
        setList(o.opportunities);
        setSaved(new Set(t.tracks.map((x) => x.opportunity?._id)));
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    setList(null);
    setFilter(type === 'scholarship' ? 'suitable' : 'all');
    setQuery('');
    setReport(null);
    load();
  }, [type]);

  const refresh = async () => {
    setRefreshing(true);
    setError('');
    setReport(null);
    try {
      const d = await api('/opportunities/refresh', { method: 'POST', body: { type } });
      setReport(d.report);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  };

  const toggleSave = async (o) => {
    if (saved.has(o._id)) return navigate('/app/tracker');
    await api('/tracker', { method: 'POST', body: { opportunityId: o._id } });
    setSaved(new Set([...saved, o._id]));
  };

  const remove = async (o) => {
    await api(`/opportunities/${o._id}`, { method: 'DELETE' });
    setList((l) => l.filter((x) => x._id !== o._id));
  };

  const shown = useMemo(() => {
    if (!list) return [];
    const q = query.trim().toLowerCase();
    return list.filter((o) => {
      if (q && !`${o.title} ${o.org} ${o.location} ${o.fieldNote || ''}`.toLowerCase().includes(q)) return false;
      if (filter === 'suitable') return o.match.suitable !== false;
      if (filter === 'official') return o.source === 'official';
      if (filter === 'erasmus') return o.source === 'erasmus' || /erasmus mundus/i.test(o.title || '');
      if (filter === 'strong') return o.match.score >= 70;
      return true;
    });
  }, [list, query, filter]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{isJob ? 'Jobs' : 'Scholarships'}</h1>
          <p>
            {isJob
              ? 'Jobs ranked against your skills, job title and preferred cities.'
              : 'Fulbright, Chevening, Stipendium Hungaricum, DAAD and Erasmus Mundus, ranked against your level and field.'}
          </p>
        </div>
        {!isJob && (
          <button className="btn btn-primary" onClick={refresh} disabled={refreshing}>
            <Icon name="refresh" /> {refreshing ? 'Checking official sources…' : 'Check for new scholarships'}
          </button>
        )}
      </div>

      {isJob && (
        <div className="notice notice-info" style={{ marginBottom: 14 }}>
          <Icon name="briefcase" />
          <span>Right now you can try ApplyMate on one practice job from our demo portal. More jobs will be added here soon.</span>
        </div>
      )}

      {refreshing && <div className="notice notice-info" style={{ marginBottom: 14 }}><Icon name="refresh" />Reading the EU Erasmus Mundus catalogue and official programme pages. This can take up to a minute.</div>}
      {report && (
        <div className="notice notice-info" style={{ marginBottom: 14 }}>
          <Icon name="check" />
          <div>
            {Object.entries(report).map(([src, r]) => (
              <div key={src} className="small">
                <strong>{src}:</strong> {r.error ? `could not be read (${r.error})` : `${r.found} found, ${r.added} new`}{r.note ? `. ${r.note}` : ''}
              </div>
            ))}
          </div>
        </div>
      )}
      {error && <div className="notice notice-error" style={{ marginBottom: 14 }}><Icon name="alert" />{error}</div>}

      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={16} />
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={isJob ? 'Search jobs' : 'Search scholarships, universities, countries'} aria-label="Search" />
        </div>
        <div className="chips" role="group" aria-label="Filter">
          {FILTERS[type].map(([id, label]) => (
            <button key={id} className={`chip-btn ${filter === id ? 'on' : ''}`} onClick={() => setFilter(id)} aria-pressed={filter === id}>{label}</button>
          ))}
        </div>
      </div>

      {!list ? (
        <div className="empty">Loading…</div>
      ) : shown.length === 0 ? (
        <div className="panel empty">
          <Icon name="search" size={26} />
          {query || filter !== 'all' ? 'Nothing matches this search or filter.' : isJob ? 'More jobs will be added here soon.' : 'Click “Check for new scholarships” to load programmes.'}
        </div>
      ) : !isJob ? (
        <div className="sch-board">
          {columns(shown).map(([id, label, items]) => (
            <section key={id} className={`board-col board-${id}`} aria-label={label}>
              <h2 className="board-head">{label}<span className="board-count">{items.length}</span></h2>
              {items.length === 0
                ? <p className="small muted board-empty">Nothing here for this search or filter.</p>
                : items.map((o) => (
                  <BoardCard key={o._id} o={o} column={id} saved={saved.has(o._id)} onSave={toggleSave} onApply={setConsentFor} />
                ))}
            </section>
          ))}
        </div>
      ) : (
        <div className="opp-list">
          {shown.map((o) => (
            <OppCard key={o._id} o={o} saved={saved.has(o._id)} onSave={toggleSave} onApply={setConsentFor} onRemove={remove} />
          ))}
        </div>
      )}

      {consentFor && (
        <ConsentDialog
          opportunity={consentFor}
          onCancel={() => setConsentFor(null)}
          onStarted={(id) => navigate(`/app/applications/${id}`)}
        />
      )}
    </div>
  );
}

export function OppCard({ o, saved, onSave, onApply, onRemove }) {
  const score = o.match.score;
  const [statusLabel, statusCls] = STATUS[o.status] || [];
  const closed = o.status === 'closed';
  const good = (r) => !/closed|offered for|subject:/i.test(r);

  return (
    <article className="panel opp">
      <div className="opp-score">
        <strong className={score >= 70 ? 'score-high' : score >= 40 ? 'score-mid' : 'score-low'}>{score}</strong>
        <span>% match</span>
      </div>

      <div className="opp-body">
        <div className="opp-top">
          <span className={`tag ${o.source === 'demo' ? 'tag-saffron' : 'tag-indigo'}`}>{SOURCE[o.source] || o.source}</span>
          {statusLabel && <span className={`tag ${statusCls}`}>{statusLabel}</span>}
        </div>
        <h3><Link to={`/app/opportunities/${o._id}`} className="opp-title">{o.title}</Link></h3>
        <div className="opp-meta">
          {o.org && <span><Icon name={o.type === 'job' ? 'briefcase' : 'cap'} size={15} />{o.org}</span>}
          {o.location && <span><Icon name="globe" size={15} />{o.location}</span>}
          {o.level && <span>{o.level}</span>}
          {o.salary && <span>{o.salary}</span>}
          {o.deadline && <span><Icon name="clock" size={15} />{o.deadline}</span>}
        </div>
        {o.statusNote && <span className="small muted">{o.statusNote}</span>}
        {o.match.suitable === false && (
          <div className="not-suitable small"><Icon name="info" size={15} /> Not suitable for your profile: {o.match.blockers.join('; ')}</div>
        )}
        {o.match.reasons.length > 0 && (
          <div className="reasons">{o.match.reasons.map((r) => <span key={r} className={`reason ${good(r) ? 'good' : ''}`}>{r}</span>)}</div>
        )}
        <Link to={`/app/opportunities/${o._id}`} className="small" style={{ fontWeight: 600, alignSelf: 'flex-start' }}>
          {o.type === 'job' ? 'Job details' : 'Requirements, documents and details'} →
        </Link>
      </div>

      <div className="opp-actions">
        <button className="btn btn-primary" onClick={() => onApply(o)}
          title={closed ? 'Applications are closed for this cycle; the agent can still open the portal and prepare what it allows.' : undefined}>
          <Icon name="bolt" /> Apply with agent
        </button>
        <button className="btn btn-secondary" onClick={() => onSave(o)}>
          <Icon name={saved ? 'bookmarkFilled' : 'bookmark'} /> {saved ? 'In tracker' : 'Save to tracker'}
        </button>
        <a className="btn btn-quiet btn-sm" href={o.url} target="_blank" rel="noreferrer">
          <Icon name="external" size={15} /> {o.type === 'job' ? 'Job page' : 'Official page'}
        </a>
        {o.addedBy && <button className="btn btn-quiet btn-sm" onClick={() => onRemove(o)}><Icon name="trash" size={15} /> Remove</button>}
      </div>
    </article>
  );
}

function BoardCard({ o, column, saved, onSave, onApply }) {
  const navigate = useNavigate();
  const score = o.match.score;
  const open = column === 'open';
  const [checkLabel, checkCls] = (open && FORM_CHECK[o.formCheck?.result]) || [];
  const when = open
    ? o.deadline
    : column === 'upcoming'
      ? o.opensAt ? `Opens ${fmtDate(o.opensAt)}` : o.deadline
      : o.statusNote || o.deadline;
  const stop = (fn) => (e) => { e.stopPropagation(); fn(o); };

  return (
    <article className="panel board-card" onClick={() => navigate(`/app/opportunities/${o._id}`)}>
      <div className="board-card-top">
        <Link to={`/app/opportunities/${o._id}`} className="opp-title" onClick={(e) => e.stopPropagation()}>{o.title}</Link>
        <strong className={`board-score ${score >= 70 ? 'score-high' : score >= 40 ? 'score-mid' : 'score-low'}`} title="Fit with your profile">{score}%</strong>
      </div>
      <div className="opp-meta">
        {o.org && <span><Icon name="cap" size={15} />{o.org}</span>}
        {o.location && <span><Icon name="globe" size={15} />{o.location}</span>}
        {o.level && <span>{o.level}</span>}
      </div>
      {when && <div className="board-when small"><Icon name="clock" size={14} />{when}</div>}
      {(checkLabel || o.match.suitable === false) && (
        <div className="opp-top">
          {checkLabel && <span className={`tag ${checkCls}`}>{checkLabel}</span>}
          {o.match.suitable === false && <span className="tag tag-red" title={o.match.blockers.join('; ')}>Not suitable</span>}
        </div>
      )}
      <div className="board-actions">
        {open ? (
          <button className="btn btn-primary btn-sm" onClick={stop(onApply)}><Icon name="bolt" size={15} /> Apply with agent</button>
        ) : (
          <button className="btn btn-secondary btn-sm" onClick={stop(onSave)}>
            <Icon name={saved ? 'bookmarkFilled' : 'bookmark'} size={15} /> {saved ? 'In tracker' : 'Save to tracker'}
          </button>
        )}
      </div>
    </article>
  );
}
