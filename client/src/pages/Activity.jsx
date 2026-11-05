import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';

export const RUN_STATUS = {
  running: ['Filling the form', 'tag-sky'],
  waiting: ['Needs you', 'tag-saffron'],
  ready: ['Ready to submit', 'tag-green'],
  stopped: ['Stopped', ''],
  incomplete: ['Stopped before finishing', ''],
  failed: ['Could not finish', 'tag-red'],
};

export default function Activity() {
  const [apps, setApps] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/applications').then((d) => setApps(d.applications)).catch((e) => setError(e.message));
  }, []);

  if (!apps) return <div className="empty">{error || 'Loading…'}</div>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Agent activity</h1>
          <p>Every time the agent filled a form for you, with its full log. Open a run to continue one that is waiting for you.</p>
        </div>
      </div>
      {apps.length === 0 ? (
        <div className="panel empty">
          <Icon name="bolt" size={28} />
          No runs yet. Open a scholarship or job and choose “Apply with agent”.
          <Link to="/app/scholarships" className="btn btn-primary">Browse scholarships</Link>
        </div>
      ) : (
        <div className="panel">
          <table className="table">
            <thead><tr><th>Opportunity</th><th>Type</th><th>Status</th><th>Started</th><th><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {apps.map((a) => {
                const [label, cls] = RUN_STATUS[a.status] || [a.status, ''];
                const done = (a.log || []).filter((l) => /^\s+✅/.test(l)).length;
                return (
                  <tr key={a._id}>
                    <td><strong>{a.opportunity?.title || 'Removed opportunity'}</strong><div className="tiny muted">{done} fields filled</div></td>
                    <td className="muted">{a.opportunity?.type === 'job' ? 'Job' : 'Scholarship'}</td>
                    <td><span className={`tag ${cls}`}>{label}</span></td>
                    <td className="muted small">{new Date(a.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td><Link to={`/app/applications/${a._id}`} className="btn btn-secondary btn-sm">Open</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
