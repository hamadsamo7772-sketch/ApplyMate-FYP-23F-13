import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useUser } from '../App.jsx';
import Icon from '../components/Icon.jsx';
import { Logo } from '../components/AppLayout.jsx';

export default function Auth({ mode }) {
  const { login } = useUser();
  const signup = mode === 'signup';
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const d = await api(`/auth/${mode}`, { method: 'POST', body: form });
      login(d.token, d.user, signup);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <aside className="auth-side">
        <Link to="/" className="brand"><span className="brand-mark"><Logo /></span> ApplyMate</Link>
        <div>
          <h2>{signup ? 'One profile for every scholarship and job application.' : 'Welcome back.'}</h2>
          <ul>
            <li><Icon name="check" /> Fulbright, Chevening, Stipendium Hungaricum, DAAD and Erasmus Mundus, with jobs coming soon</li>
            <li><Icon name="check" /> An AI agent fills forms field by field and asks before anything sensitive</li>
            <li><Icon name="check" /> Runs offline: your CNIC and documents stay on this computer</li>
          </ul>
        </div>
        <span className="small" style={{ color: '#c9cbff' }}>Final year project 23F-13, Sukkur IBA University</span>
      </aside>

      <main className="auth-main">
        <form className="auth-form" onSubmit={submit}>
          <h1>{signup ? 'Create your account' : 'Log in'}</h1>
          <p className="muted">{signup ? 'Takes a minute. You can import the rest from your CV.' : 'Continue to your dashboard.'}</p>
          {signup && (
            <label className="field">Full name
              <input value={form.name} onChange={set('name')} required autoComplete="name" placeholder="e.g. Hamadullah Samo" />
            </label>
          )}
          <label className="field">Email
            <input type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
          </label>
          <label className="field">Password
            <input type="password" value={form.password} onChange={set('password')} required minLength={6}
              autoComplete={signup ? 'new-password' : 'current-password'} />
            {signup && <span className="hint">At least 6 characters.</span>}
            {!signup && <Link to="/forgot-password" className="small" style={{ alignSelf: 'flex-end', fontWeight: 600 }}>Forgot password?</Link>}
          </label>
          {error && <div className="notice notice-error"><Icon name="alert" />{error}</div>}
          <button className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? 'Please wait…' : signup ? 'Create account' : 'Log in'}
          </button>
          <p className="small muted">
            {signup ? <>Already have an account? <Link to="/login">Log in</Link></> : <>New to ApplyMate? <Link to="/signup">Create an account</Link></>}
          </p>
        </form>
      </main>
    </div>
  );
}
