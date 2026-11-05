// auth.js — signup / login with hashed passwords and JWT tokens
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('./models');

const SECRET = () => process.env.JWT_SECRET || 'dev-only-secret-change-me';
const sign = (user) => jwt.sign({ id: user._id.toString() }, SECRET(), { expiresIn: '7d' });

// Middleware: only logged-in users. Token comes as "Authorization: Bearer <token>".
async function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  try {
    const { id } = jwt.verify(token, SECRET());
    req.user = await User.findById(id);
    if (!req.user) throw new Error('no user');
    next();
  } catch {
    res.status(401).json({ error: 'Please log in again.' });
  }
}

const router = express.Router();
const publicUser = (u) => ({ id: u._id, name: u.name, email: u.email });

router.post('/signup', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (await User.findOne({ email: email.toLowerCase() })) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const [firstName, ...rest] = name.trim().split(/\s+/);
  const user = await User.create({
    name: name.trim(),
    email,
    passwordHash: await bcrypt.hash(password, 10),
    // start the profile with what we already know
    profile: { personal: { fullName: name.trim(), firstName, lastName: rest.join(' '), email } },
  });
  res.json({ token: sign(user), user: publicUser(user) });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = await User.findOne({ email: (email || '').toLowerCase() });
  if (!user || !(await bcrypt.compare(password || '', user.passwordHash))) {
    return res.status(401).json({ error: 'Wrong email or password.' });
  }
  res.json({ token: sign(user), user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

// ---- forgot password: a 6-digit code by email, then a new password ----
const PIN_MINUTES = 15;
const MAX_TRIES = 5;

// POST /api/auth/forgot { email }  -> emails a code. The answer is the same whether the account exists or not.
router.post('/forgot', async (req, res) => {
  const { emailEnabled, sendEmail } = require('./notify'); // notify.js uses requireAuth from this file
  if (!emailEnabled()) {
    return res.status(503).json({ error: 'Password reset by email is not set up on this ApplyMate server yet. Please ask the ApplyMate team.' });
  }
  const email = String(req.body?.email || '').trim().toLowerCase();
  const ok = { ok: true, message: `If an account exists for ${email}, we have sent it a 6-digit code. It works for ${PIN_MINUTES} minutes.` };
  const user = email && (await User.findOne({ email }));
  if (!user) return res.json(ok);
  // one code a minute at most
  if (user.reset?.sentAt && Date.now() - user.reset.sentAt < 60e3) return res.json(ok);

  const pin = String(require('crypto').randomInt(100000, 1000000));
  user.reset = { pinHash: await bcrypt.hash(pin, 10), expires: new Date(Date.now() + PIN_MINUTES * 60e3), tries: 0, sentAt: new Date() };
  await user.save();
  try {
    await sendEmail(user.email, {
      kind: 'info',
      title: `Your password reset code: ${pin}`,
      body: `Enter this code in ApplyMate to choose a new password: ${pin}. It works for ${PIN_MINUTES} minutes.`,
      hint: 'If you did not ask to reset your password, you can ignore this email. Your password stays the same.',
      link: '/forgot-password',
      name: user.name,
    });
  } catch (err) {
    console.log(`⚠ reset email not sent: ${err.message}`);
    return res.status(502).json({ error: 'We could not send the email just now. Please try again in a minute.' });
  }
  res.json(ok);
});

// POST /api/auth/reset { email, pin, password }  -> new password, and the student is logged in
router.post('/reset', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const { pin, password } = req.body || {};
  const wrong = { error: 'This code is not right or has expired. Ask for a new code and try again.' };
  const user = email && (await User.findOne({ email }));
  if (!user?.reset?.pinHash || user.reset.expires < new Date() || (user.reset.tries || 0) >= MAX_TRIES) return res.status(400).json(wrong);
  if (!(await bcrypt.compare(String(pin || '').trim(), user.reset.pinHash))) {
    user.reset.tries = (user.reset.tries || 0) + 1;
    await user.save();
    return res.status(400).json(wrong);
  }
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  user.passwordHash = await bcrypt.hash(password, 10);
  user.reset = undefined;
  await user.save();
  res.json({ token: sign(user), user: publicUser(user) });
});

// ---- account settings ----
// PUT /api/auth/account { name }
router.put('/account', requireAuth, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Please enter your name.' });
  req.user.name = name;
  await req.user.save();
  res.json({ user: publicUser(req.user) });
});

// POST /api/auth/password { current, password }
router.post('/password', requireAuth, async (req, res) => {
  const { current, password } = req.body || {};
  if (!(await bcrypt.compare(current || '', req.user.passwordHash))) return res.status(400).json({ error: 'Your current password is not right.' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'The new password must be at least 6 characters.' });
  req.user.passwordHash = await bcrypt.hash(password, 10);
  req.user.reset = undefined;
  await req.user.save();
  res.json({ ok: true });
});

module.exports = { router, requireAuth };
