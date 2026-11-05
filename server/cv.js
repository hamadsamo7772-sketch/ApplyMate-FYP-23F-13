// cv.js — read a CV (PDF or Word) and suggest profile values from it.
//
// 1. The file's text is extracted on this computer (pdf-parse / mammoth).
// 2. Simple patterns find the obvious things (email, phone, CNIC) — works even without the AI.
// 3. The local LLM (Ollama) reads the text and fills the rest of the profile fields.
// The user reviews every suggestion before anything is saved. Nothing leaves this computer.

const fs = require('fs');
const path = require('path');

const FIELDS = {
  'personal.fullName': 'full name of the CV owner',
  'personal.firstName': 'first name',
  'personal.lastName': 'last name / surname',
  'personal.fatherName': "father's name (only if written in the CV)",
  'personal.gender': 'Male, Female or Other (only if written)',
  'personal.dateOfBirth': 'date of birth as YYYY-MM-DD (only if written)',
  'personal.email': 'email address',
  'personal.phone': 'phone number',
  'personal.cnic': 'Pakistani CNIC number 12345-1234567-1 (only if written)',
  'personal.nationality': 'nationality (only if written)',
  'address.street': 'postal address',
  'address.city': 'city',
  'address.province': 'province / state',
  'address.country': 'country',
  'education.lastDegree': 'highest or most recent degree, e.g. "BS Computer Science"',
  'education.institution': 'university / institution of that degree',
  'education.cgpa': 'CGPA or percentage of that degree',
  'job.currentTitle': 'current or most recent job title',
  'job.experienceYears': 'total years of work experience as a number',
  'preferences.studyField': 'main field of study, e.g. "computer science"',
  'preferences.jobKeywords': '3 to 5 job titles or skills that fit this person, comma separated',
};

// OCR (Tesseract, runs offline): for CVs whose text is really a picture —
// scanned pages, phone photos, or PDFs from Canva / "print to PDF" without real text.
async function ocrImages(images) {
  const { createWorker } = require('tesseract.js');
  const langPath = path.join(path.dirname(require.resolve('@tesseract.js-data/eng')), '4.0.0_best_int');
  const cachePath = path.join(__dirname, '..', '.ocr-cache');
  fs.mkdirSync(cachePath, { recursive: true });
  const worker = await createWorker('eng', 1, { langPath, cachePath, gzip: true, logger: () => {} });
  try {
    const out = [];
    for (const img of images) out.push((await worker.recognize(img)).data.text);
    return out.join('\n');
  } finally {
    await worker.terminate();
  }
}

async function pdfPagesAsImages(doc, maxPages = 3) {
  const { createCanvas } = require('@napi-rs/canvas');
  const images = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2.5 }); // ~180 dpi: sharp enough for OCR
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push(canvas.toBuffer('image/png'));
  }
  return images;
}

/** Returns { text, method: 'text' | 'ocr' | 'word' } */
async function extractText(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.pdf') {
    // Mozilla pdf.js (the PDF reader inside Firefox) — reads almost any text PDF
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(fs.readFileSync(file)),
      useSystemFonts: true,
      // font files pdf.js needs to draw text when a page is turned into an image for OCR
      standardFontDataUrl: path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep,
      verbosity: 0,
    }).promise;
    try {
      const pages = [];
      for (let i = 1; i <= Math.min(doc.numPages, 6); i++) {
        const content = await (await doc.getPage(i)).getTextContent();
        // keep line breaks: a new line starts when the text moves down the page
        let lastY = null;
        let text = '';
        for (const item of content.items) {
          const y = item.transform?.[5];
          if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) text += '\n';
          text += item.str + (item.hasEOL ? '\n' : '');
          lastY = y;
        }
        pages.push(text);
      }
      const text = pages.join('\n');
      // real words found -> done; otherwise the page is a picture, so read it with OCR
      if ((text.match(/[A-Za-z]{3,}/g) || []).length >= 15) return { text, method: 'text' };
      console.log(`[cv] ${path.basename(file)}: no text layer (${text.trim().length} chars), using OCR`);
      return { text: await ocrImages(await pdfPagesAsImages(doc)), method: 'ocr' };
    } finally {
      await doc.destroy();
    }
  }
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const { value } = await mammoth.extractRawText({ path: file });
    return { text: value || '', method: 'word' };
  }
  if (['.png', '.jpg', '.jpeg'].includes(ext)) {
    return { text: await ocrImages([fs.readFileSync(file)]), method: 'ocr' };
  }
  throw new Error('CV import works with PDF, Word (.docx), JPG or PNG files.');
}

// Patterns that don't need AI
function quickFacts(text) {
  const out = {};
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (email) out['personal.email'] = email[0];
  const phone = text.match(/(\+92[\s-]?3\d{2}[\s-]?\d{7}|03\d{2}[\s-]?\d{7})/);
  if (phone) out['personal.phone'] = phone[0].replace(/[\s-]/g, '');
  const cnic = text.match(/\b\d{5}-\d{7}-\d\b/);
  if (cnic) out['personal.cnic'] = cnic[0];
  const cgpa = text.match(/CGPA[:\s]*([0-4]\.\d{1,2})/i);
  if (cgpa) out['education.cgpa'] = cgpa[1];
  return out;
}

async function aiFacts(text) {
  const { askJSON } = require('../agent/llm');
  const keys = Object.keys(FIELDS);
  const schema = {
    type: 'object',
    properties: Object.fromEntries(keys.map((k) => [k, { type: 'string' }])),
  };
  const prompt = `Extract profile information from this CV.
Return a JSON object with these keys. Use "" (empty) for anything the CV does not clearly state. Never guess.
${keys.map((k) => `- ${k}: ${FIELDS[k]}`).join('\n')}

CV TEXT:
${text.slice(0, 6000)}`;
  return askJSON(prompt, schema, { timeoutMs: 180000, retries: 0 });
}

/** Returns { suggestions: { "personal.email": "...", ... }, usedAI, note } */
async function readCv(file) {
  const { text: raw, method } = await extractText(file);
  const text = raw.replace(/\r/g, '').trim();
  if (text.length < 40) {
    throw new Error('Could not read any text from this CV, even with OCR. Try a clearer scan, or a PDF exported from Word or Google Docs.');
  }

  const suggestions = quickFacts(text);
  let usedAI = false;
  let note = '';
  try {
    const ai = await aiFacts(text);
    for (const [k, v] of Object.entries(ai || {})) {
      const val = String(v || '').trim();
      if (val && FIELDS[k] && !suggestions[k]) suggestions[k] = val;
    }
    usedAI = true;
  } catch (err) {
    note = `The local AI model is not available (${err.message.split('\n')[0]}), so only email, phone, CNIC and CGPA were read. Start Ollama and try again for the full import.`;
  }
  if (method === 'ocr') {
    note = [note, 'This CV is an image, so its text was read with OCR. Check each value carefully, especially numbers.'].filter(Boolean).join(' ');
  }
  return { suggestions, usedAI, note, labels: FIELDS, method };
}

module.exports = { readCv, extractText, quickFacts };
