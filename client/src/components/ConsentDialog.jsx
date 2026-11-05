// The permission step before the agent fills anything (proposal: "explicit permission
// before auto-filling any platform's forms"). Shows what will happen and what is missing.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Icon from './Icon.jsx';

export default function ConsentDialog({ opportunity, onCancel, onStarted }) {
  const isDemo = opportunity.source === 'demo';
  const [agree, setAgree] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    api('/dashboard').then((d) => setProfile(d.profile)).catch(() => {});
    const esc = (e) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  let host = '';
  try { host = new URL(opportunity.applyUrl || opportunity.url).host; } catch { /* ignore */ }

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const d = await api('/applications', { method: 'POST', body: { opportunityId: opportunity._id, consent: true } });
      onStarted(d.id);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="consent-title">
        <div className="modal-head">
          <div>
            <h2 id="consent-title">Let the agent fill this application?</h2>
            <p className="muted small" style={{ marginTop: 4 }}>{opportunity.title}</p>
          </div>
          <button className="btn btn-quiet btn-icon" onClick={onCancel} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="modal-body">
          <ul className="checklist">
            <li><Icon name="check" /><span>{isDemo
              ? <>A browser window opens on <strong>the local demo portal</strong> and the agent fills the form from your profile.</>
              : <>A browser window opens on <strong>{host}</strong>. The agent finds the application form by itself (Admissions → Apply → portal) and fills it from your profile.</>}</span></li>
            <li><Icon name="check" /><span>The AI model runs on this computer and only sees field names, never your values.</span></li>
            <li><Icon name="check" /><span>It stops for “I’m not a robot” checks, essays and anything not in your profile, and asks before uploading documents to a real website.</span></li>
            {!isDemo && <li><Icon name="check" /><span>It only asks you for what it must not do itself: your password, email codes, “I’m not a robot” checks, essays, and ticking terms or declarations.</span></li>}
            <li><Icon name="check" /><span><strong>It never submits.</strong> You review the filled form and submit it yourself.</span></li>
          </ul>


          {opportunity.status === 'closed' && (
            <div className="notice notice-warn">
              <Icon name="clock" />
              <div className="small"><strong>Applications are closed for this cycle.</strong> {opportunity.statusNote || ''} The agent will still open the portal; it can only fill what the portal allows before the next call opens.</div>
            </div>
          )}

          {profile && profile.missing.length > 0 && (
            <div className="notice notice-warn">
              <Icon name="alert" />
              <div>
                <strong>{profile.missing.length} profile field{profile.missing.length > 1 ? 's are' : ' is'} empty</strong>
                <div className="small">
                  {profile.missing.slice(0, 6).map((m) => m.label).join(', ')}
                  {profile.missing.length > 6 ? ' and more' : ''}. The agent will ask you if a form needs them.{' '}
                  <Link to="/app/profile" onClick={onCancel}>Complete profile</Link>
                </div>
              </div>
            </div>
          )}

          <label className="consent">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>I allow ApplyMate to fill this form with my profile data and documents.</span>
          </label>
          {error && <div className="notice notice-error"><Icon name="alert" />{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={!agree || busy} onClick={start}>
            <Icon name="bolt" /> {busy ? 'Starting agent…' : 'Start agent'}
          </button>
        </div>
      </div>
    </div>
  );
}
