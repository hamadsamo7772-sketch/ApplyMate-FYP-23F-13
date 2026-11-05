// email-template.js — branded HTML emails (plus a plain-text copy for spam filters and old mail apps).
// Built with tables and inline styles, because Gmail and Outlook ignore most CSS.
const path = require('path');

const appUrl = () => (process.env.APP_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, '');

// Each kind of notification gets its own colour, label and button
const KINDS = {
  'agent-waiting': { accent: '#E09A2D', soft: '#FDF3E2', ink: '#8A5508', label: 'Action needed', button: 'Open the agent run' },
  'agent-ready': { accent: '#1E8E5A', soft: '#E4F4EC', ink: '#17704A', label: 'Ready to submit', button: 'Review the application' },
  'agent-failed': { accent: '#C2412D', soft: '#FBEAE7', ink: '#9A3222', label: 'Agent stopped', button: 'See what happened' },
  deadline: { accent: '#3B3FD8', soft: '#ECEDFD', ink: '#2A2EA8', label: 'Deadline reminder', button: 'Open your tracker' },
  info: { accent: '#3B3FD8', soft: '#ECEDFD', ink: '#2A2EA8', label: 'ApplyMate', button: 'Open ApplyMate' },
};

const HINTS = {
  'agent-waiting': 'The agent has paused and is waiting for you. Finish the step in the browser window it opened, then press “I’ve done it, continue” in ApplyMate.',
  'agent-ready': 'Every field the agent could fill is done. ApplyMate never submits for you: check the form in the browser window and press submit yourself.',
  'agent-failed': 'Nothing was submitted. Open the run to see the last step and try again.',
  deadline: 'Make sure your documents are ready, and move the application to “Submitted” in your tracker once you have applied.',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The logo is attached to the email itself (cid:), so it shows even though the app runs on localhost
const LOGO = { filename: 'applymate.png', path: path.join(__dirname, '..', 'client', 'public', 'brand', 'applymate-mark.png'), cid: 'applymate-logo' };

/**
 * @returns {{ subject, html, text, attachments }}
 */
function renderEmail({ kind = 'info', title, body = '', link = '', name = '', hint }) {
  const k = KINDS[kind] || KINDS.info;
  const url = `${appUrl()}${link || '/app'}`;
  const greeting = name ? `Hi ${name.split(/\s+/)[0]},` : 'Hi,';
  const note = hint ?? HINTS[kind] ?? '';
  const font = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#F6F7FB;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(body).slice(0, 140)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F7FB;">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td style="padding:0 4px 18px;${font}">
      <img src="cid:${LOGO.cid}" width="28" height="28" alt="" style="vertical-align:middle;border-radius:7px;border:0;">
      <span style="vertical-align:middle;font-size:17px;font-weight:700;color:#1B1F3B;margin-left:8px;">ApplyMate</span>
    </td></tr>
    <tr><td style="background:#FFFFFF;border:1px solid #E1E3EF;border-radius:14px;overflow:hidden;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="height:4px;background:${k.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:28px 32px 8px;${font}">
          <span style="display:inline-block;background:${k.soft};color:${k.ink};font-size:12px;font-weight:700;letter-spacing:.02em;padding:4px 10px;border-radius:99px;">${esc(k.label)}</span>
          <h1 style="margin:14px 0 0;font-size:22px;line-height:1.3;color:#1B1F3B;font-weight:700;">${esc(title)}</h1>
        </td></tr>
        <tr><td style="padding:12px 32px 0;${font}font-size:15px;line-height:1.6;color:#4A5072;">
          <p style="margin:0 0 12px;">${esc(greeting)}</p>
          ${body ? `<p style="margin:0 0 12px;color:#1B1F3B;">${esc(body)}</p>` : ''}
          ${note ? `<p style="margin:0;">${esc(note)}</p>` : ''}
        </td></tr>
        <tr><td style="padding:24px 32px 30px;${font}">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="background:#3B3FD8;border-radius:8px;">
              <a href="${esc(url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;">${esc(k.button)}</a>
            </td>
          </tr></table>
          <p style="margin:14px 0 0;font-size:12.5px;color:#6B7091;">Or open ${esc(url)} on the computer where ApplyMate is running.</p>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:18px 8px 0;${font}font-size:12px;line-height:1.6;color:#6B7091;text-align:center;">
      You’re getting this email because email notifications are turned on in ApplyMate (Profile &rarr; Notifications).
      You can turn them off there at any time. This mailbox isn’t monitored, so please don’t reply.<br>
      ApplyMate &middot; Final year project 23F-13
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;

  const text = [
    greeting,
    '',
    title,
    body,
    note,
    '',
    `${k.button}: ${url}`,
    '',
    '—',
    'You’re getting this because email notifications are on in ApplyMate (Profile → Notifications). This mailbox isn’t monitored.',
  ].filter((l) => l !== undefined).join('\n');

  return { subject: title, html, text, attachments: [LOGO] };
}

module.exports = { renderEmail, appUrl };
