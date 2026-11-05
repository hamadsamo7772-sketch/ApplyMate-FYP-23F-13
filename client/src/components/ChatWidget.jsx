import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Icon from './Icon.jsx';

const KEY = 'applymate_chat';
const SUGGESTIONS = [
  'Which scholarships fit my profile?',
  'Which scholarships are open right now?',
  'Which jobs match my skills?',
  'How does “Apply with agent” work?',
];
const STATUS = { open: ['Open', 'tag-green'], upcoming: ['Opens soon', 'tag-sky'], closed: ['Closed', ''], varies: ['Varies', ''] };

const load = () => {
  try { return JSON.parse(sessionStorage.getItem(KEY)) || []; } catch { return []; }
};

// Plain text with "- " lines shown as a list
function Answer({ text }) {
  const blocks = [];
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    const item = l.match(/^[-•*]\s+(.*)/);
    if (item) {
      const last = blocks[blocks.length - 1];
      if (Array.isArray(last)) last.push(item[1]);
      else blocks.push([item[1]]);
    } else blocks.push(l);
  }
  return blocks.map((b, i) => Array.isArray(b)
    ? <ul key={i}>{b.map((x, j) => <li key={j}>{x}</li>)}</ul>
    : <p key={i}>{b}</p>);
}

function ListingCard({ c, onNavigate }) {
  const [label, cls] = STATUS[c.status] || [];
  return (
    <div className="chat-card">
      <div className="chat-card-top">
        <Icon name={c.type === 'job' ? 'briefcase' : 'cap'} size={15} />
        <strong>{c.title}</strong>
      </div>
      <div className="tiny muted">{[c.org, c.location, c.salary].filter(Boolean).join(' · ')}</div>
      <div className="chat-card-foot">
        {!c.demo && <span className="tag tag-indigo num">{c.score}% fit</span>}
        {label && <span className={`tag ${cls}`}>{label}</span>}
        <span className="grow" />
        <Link to={c.type === 'job' ? '/app/jobs' : '/app/scholarships'} className="tiny" onClick={onNavigate}>View in list</Link>
        <a href={c.url} target="_blank" rel="noreferrer" className="tiny">Official page <Icon name="external" size={12} /></a>
      </div>
    </div>
  );
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState(load);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-30))); } catch { /* storage blocked */ }
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [msgs, busy, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);

  const ask = async (q) => {
    const question = (q ?? text).trim();
    if (!question || busy) return;
    const history = msgs.map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: 'user', content: question }]);
    setText('');
    setBusy(true);
    try {
      const d = await api('/chat', { method: 'POST', body: { message: question, history } });
      setMsgs((m) => [...m, { role: 'assistant', content: d.answer, cards: d.cards, offline: d.offline, outOfScope: d.inScope === false }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: `Something went wrong: ${e.message}`, error: true }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  return (
    <>
      {open && (
        <section className="chat-panel" role="dialog" aria-label="Ask ApplyMate">
          <header className="chat-head">
            <span className="chat-avatar"><Icon name="chat" size={18} /></span>
            <div className="grow">
              <strong>Ask ApplyMate</strong>
              <div className="tiny muted">Scholarships and jobs on this portal</div>
            </div>
            {msgs.length > 0 && (
              <button className="btn btn-quiet btn-icon" onClick={() => setMsgs([])} aria-label="Clear conversation" title="Clear conversation">
                <Icon name="trash" size={17} />
              </button>
            )}
            <button className="btn btn-quiet btn-icon" onClick={() => setOpen(false)} aria-label="Close chat"><Icon name="x" /></button>
          </header>

          <div className="chat-body" ref={listRef} aria-live="polite">
            {msgs.length === 0 && (
              <div className="chat-empty">
                <p>Ask me about the scholarships and jobs listed here: deadlines, eligibility, what fits your profile, or how to apply with the agent.</p>
                <div className="chat-suggest">
                  {SUGGESTIONS.map((s) => <button key={s} onClick={() => ask(s)}>{s}</button>)}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`chat-msg ${m.role} ${m.error ? 'error' : ''} ${m.outOfScope ? 'scope' : ''}`}>
                <div className="chat-bubble">
                  {m.role === 'user' ? m.content : <Answer text={m.content} />}
                </div>
                {m.cards?.length > 0 && (
                  <div className="chat-cards">{m.cards.map((c) => <ListingCard key={c._id} c={c} onNavigate={() => setOpen(false)} />)}</div>
                )}
              </div>
            ))}
            {busy && (
              <div className="chat-msg assistant">
                <div className="chat-bubble chat-typing"><span /><span /><span /> <em className="tiny muted">Reading the listings…</em></div>
              </div>
            )}
          </div>

          <form className="chat-input" onSubmit={(e) => { e.preventDefault(); ask(); }}>
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Ask about a scholarship or job…"
              maxLength={500}
              aria-label="Your question"
            />
            <button className="btn btn-primary btn-icon" disabled={busy || !text.trim()} aria-label="Send"><Icon name="send" /></button>
          </form>
          <div className="chat-foot tiny muted"><Icon name="shield" size={12} /> Answers come from ApplyMate’s assistant and only the listings on ApplyMate. Check dates on the official page.</div>
        </section>
      )}

      <button className={`chat-fab ${open ? 'is-open' : ''}`} onClick={() => setOpen(!open)} aria-label={open ? 'Close chat' : 'Ask ApplyMate'} aria-expanded={open}>
        <Icon name={open ? 'x' : 'chat'} size={24} />
        {!open && <span className="chat-fab-label">Ask ApplyMate</span>}
      </button>
    </>
  );
}
