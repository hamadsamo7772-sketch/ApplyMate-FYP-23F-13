// Account settings: name, password, email notifications, log out.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useUser } from '../App.jsx';
import Icon from '../components/Icon.jsx';
import { NotificationSettings } from './Profile.jsx';

export default function Settings() {
  const { user, setUser, logout } = useUser();

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <div className="page-head">
        <div>
          <h1>Account settings</h1>
          <p>Your login details and how ApplyMate contacts you. Your application data is in <Link to="/app/profile">Profile & documents</Link>.</p>
        </div>
      </div>
      <AccountDetails user={user} onSaved={setUser} />
      <ChangePassword />
      <NotificationSettings />
      <section className="panel panel-pad stack" style={{ gap: 12 }}>
        <div>
          <h2>Log out</h2>
          <p className="small muted" style={{ marginTop: 4 }}>Log out of ApplyMate on this computer.</p>
        </div>
        <button className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={logout}><Icon name="logout" /> Log out</button>
      </section>
    </div>
  );
}

function AccountDetails({ user, onSaved }) {
  const [name, setName] = useState(user?.name || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const d = await api('/auth/account', { method: 'PUT', body: { name } });
      onSaved(d.user);
      setMsg({ ok: true, text: 'Saved.' });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel panel-pad stack" style={{ gap: 14 }} onSubmit={save}>
      <div>
        <h2>Your account</h2>
        <p className="small muted" style={{ marginTop: 4 }}>The name ApplyMate greets you with. The email is the one you log in with.</p>
      </div>
      <div className="form-grid">
        <label className="field">Name
          <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
        </label>
        <label className="field">Email
          <input value={user?.email || ''} disabled />
        </label>
      </div>
      {msg && <div className={`notice ${msg.ok ? 'notice-ok' : 'notice-error'}`}><Icon name={msg.ok ? 'check' : 'alert'} />{msg.text}</div>}
      <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={busy || !name.trim() || name.trim() === user?.name}>
        <Icon name="check" /> {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}

function ChangePassword() {
  const empty = { current: '', password: '', confirm: '' };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setMsg(null);
    if (form.password !== form.confirm) return setMsg({ ok: false, text: 'The two new passwords are not the same.' });
    setBusy(true);
    try {
      await api('/auth/password', { method: 'POST', body: { current: form.current, password: form.password } });
      setForm(empty);
      setMsg({ ok: true, text: 'Your password has been changed. Use the new one next time you log in.' });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel panel-pad stack" style={{ gap: 14 }} onSubmit={save}>
      <div>
        <h2><Icon name="lock" size={18} /> Change password</h2>
        <p className="small muted" style={{ marginTop: 4 }}>
          Forgot your current password? Log out and use “Forgot password?” on the login page.
        </p>
      </div>
      <label className="field">Current password
        <input type="password" value={form.current} onChange={set('current')} required autoComplete="current-password" />
      </label>
      <div className="form-grid">
        <label className="field">New password
          <input type="password" value={form.password} onChange={set('password')} required minLength={6} autoComplete="new-password" />
          <span className="hint">At least 6 characters.</span>
        </label>
        <label className="field">Type the new password again
          <input type="password" value={form.confirm} onChange={set('confirm')} required minLength={6} autoComplete="new-password" />
        </label>
      </div>
      {msg && <div className={`notice ${msg.ok ? 'notice-ok' : 'notice-error'}`}><Icon name={msg.ok ? 'check' : 'alert'} />{msg.text}</div>}
      <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={busy}>
        <Icon name="lock" /> {busy ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
}
