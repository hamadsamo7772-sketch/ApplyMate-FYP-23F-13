import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import { timeAgo } from '../components/AppLayout.jsx';

const RUN = { running: ['Running', 'tag-sky'], waiting: ['Needs you', 'tag-saffron'], ready: ['Ready to submit', 'tag-green'], stopped: ['Stopped', ''], incomplete: ['Incomplete', ''], failed: ['Could not finish', 'tag-red'] };

export const scoreClass = (s) => (s >= 70 ? 'score-high' : s >= 40 ? 'score-mid' : 'score-low');

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/dashboard').then(setD).catch((e) => setError(e.message));
  }, []);

  if (!d) return <div className="empty">{error || 'Loading your dashboard…'}</div>;

  const first = (d.name || '').split(' ')[0];
  const s = d.stages || {};
  const pipeline = [
    ['Saved', (s.saved || 0)],
    ['In progress', (s.in_progress || 0) + (s.ready || 0)],
    ['Submitted', (s.submitted || 0) + (s.interview || 0)],
    ['Decisions', (s.accepted || 0) + (s.rejected || 0)],
  ];

  return (
    <div className="stack">
      <section className="panel welcome">
        <div>
          <h1>Hello, {first}</h1>
          <p className="muted" style={{ marginTop: 6 }}>
            {d.profile.percent < 100
              ? 'A complete profile means fewer pauses when the agent fills a form.'
              : 'Your profile is complete. The agent has everything it needs.'}
          </p>
          {d.profile.sections?.length > 0 && (
            <div className="missing">
              <span className="small muted">Still to fill:</span>
              {d.profile.sections.map((s) => (
                <Link key={s.id} to={`/app/profile?tab=${s.id}`} className="missing-chip" title={`${s.missing} of ${s.total} still empty`}>
                  {s.title} <span className="num">{s.missing}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
          <div className="ring" style={{ '--p': d.profile.percent }} aria-label={`Profile ${d.profile.percent}% complete`}>
            <div className="num">{d.profile.percent}%</div>
          </div>
          <Link to="/app/profile" className="btn btn-primary">{d.profile.percent < 100 ? 'Complete profile' : 'View profile'}</Link>
        </div>
      </section>

      <section className="panel pipeline" aria-label="Application tracker summary">
        {pipeline.map(([label, n]) => (
          <div key={label}><strong>{n}</strong><span>{label}</span></div>
        ))}
      </section>

      <div className="dash-grid">
        <div className="stack">
          <TopList title="Best scholarship matches" to="/app/scholarships" items={d.topScholarships}
            empty="Fill your study level and field in your profile to see matches." />
          <TopList title="Best job matches" to="/app/jobs" items={d.topJobs}
            empty="More jobs will be added soon. Try the practice job on the Jobs page." />
        </div>

        <div className="stack">
          <section className="panel">
            <div className="panel-head"><h2>Upcoming deadlines</h2><Link to="/app/tracker" className="small">Tracker</Link></div>
            {d.upcoming.length === 0 ? (
              <div className="empty small"><Icon name="clock" size={22} />Add a deadline to an entry in your tracker and it shows up here, with a reminder 7 days before.</div>
            ) : d.upcoming.map((u) => {
              const days = Math.ceil((new Date(u.deadline) - Date.now()) / 86400000);
              return (
                <Link key={u._id} to="/app/tracker" className="list-row">
                  <span className={`tag ${days <= 7 ? 'tag-saffron' : 'tag-sky'} num`}>{days <= 0 ? 'Today' : `${days} d`}</span>
                  <span className="grow"><span className="title" style={{ display: 'block' }}>{u.title}</span>
                    <span className="small muted">{new Date(u.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span></span>
                </Link>
              );
            })}
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Recent agent runs</h2><Link to="/app/activity" className="small">All runs</Link></div>
            {d.runs.length === 0 ? (
              <div className="empty small"><Icon name="bolt" size={22} />No runs yet. Open a scholarship or job and choose “Apply with agent”.</div>
            ) : d.runs.map((r) => {
              const [label, cls] = RUN[r.status] || [r.status, ''];
              return (
                <Link key={r._id} to={`/app/applications/${r._id}`} className="list-row">
                  <Icon name={r.type === 'job' ? 'briefcase' : 'cap'} />
                  <span className="grow"><span className="title" style={{ display: 'block' }}>{r.title}</span>
                    <span className="small muted">{timeAgo(r.createdAt)}</span></span>
                  <span className={`tag ${cls}`}>{label}</span>
                </Link>
              );
            })}
          </section>
        </div>
      </div>
    </div>
  );
}

function TopList({ title, to, items, empty }) {
  return (
    <section className="panel">
      <div className="panel-head"><h2>{title}</h2><Link to={to} className="small">See all</Link></div>
      {items.length === 0 ? (
        <div className="empty small"><Icon name="search" size={22} />{empty}</div>
      ) : items.map((o) => (
        <Link key={o._id} to={to} className="list-row">
          <span className={`score ${scoreClass(o.match.score)}`} style={{ width: 42 }}>{o.match.score}%</span>
          <span className="grow">
            <span className="title" style={{ display: 'block' }}>{o.title}</span>
            <span className="small muted">{[o.org, o.location].filter(Boolean).join(', ')}</span>
          </span>
          <Icon name="chevron" />
        </Link>
      ))}
    </section>
  );
}
