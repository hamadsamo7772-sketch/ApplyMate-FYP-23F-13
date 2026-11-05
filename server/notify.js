// notify.js — in-app notifications, plus email when SMTP is configured in .env
//
// .env (optional, for email):
//   SMTP_HOST=smtp.gmail.com
//   SMTP_PORT=465
//   SMTP_USER=yourname@gmail.com
//   SMTP_PASS=your-16-letter-app-password      (Google account → Security → App passwords)
//   MAIL_FROM="ApplyMate <yourname@gmail.com>"

const express = require('express');
const { Notification, User } = require('./models');
const { requireAuth } = require('./auth');
const { renderEmail } = require('./email-template');

let transporter = null;
function mailer() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return null;
  if (!transporter) {
    const nodemailer = require('nodemailer');
    const port = Number(process.env.SMTP_PORT || 465);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

const emailEnabled = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER);

// Sends a branded HTML email with a plain-text copy
async function sendEmail(to, message) {
  const t = mailer();
  if (!t) throw new Error('Email is not set up. Add SMTP settings to .env (see server/notify.js).');
  const { subject, html, text, attachments } = renderEmail(message);
  await t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, html, text, attachments });
}

/**
 * Create a notification for a user.
 * kind: agent-waiting | agent-ready | agent-failed | deadline | cv | info
 * key:  optional; the same key is never notified twice (e.g. one deadline reminder per day)
 */
async function notify(userId, { kind = 'info', title, body = '', link = '', key = '', email = false }) {
  if (key && (await Notification.exists({ user: userId, key }))) return null;
  const n = await Notification.create({ user: userId, kind, title, body, link, key: key || undefined });

  if (email && emailEnabled()) {
    try {
      const user = await User.findById(userId).lean();
      if (user?.settings?.emailNotifications) {
        await sendEmail(user.email, { kind, title, body, link, name: user.name });
      }
    } catch (err) {
      console.log(`⚠ email not sent: ${err.message}`);
    }
  }
  return n;
}

// ---------------- API ----------------
const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const items = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(40).lean();
  res.json({ notifications: items, unread: items.filter((n) => !n.read).length });
});

router.post('/read-all', async (req, res) => {
  await Notification.updateMany({ user: req.user._id, read: false }, { read: true });
  res.json({ ok: true });
});

router.post('/:id/read', async (req, res) => {
  await Notification.updateOne({ _id: req.params.id, user: req.user._id }, { read: true });
  res.json({ ok: true });
});

// settings: { emailNotifications: true|false }
router.get('/settings', (req, res) =>
  res.json({ settings: req.user.settings || {}, emailAvailable: emailEnabled() })
);
router.put('/settings', async (req, res) => {
  req.user.set('settings.emailNotifications', !!req.body?.emailNotifications);
  await req.user.save();
  res.json({ settings: req.user.settings, emailAvailable: emailEnabled() });
});
router.post('/test-email', async (req, res) => {
  try {
    await sendEmail(req.user.email, {
      kind: 'info',
      title: 'Email notifications are on',
      body: 'This is a test email from ApplyMate, and it arrived, so everything is set up.',
      hint: 'From now on you’ll get an email when the agent needs you, when a form is ready for you to submit, and when a deadline in your tracker is 7 days away or less.',
      link: '/app/profile',
      name: req.user.name,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = { router, notify, emailEnabled, sendEmail };
