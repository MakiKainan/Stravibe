// The only code that knows Claude Code's transcript format (internal, may change).
// Every function returns a safe value instead of throwing.
const fs = require('fs');
const path = require('path');

function withSubagents(tps) {
  const out = [...tps];
  for (const tp of tps) {
    const dir = path.join(tp.replace(/\.jsonl$/, ''), 'subagents');
    try {
      for (const f of fs.readdirSync(dir).sort()) if (/^agent-.*\.jsonl$/.test(f)) out.push(path.join(dir, f));
    } catch {}
  }
  return out;
}

function readTranscripts(paths) {
  const seen = new Set();
  const models = {};
  let tokens = 0;
  for (const p of paths) {
    let text;
    try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      const m = r?.type === 'assistant' && r.message;
      if (!m?.id || !m.usage || seen.has(m.id)) continue;
      seen.add(m.id);
      const u = m.usage;
      tokens += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
      if (m.model) models[m.model] = (models[m.model] || 0) + 1;
    }
  }
  return seen.size ? { tokens, models } : null;
}

module.exports = { readTranscripts, withSubagents };
