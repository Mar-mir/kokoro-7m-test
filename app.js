const $ = (id) => document.getElementById(id);
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

const UNSEEN = 'Kokoro-82M voice pack. The 7M student is single-speaker (distilled on af_msa only), so other packs shift prosody slightly but keep the same timbre.';
const VOICES = [
  { id: 'af_msa', label: 'af_msa · trained voice', note: '' },
  { id: 'af_heart', label: 'af_heart · unseen', note: UNSEEN },
  { id: 'af_bella', label: 'af_bella · unseen', note: UNSEEN },
  { id: 'bf_emma', label: 'bf_emma · unseen', note: UNSEEN },
  { id: 'am_michael', label: 'am_michael · unseen', note: UNSEEN },
];
const EXAMPLES = [
  ['Tiny model', 'Kokoro seven M is a tiny text to speech model. It runs right here in your browser, on your own graphics card, with no server in the loop.'],
  ['Numbers', 'In 2024, the team shipped 3 models, raised $3.5 million, and cut latency by 40%.'],
  ['Story', 'The cat sat quietly on the windowsill, watching the birds outside. Then, without warning, it leapt toward the garden and vanished into the tall grass.'],
  ['Question', "Wait, you're telling me this whole voice fits in thirty megabytes? That's smaller than most photos on my phone!"],
];

for (const v of VOICES) $('voice').add(new Option(v.label, v.id));
for (const [label, text] of EXAMPLES) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => { $('text').value = text; speak(); };
  $('examples').append(b);
}
$('voice').onchange = () => { $('voiceNote').textContent = VOICES.find((v) => v.id === $('voice').value).note; };
$('speed').oninput = () => { $('speedVal').textContent = (+$('speed').value).toFixed(2) + '×'; };

let ready = false, busy = false, device = '?', has82 = false, reqId = 0;
const pending = new Map();
const setStatus = (text, state) => { $('statusText').textContent = text; $('dot').className = 'dot ' + (state || ''); };

// ---- download progress ----
const bars = new Map();
const fmt = (b) => (b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : (b / 1e3).toFixed(0) + ' kB');
function progress({ file, loaded, total, cached }) {
  $('progress').hidden = false;
  let el = bars.get(file);
  if (!el) {
    el = document.createElement('div');
    el.className = 'bar';
    el.innerHTML = '<span class="name"></span><span class="n"></span><div class="track"><div class="fill"></div></div>';
    $('progress').append(el); bars.set(file, el);
  }
  el.querySelector('.name').textContent = file;
  el.querySelector('.n').textContent = cached ? `${fmt(total)} · cached` : `${fmt(loaded)} / ${fmt(total)}`;
  el.querySelector('.fill').style.width = (total ? (100 * loaded) / total : 0) + '%';
  if (loaded >= total) {
    el.classList.add('done');
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.remove(); bars.delete(file); if (!bars.size) $('progress').hidden = true; }, 1500);
  }
}

function wavUrl(samples, sr) {
  const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

function request(msg) {
  const id = ++reqId;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ ...msg, id }); });
}

worker.onmessage = ({ data }) => {
  switch (data.type) {
    case 'device': device = data.device; setStatus(`Loading · ${device}`, 'busy'); break;
    case 'progress': progress(data); break;
    case 'loaded': window.__loaded = [...(window.__loaded || []), data]; break;
    case 'ready':
      ready = true; $('go').disabled = false; $('cmp').disabled = false;
      setStatus(device === 'webgpu' ? 'Ready · WebGPU' : 'Ready · WASM (no WebGPU)', 'ok');
      window.__ready = data;
      break;
    case 'chunk': setStatus(`Speaking ${data.done}/${data.total}`, 'busy'); break;
    case 'audio': case 'error': {
      const p = pending.get(data.id);
      if (p) { pending.delete(data.id); data.type === 'audio' ? p.resolve(data) : p.reject(new Error(data.message)); }
      else if (data.type === 'error') setStatus('Error: ' + data.message, 'busy');
      break;
    }
  }
};

function show(res, key) {
  const a = $('audio' + key);
  if (a.src) URL.revokeObjectURL(a.src);
  a.src = wavUrl(res.audio, res.sampleRate);
  a.hidden = false;
  const rtf = res.synthMs / 1000 / res.seconds;
  $('stats' + key).textContent = `${res.seconds.toFixed(2)}s audio · ${Math.round(res.synthMs)} ms · ${(1 / rtf).toFixed(1)}× realtime · ${res.device}`;
  return a;
}

async function speak() {
  if (!ready || busy) return;
  const text = $('text').value.trim();
  if (!text) return;
  busy = true; $('go').disabled = true; $('cmp').disabled = true;
  setStatus('Speaking…', 'busy');
  try {
    const res = await request({ type: 'generate', text, voice: $('voice').value, speed: +$('speed').value, model: '7m' });
    $('outPanel').hidden = false;
    $('phon').textContent = res.phonemes;
    show(res, '7').play().catch(() => {});
    window.__last = { seconds: res.seconds, synthMs: res.synthMs, g2pMs: res.g2pMs, phonemes: res.phonemes, device: res.device, rms: rms(res.audio) };
    if (has82) await compare(false);
    setStatus(device === 'webgpu' ? 'Ready · WebGPU' : 'Ready · WASM', 'ok');
  } catch (e) {
    setStatus('Error: ' + e.message, 'busy');
  } finally {
    busy = false; $('go').disabled = false; $('cmp').disabled = false;
  }
}
const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / Math.max(1, a.length));

async function compare(play = true) {
  const text = $('text').value.trim();
  if (!text) return;
  const wasBusy = busy;
  busy = true; $('go').disabled = true; $('cmp').disabled = true;
  setStatus('Running Kokoro-82M…', 'busy');
  try {
    const res = await request({ type: 'generate', text, voice: $('voice').value === 'af_msa' ? 'af_heart' : $('voice').value, speed: +$('speed').value, model: '82m' });
    has82 = true;
    $('outPanel').hidden = false; $('cmpHead').hidden = false;
    $('cmp').textContent = 'Re-run 82M';
    const a = show(res, '82');
    if (play) a.play().catch(() => {});
    window.__last82 = { seconds: res.seconds, synthMs: res.synthMs, rms: rms(res.audio) };
    setStatus(device === 'webgpu' ? 'Ready · WebGPU' : 'Ready · WASM', 'ok');
  } catch (e) {
    setStatus('Error: ' + e.message, 'busy');
  } finally {
    if (!wasBusy) { busy = false; $('go').disabled = false; $('cmp').disabled = false; }
  }
}

$('go').onclick = speak;
$('cmp').onclick = () => compare(true);
$('text').addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') speak(); });
setStatus('Loading…', 'busy');
worker.postMessage({ type: 'init' });
