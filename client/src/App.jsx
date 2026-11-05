import { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api, getToken, setToken } from './api.js';
import AppLayout from './components/AppLayout.jsx';
import Landing from './pages/Landing.jsx';
import Auth from './pages/Auth.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Opportunities from './pages/Opportunities.jsx';
import Tracker from './pages/Tracker.jsx';
import Activity from './pages/Activity.jsx';
import ApplyRun from './pages/ApplyRun.jsx';
import OpportunityDetail from './pages/OpportunityDetail.jsx';
import Profile from './pages/Profile.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import Settings from './pages/Settings.jsx';

const UserContext = createContext(null);
export const useUser = () => useContext(UserContext);

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(!!getToken());
  const navigate = useNavigate();

  useEffect(() => {
    if (!getToken()) return;
    api('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setToken(null))
      .finally(() => setChecking(false));
  }, []);

  const login = (token, u, isNew) => {
    setToken(token);
    setUser(u);
    navigate(isNew ? '/app/profile' : '/app');
  };
  const logout = () => {
    setToken(null);
    setUser(null);
    navigate('/');
  };

  if (checking) return <div className="empty" style={{ minHeight: '60vh' }}>Loading…</div>;

  const guard = (el) => (user ? el : <Navigate to="/login" />);

  return (
    <UserContext.Provider value={{ user, setUser, login, logout }}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={user ? <Navigate to="/app" /> : <Auth mode="login" />} />
        <Route path="/signup" element={user ? <Navigate to="/app" /> : <Auth mode="signup" />} />
        <Route path="/forgot-password" element={user ? <Navigate to="/app" /> : <ForgotPassword />} />
        <Route path="/app" element={guard(<AppLayout />)}>
          <Route index element={<Dashboard />} />
          <Route path="scholarships" element={<Opportunities type="scholarship" />} />
          <Route path="jobs" element={<Opportunities type="job" />} />
          <Route path="tracker" element={<Tracker />} />
          <Route path="activity" element={<Activity />} />
          <Route path="applications/:id" element={<ApplyRun />} />
          <Route path="opportunities/:id" element={<OpportunityDetail />} />
          <Route path="profile" element={<Profile />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to={user ? '/app' : '/'} />} />
      </Routes>
    </UserContext.Provider>
  );
}
