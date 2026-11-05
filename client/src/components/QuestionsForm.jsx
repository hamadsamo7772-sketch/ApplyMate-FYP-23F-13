// QuestionsForm — questions a form asked that the profile could not answer.
// The student answers once; ApplyMate saves the answers in the profile and the agent reuses them on
// every form that asks the same thing. Documents are uploaded straight away.
import { useMemo, useState } from 'react';
import { api } from '../api.js';
import Icon from './Icon.jsx';
import { questionParts } from '../questionText.js';

const norm = (s) => String(s || '').toLowerCase().replace(/\*/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 160);

export default function QuestionsForm({ questions, saved = [], submitLabel = 'Save answers', onSubmit, onCancel, cancelLabel, busy }) {
  const savedBy = useMemo(() => Object.fromEntries(saved.map((a) => [a.q || norm(a.label), a])), [saved]);
  // nothing is chosen for the student: a saved answer is shown only when it is one of THIS form's options
  const startValue = (q) => {
    const s = savedBy[norm(q.label)];
    if (!s || s.kind === 'file') return '';
    if (q.kind === 'choice' && q.options?.length) return q.options.includes(s.value) ? s.value : '';
    return s.value || '';
  };
  const [values, setValues] = useState(() => Object.fromEntries(questions.map((q) => [q.label, startValue(q)])));
  const [files, setFiles] = useState({}); // label -> uploaded file name
  const [uploading, setUploading] = useState('');
  const [error, setError] = useState('');

  const set = (label, v) => setValues((s) => ({ ...s, [label]: v }));

  const upload = async (q, file) => {
    if (!file) return;
    setUploading(q.label); setError('');
    try {
      const form = new FormData();
      form.append('label', q.label);
      form.append('file', file);
      await api('/profile/answers/file', { method: 'POST', form });
      setFiles((s) => ({ ...s, [q.label]: file.name }));
    } catch (e) { setError(e.message); } finally { setUploading(''); }
  };

  const hasFile = (q) => files[q.label] || savedBy[norm(q.label)]?.hasFile || savedBy[norm(q.label)]?.path;
  const missing = questions.filter((q) => q.required && !(q.kind === 'file' ? hasFile(q) : String(values[q.label] || '').trim()));

  const submit = (e) => {
    e.preventDefault();
    if (missing.length) return; // every required question needs an answer the student chose
    onSubmit(questions.filter((q) => q.kind !== 'file' && String(values[q.label] || '').trim())
      .map((q) => ({ label: q.label, kind: q.kind, value: values[q.label] })));
  };

  const required = questions.filter((q) => q.required);
  const optional = questions.filter((q) => !q.required);
  // the question in short words; its explanation as small grey text underneath (no field placeholders)
  const field = (q) => {
    const { title, hint } = questionParts(q.label);
    return (
    <div className="q-row" key={q.label}>
      <label className="q-label">
        {title}{q.required && <span className="req"> *</span>}
        {hint && <span className="q-hint">{hint}</span>}
      </label>
      {q.kind === 'file' ? (
        <div className="q-file">
          <label className="btn btn-secondary btn-sm">
            <Icon name="upload" size={15} /> {uploading === q.label ? 'Uploading…' : hasFile(q) ? 'Replace file' : 'Choose file'}
            <input type="file" hidden accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => upload(q, e.target.files[0])} />
          </label>
          {hasFile(q) && <span className="small"><Icon name="check" size={14} /> {files[q.label] || savedBy[norm(q.label)]?.originalName || 'saved'}</span>}
        </div>
      ) : q.kind === 'choice' && q.options?.length ? (
        q.options.length <= 5 ? (
          <div className="q-choices">
            {q.options.map((o) => (
              <label key={o} className="q-choice">
                <input type="radio" name={q.label} checked={values[q.label] === o} onChange={() => set(q.label, o)} /> {o}
              </label>
            ))}
          </div>
        ) : (
          <select value={values[q.label]} onChange={(e) => set(q.label, e.target.value)}>
            <option value="">Choose…</option>
            {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )
      ) : q.kind === 'long' ? (
        <textarea rows={4} value={values[q.label]} onChange={(e) => set(q.label, e.target.value)} />
      ) : (
        <input value={values[q.label]} onChange={(e) => set(q.label, e.target.value)} />
      )}
    </div>
    );
  };

  // documents first, then the questions, grouped by the part of the form they belong to
  const groups = (list) => {
    const out = [];
    const docs = list.filter((q) => q.kind === 'file');
    if (docs.length) out.push(['Documents to upload', docs]);
    const rest = list.filter((q) => q.kind !== 'file');
    const byContext = new Map();
    for (const q of rest) {
      const c = questionParts(q.label).context;
      if (!byContext.has(c)) byContext.set(c, []);
      byContext.get(c).push(q);
    }
    for (const [c, qs] of byContext) out.push([c || (docs.length ? 'Questions' : ''), qs]);
    return out;
  };
  const render = (list) => groups(list).map(([title, qs]) => (
    <div className="q-group" key={title || 'questions'}>
      {title && <h4>{title}</h4>}
      {qs.map(field)}
    </div>
  ));

  return (
    <form className="questions" onSubmit={submit}>
      {render(required)}
      {optional.length > 0 && (
        <details className="q-optional">
          <summary className="small">Optional ({optional.length})</summary>
          {render(optional)}
        </details>
      )}
      {error && <div className="notice notice-error"><Icon name="alert" />{error}</div>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-warn" disabled={busy || !!uploading || missing.length > 0}><Icon name="check" /> {submitLabel}</button>
        {onCancel && <button type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>{cancelLabel || 'Cancel'}</button>}
        {missing.length > 0 && <span className="tiny muted">Please answer the {missing.length} required question{missing.length === 1 ? '' : 's'} first.</span>}
      </div>
    </form>
  );
}
