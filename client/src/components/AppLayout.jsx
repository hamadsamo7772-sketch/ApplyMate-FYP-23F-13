import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { useUser } from '../App.jsx';
import Icon from './Icon.jsx';
import ChatWidget from './ChatWidget.jsx';

const NAV = [
  ['/app', 'Home', 'home', true],
  ['/app/scholarships', 'Scholarships', 'cap'],
  ['/app/jobs', 'Jobs', 'briefcase'],
  ['/app/tracker', 'My applications', 'board'],
  ['/app/activity', 'Agent runs', 'activity'],
];

const TITLES = {
  '/app': 'Home',
  '/app/scholarships': 'Scholarships',
  '/app/jobs': 'Jobs',
  '/app/tracker': 'Application tracker',
  '/app/activity': 'Agent activity',
  '/app/profile': 'Profile',
  '/app/settings': 'Account settings',
};

export default function AppLayout() {
  const { user, logout } = useUser();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const notif = useNotifications();

  useEffect(() => setOpen(false), [pathname]);

  const initials = (user?.name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const title = TITLES[pathname] || (pathname.startsWith('/app/applications') ? 'Agent run' : pathname.startsWith('/app/opportunities') ? 'Details' : '');

  return (
    <div className="shell">
      <header className="topnav">
        <div className="topnav-in">
          <Link to="/app" className="brand">
            <span className="brand-mark"><Logo /></span> ApplyMate
          </Link>
          <nav className={`topnav-links ${open ? 'open' : ''}`} aria-label="Main navigation">
            {NAV.map(([to, label, icon, end]) => (
              <NavLink key={to} to={to} end={end} className="nav-pill">
                <Icon name={icon} size={16} /> {label}
                {to === '/app/activity' && notif.waiting > 0 && <span className="count" title="Runs waiting for you">{notif.waiting}</span>}
              </NavLink>
            ))}
            <NavLink to="/app/profile" className="nav-pill only-menu"><Icon name="user" size={16} /> Profile & documents</NavLink>
            <NavLink to="/app/settings" className="nav-pill only-menu"><Icon name="settings" size={16} /> Account settings</NavLink>
            <button className="nav-pill only-menu" onClick={logout}><Icon name="logout" size={16} /> Log out</button>
          </nav>
          <div className="topbar-right">
            <Bell notif={notif} />
            <UserMenu initials={initials} name={user?.name} logout={logout} />
            <button className="btn btn-quiet btn-icon menu-btn" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>
              <Icon name={open ? 'x' : 'menu'} />
            </button>
          </div>
        </div>
      </header>

      <div className="main">
        <main className="content">
          <Outlet context={{ refreshNotifications: notif.reload }} />
        </main>
        <footer className="app-foot"><Icon name="shield" size={15} /> The AI runs offline on this computer. Your data never leaves it.</footer>
      </div>
      <ChatWidget />
    </div>
  );
}

function UserMenu({ initials, name, logout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="user-menu" ref={ref}>
      <button className="avatar" onClick={() => setOpen((o) => !o)} aria-label={`Account menu for ${name || 'you'}`} aria-expanded={open}>{initials}</button>
      {open && (
        <div className="user-pop" role="menu">
          <div className="user-pop-name">{name}</div>
          <Link to="/app/profile" role="menuitem" onClick={() => setOpen(false)}><Icon name="user" size={16} /> Profile & documents</Link>
          <Link to="/app/settings" role="menuitem" onClick={() => setOpen(false)}><Icon name="settings" size={16} /> Account settings</Link>
          <button role="menuitem" onClick={logout}><Icon name="logout" size={16} /> Log out</button>
        </div>
      )}
    </div>
  );
}

export function Logo({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M8 24l8-16 8 16M11.5 18h9" stroke="currentColor" strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function useNotifications() {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const reload = () =>
    api('/notifications')
      .then((d) => {
        setItems(d.notifications);
        setUnread(d.unread);
      })
      .catch(() => {});
  useEffect(() => {
    reload();
    const t = setInterval(reload, 12000);
    return () => clearInterval(t);
  }, []);
  const waiting = items.filter((n) => !n.read && n.kind === 'agent-waiting').length;
  return { items, unread, waiting, reload, setItems, setUnread };
}

const KIND_ICON = { 'agent-waiting': 'pause', 'agent-ready': 'check', 'agent-failed': 'alert', deadline: 'clock', cv: 'file', info: 'bell' };

function Bell({ notif }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const readAll = async () => {
    await api('/notifications/read-all', { method: 'POST' });
    notif.reload();
  };
  const readOne = (n) => {
    if (!n.read) api(`/notifications/${n._id}/read`, { method: 'POST' }).then(notif.reload);
    setOpen(false);
  };

  return (
    <div className="bell" ref={ref}>
      <button className="btn btn-quiet btn-icon" onClick={() => setOpen(!open)} aria-label={`Notifications, ${notif.unread} unread`}>
        <Icon name="bell" />
        {notif.unread > 0 && <span className="bell-dot num">{notif.unread}</span>}
      </button>
      {open && (
        <div className="dropdown" role="dialog" aria-label="Notifications">
          <div className="dropdown-head">
            <strong>Notifications</strong>
            {notif.unread > 0 && <button className="linkish" onClick={readAll}>Mark all as read</button>}
          </div>
          <div className="notif-list">
            {notif.items.length === 0 && (
              <div className="empty small">
                <Icon name="bell" size={22} />
                You’ll be notified when the agent needs you, a form is ready, or a deadline is close.
              </div>
            )}
            {notif.items.map((n) => (
              <Link key={n._id} to={n.link || '/app'} className={`notif ${n.read ? '' : 'unread'}`} onClick={() => readOne(n)}>
                <span className={`notif-icon ${n.kind}`}><Icon name={KIND_ICON[n.kind] || 'bell'} size={16} /></span>
                <span>
                  <strong className="small" style={{ display: 'block' }}>{n.title}</strong>
                  <span className="small muted">{n.body}</span>
                  <span className="tiny muted" style={{ display: 'block', marginTop: 2 }}>{timeAgo(n.createdAt)}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
