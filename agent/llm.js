// llm.js — single entry point for the local LLM (Ollama)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const LLM_URL   = process.env.LLM_URL   || 'http://localhost:11434';
const LLM_MODEL = process.env.LLM_MODEL || 'qwen3:4b';
const LLM_THINK = process.env.LLM_THINK; // "false" for qwen3; leave empty for models without thinking

/**
 * Ask the model and get back parsed JSON that matches `schema`.
 * @param {string} prompt  - put the FIXED text first, the changing text last (prompt caching)
 * @param {object} schema  - JSON schema the answer must follow (keep the answer small!)
 * @param {object} opts    - { system, timeoutMs, retries }
 */
async function askJSON(prompt, schema, { system, timeoutMs = 90000, retries = 1 } = {}) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const body = {
    model: LLM_MODEL,
    stream: false,
    keep_alive: '30m',
    format: schema,
    options: { temperature: 0, num_ctx: 8192 },
    messages,
  };
  if (LLM_THINK !== undefined && LLM_THINK !== '') body.think = LLM_THINK === 'true';

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${LLM_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${await res.text()}`);

      const d = await res.json();
      const data = JSON.parse(d.message.content);

      const s = (ns) => +(ns / 1e9).toFixed(1);
      console.log(`🧠 LLM ${LLM_MODEL}: ${s(d.total_duration)}s ` +
        `(read ${d.prompt_eval_count} tok, wrote ${d.eval_count} tok)`);

      return data;
    } catch (err) {
      const reason = err.name === 'AbortError' ? `timeout after ${timeoutMs / 1000}s` : err.message;
      console.log(`⚠ LLM attempt ${attempt + 1} failed: ${reason}`);
      if (attempt === retries) throw new Error(`LLM failed: ${reason}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Load the model into RAM before the agent starts, so the first real call isn't slow. */
async function warmUp() {
  console.log(`⏳ Loading ${LLM_MODEL}...`);
  await askJSON('Reply with an empty JSON array.', { type: 'array', maxItems: 0 });
  console.log('✅ Model ready');
}

module.exports = { askJSON, warmUp, LLM_MODEL };
