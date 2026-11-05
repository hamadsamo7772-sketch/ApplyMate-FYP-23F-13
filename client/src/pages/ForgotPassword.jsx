// Forgot password: 1. the student types their email and gets a 6-digit code by email,
// 2. types the code and a new password, and is logged in.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useUser } from '../App.jsx';
import Icon from '../components/Icon.jsx';
import { Logo } from '../components/AppLayout.jsx';

export default function ForgotPassword() {
  const { login } = useUser();
  const [step, setStep] = useState('email'); // email -> code
  const [form, setForm] = useState({ email: '', pin: '', password: '', confirm: '' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const sendCode = async (e) => {
    e?.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      const d = await api('/auth/forgot', { method: 'POST', body: { email: form.email } });
      setStep('code');
      setMsg({ ok: true, text: d.message });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const reset = async (e) => {
    e.preventDefault();
    setMsg(null);
    if (form.password !== form.confirm) return setMsg({ ok: false, text: 'The two passwords are not the same.' });
    setBusy(true);
    try {
      const d = await api('/auth/reset', { method: 'POST', body: { email: form.email, pin: form.pin, password: form.password } });
      login(d.token, d.user, false);
    } catch (err) {
      setMsg({ ok: false, text: err.message });
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <aside className="auth-side">
        <Link to="/" className="brand"><span className="brand-mark"><Logo /></span> ApplyMate</Link>
        <div>
          <h2>Forgot your password? It happens.</h2>
          <ul>
            <li><Icon name="mail" /> We email you a 6-digit code</li>
            <li><Icon name="lock" /> Type the code here and choose a new password</li>
            <li><Icon name="check" /> Your profile, documents and applications stay as they are</li>
          </ul>
        </div>
        <span className="small" style={{ color: '#c9cbff' }}>Final year project 23F-13, Sukkur IBA University</span>
      </aside>

      <main className="auth-main">
        {step === 'email' ? (
          <form className="auth-form" onSubmit={sendCode}>
            <h1>Reset your password</h1>
            <p className="muted">Enter the email you signed up with. We will send you a 6-digit code.</p>
            <label className="field">Email
              <input type="email" value={form.email} onChange={set('email')} required autoComplete="email" autoFocus />
            </label>
            {msg && <div className={`notice ${msg.ok ? 'notice-ok' : 'notice-error'}`}><Icon name={msg.ok ? 'check' : 'alert'} />{msg.text}</div>}
            <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? 'Sending…' : 'Send me a code'}</button>
            <p className="small muted">Remembered it? <Link to="/login">Log in</Link></p>
          </form>
        ) : (
          <form className="auth-form" onSubmit={reset}>
            <h1>Choose a new password</h1>
            <p className="muted">Check the inbox of <strong>{form.email}</strong> (and the spam folder) for the code.</p>
            <label className="field">6-digit code
              <input value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                required inputMode="numeric" autoComplete="one-time-code" placeholder="123456" autoFocus
                style={{ letterSpacing: '0.3em', fontSize: 18, fontVariantNumeric: 'tabular-nums' }} />
            </label>
            <label className="field">New password
              <input type="password" value={form.password} onChange={set('password')} required minLength={6} autoComplete="new-password" />
              <span className="hint">At least 6 characters.</span>
            </label>
            <label className="field">Type the new password again
              <input type="password" value={form.confirm} onChange={set('confirm')} required minLength={6} autoComplete="new-password" />
            </label>
            {msg && <div className={`notice ${msg.ok ? 'notice-ok' : 'notice-error'}`}><Icon name={msg.ok ? 'check' : 'alert'} />{msg.text}</div>}
            <button className="btn btn-primary btn-lg" disabled={busy || form.pin.length !== 6}>{busy ? 'Please wait…' : 'Save new password and log in'}</button>
            <p className="small muted">
              No email? <button type="button" className="linkish" onClick={sendCode} disabled={busy}>Send a new code</button>
              {' · '}<button type="button" className="linkish" onClick={() => { setStep('email'); setMsg(null); }}>Use another email</button>
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
