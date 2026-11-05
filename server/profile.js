// profile.js — read/update the user's profile and upload documents
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { requireAuth } = require('./auth');
const { readCv } = require('./cv');
const { normalizeQ } = require('../agent/answers');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DOC_TYPES = ['cv', 'transcript', 'cnicCopy', 'photo', 'passport', 'degree', 'languageCert', 'motivationLetter'];
const SECTIONS = ['personal', 'address', 'education', 'eduMatric', 'eduInter', 'eduBachelor', 'eduMaster', 'languages', 'statements', 'job', 'preferences'];

const router = express.Router();
router.use(requireAuth);

// Profile as the browser sees it (no server file paths)
function publicProfile(p) {
  const obj = p?.toObject ? p.toObject() : p || {};
  const documents = {};
  for (const t of DOC_TYPES) {
    const d = obj.documents?.[t];
    documents[t] = d?.path ? { originalName: d.originalName, uploadedAt: d.uploadedAt } : null;
  }
  const answers = (obj.answers || []).map(({ path: p, ...a }) => ({ ...a, hasFile: !!p }));
  return { ...obj, documents, answers };
}

router.get('/', (req, res) => res.json({ profile: publicProfile(req.user.profile) }));

router.put('/', async (req, res) => {
  const body = req.body || {};
  for (const section of SECTIONS) {
    if (!body[section]) continue;
    for (const [k, v] of Object.entries(body[section])) {
      req.user.set(`profile.${section}.${k}`, typeof v === 'string' ? v.trim() : v);
    }
  }
  await req.user.save();
  res.json({ profile: publicProfile(req.user.profile) });
});

// ---- documents: saved to server/uploads/<userId>/<type>.<ext> ----
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_DIR, req.user._id.toString());
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${req.params.type}${path.extname(file.originalname).toLowerCase()}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const ok = /\.(pdf|docx?|jpe?g|png)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only PDF, Word, JPG or PNG files are allowed.'), ok);
  },
});

router.post('/documents/:type', (req, res) => {
  if (!DOC_TYPES.includes(req.params.type)) return res.status(400).json({ error: 'Unknown document type.' });

  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file received.' });

    // remove an older file of the same type with a different extension
    const old = req.user.profile?.documents?.[req.params.type]?.path;
    if (old && old !== req.file.path && fs.existsSync(old)) fs.unlinkSync(old);

    req.user.set(`profile.documents.${req.params.type}`, {
      path: req.file.path,
      originalName: req.file.originalname,
      uploadedAt: new Date(),
    });
    await req.user.save();
    res.json({ profile: publicProfile(req.user.profile) });
  });
});

// ---- answers to form questions (saved once, reused on every form that asks the same question) ----
function setAnswer(user, { label, kind, value, path: filePath, originalName }) {
  const q = normalizeQ(label);
  if (!q) return;
  const list = (user.profile.answers || []).filter((a) => a.q !== q);
  list.push({ q, label: String(label).replace(/\s*\*\s*$/, '').trim(), kind: kind || 'text', value: value ?? '', path: filePath, originalName, updatedAt: new Date() });
  user.set('profile.answers', list);
}

// POST /api/profile/answers { answers: [{ label, kind, value }] }
router.post('/answers', async (req, res) => {
  for (const a of req.body?.answers || []) {
    if (!a?.label || a.value === undefined || a.value === '') continue;
    setAnswer(req.user, { label: a.label, kind: a.kind, value: String(a.value).trim() });
  }
  await req.user.save();
  res.json({ profile: publicProfile(req.user.profile) });
});

// POST /api/profile/answers/file  (multipart: label, file) -> a document a form asked for
const answerUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOAD_DIR, req.user._id.toString(), 'answers');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^\w.-]+/g, '_')}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(pdf|docx?|jpe?g|png)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only PDF, Word, JPG or PNG files are allowed.'), ok);
  },
});
router.post('/answers/file', (req, res) => {
  answerUpload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file || !req.body?.label) return res.status(400).json({ error: 'A file and the question are needed.' });
    setAnswer(req.user, { label: req.body.label, kind: 'file', value: req.file.originalname, path: req.file.path, originalName: req.file.originalname });
    await req.user.save();
    res.json({ profile: publicProfile(req.user.profile) });
  });
});

// DELETE /api/profile/answers { label }
router.delete('/answers', async (req, res) => {
  const q = normalizeQ(req.body?.label);
  req.user.set('profile.answers', (req.user.profile.answers || []).filter((a) => a.q !== q));
  await req.user.save();
  res.json({ profile: publicProfile(req.user.profile) });
});

// POST /api/profile/cv-import  -> read the uploaded CV and suggest profile values (nothing is saved)
router.post('/cv-import', async (req, res) => {
  const cv = req.user.profile?.documents?.cv?.path;
  if (!cv || !fs.existsSync(cv)) return res.status(400).json({ error: 'Upload your CV first (Documents section), then import from it.' });
  try {
    const result = await readCv(cv);
    // show the current value next to each suggestion so the user can compare
    const current = {};
    for (const key of Object.keys(result.suggestions)) {
      const [s, k] = key.split('.');
      current[key] = req.user.profile?.[s]?.[k] || '';
    }
    res.json({ ...result, current });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/documents/:type', async (req, res) => {
  const d = req.user.profile?.documents?.[req.params.type];
  if (d?.path && fs.existsSync(d.path)) fs.unlinkSync(d.path);
  req.user.set(`profile.documents.${req.params.type}`, undefined);
  await req.user.save();
  res.json({ profile: publicProfile(req.user.profile) });
});

// The profile in the exact shape the agent expects (plain values, absolute file paths)
function agentProfile(user) {
  const p = user.profile?.toObject ? user.profile.toObject() : user.profile || {};
  const out = {};
  for (const s of [...SECTIONS, 'documents']) out[s] = {};
  for (const s of SECTIONS) Object.assign(out[s], p[s] || {});
  for (const t of DOC_TYPES) {
    const d = p.documents?.[t];
    out.documents[t] = d?.path && fs.existsSync(d.path) ? d.path : '';
  }
  out.answers = (p.answers || []).filter((a) => a.kind !== 'file' || (a.path && fs.existsSync(a.path)));
  return out;
}

module.exports = { router, agentProfile, setAnswer, publicProfile };
