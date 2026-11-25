import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.webgpu.bundle.min.mjs';
import { phonemize as espeak } from 'https://cdn.jsdelivr.net/npm/phonemizer@1.2.1/dist/phonemizer.js';
import { Lexicon, G2P } from './misaki.js';

ort.env.wasm.numThreads = 1; // no COOP/COEP on the Space; WebGPU does the heavy lifting
ort.env.logLevel = 'error';

const HF = 'https://huggingface.co';
const MODELS = {
  '7m': {
    repo: 'mrfakename/Kokoro-7M-Distill-ONNX',
    files: { webgpu: 'onnx/model.onnx', wasm: 'onnx/model.onnx' },
    voiceUrl: (v) => `${HF}/mrfakename/Kokoro-7M-Distill-ONNX/resolve/main/voices/${v}.bin`,
  },
  '82m': {
    repo: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    files: { webgpu: 'onnx/model_quantized.onnx', wasm: 'onnx/model_quantized.onnx' },
    // The 82M fp16 graph yields NaNs on WebGPU and its int8 graph ping-pongs to CPU there,
    // so the (optional) comparison model runs int8 on WASM.
    forceWasm: true,
    voiceUrl: (v) => `${HF}/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/${v}.bin`,
  },
};
// Voices the 7M student ships with; any other id is fetched from the 82M voice set.
const LOCAL_7M_VOICES = new Set(['af_msa', 'af_heart']);

const CACHE = 'kokoro-7m-webgpu-v1';
const post = (type, data = {}) => self.postMessage({ type, ...data });

async function fetchCached(url, key, onProgress) {
  let cache = null;
  try { cache = await caches.open(CACHE); } catch {}
  if (cache) {
    const hit = await cache.match(url);
    if (hit) {
      const buf = await hit.arrayBuffer();
      onProgress?.(key, buf.byteLength, buf.byteLength, true);
      return buf;
    }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  const total = +res.headers.get('content-length') || 0;
  const reader = res.body.getReader();
  const chunks = []; let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); loaded += value.byteLength;
    onProgress?.(key, loaded, total || loaded, false);
  }
  const buf = new Uint8Array(loaded); let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.byteLength; }
  onProgress?.(key, loaded, loaded, false);
  if (cache) { try { await cache.put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } })); } catch {} }
  return buf.buffer;
}

const progress = (file, loaded, total, cached) => post('progress', { file, loaded, total, cached });

let g2p = null, device = null;
const sessions = {}; // '7m' | '82m' -> InferenceSession
const voices = {};   // `${model}:${voice}` -> Float32Array(510*256)

async function initG2P() {
  const buf = await fetchCached(new URL('./assets/us_lexicon.json.gz', import.meta.url).href, 'lexicon', progress);
  let bytes = new Uint8Array(buf);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  }
  const lex = JSON.parse(new TextDecoder().decode(bytes));
  g2p = new G2P(new Lexicon(lex.gold, lex.silver), async (t) => (await espeak(t, 'en-us')).join(' '));
  await espeak('warm up', 'en-us');
}

async function pickDevice() {
  if (device) return device;
  try {
    if (navigator.gpu && (await navigator.gpu.requestAdapter())) return (device = 'webgpu');
  } catch {}
  return (device = 'wasm');
}

async function loadModel(key) {
  if (sessions[key]) return sessions[key];
  const dev = await pickDevice();
  const m = MODELS[key];
  const file = m.files[dev];
  const t0 = performance.now();
  const buf = await fetchCached(`${HF}/${m.repo}/resolve/main/${file}`, `${key}:${file.split('/').pop()}`, progress);
  const t1 = performance.now();
  sessions[key] = await ort.InferenceSession.create(new Uint8Array(buf), {
    executionProviders: dev === 'webgpu' && !m.forceWasm ? ['webgpu', 'wasm'] : ['wasm'],
    graphOptimizationLevel: 'all',
  });
  post('loaded', { model: key, device: m.forceWasm ? 'wasm' : dev, file, downloadMs: t1 - t0, initMs: performance.now() - t1 });
  return sessions[key];
}

async function loadVoice(model, voice) {
  const id = `${model}:${voice}`;
  if (voices[id]) return voices[id];
  const url = model === '7m' && LOCAL_7M_VOICES.has(voice) ? MODELS['7m'].voiceUrl(voice) : MODELS['82m'].voiceUrl(voice);
  const buf = await fetchCached(url, `voice:${voice}`, progress);
  return (voices[id] = new Float32Array(buf));
}

const VOCAB = {";": 1, ":": 2, ",": 3, ".": 4, "!": 5, "?": 6, "—": 9, "…": 10, "\"": 11, "(": 12, ")": 13, "“": 14, "”": 15, " ": 16, "̃": 17, "ʣ": 18, "ʥ": 19, "ʦ": 20, "ʨ": 21, "ᵝ": 22, "ꭧ": 23, "A": 24, "I": 25, "O": 31, "Q": 33, "S": 35, "T": 36, "W": 39, "Y": 41, "ᵊ": 42, "a": 43, "b": 44, "c": 45, "d": 46, "e": 47, "f": 48, "h": 50, "i": 51, "j": 52, "k": 53, "l": 54, "m": 55, "n": 56, "o": 57, "p": 58, "q": 59, "r": 60, "s": 61, "t": 62, "u": 63, "v": 64, "w": 65, "x": 66, "y": 67, "z": 68, "ɑ": 69, "ɐ": 70, "ɒ": 71, "æ": 72, "β": 75, "ɔ": 76, "ɕ": 77, "ç": 78, "ɖ": 80, "ð": 81, "ʤ": 82, "ə": 83, "ɚ": 85, "ɛ": 86, "ɜ": 87, "ɟ": 90, "ɡ": 92, "ɥ": 99, "ɨ": 101, "ɪ": 102, "ʝ": 103, "ɯ": 110, "ɰ": 111, "ŋ": 112, "ɳ": 113, "ɲ": 114, "ɴ": 115, "ø": 116, "ɸ": 118, "θ": 119, "œ": 120, "ɹ": 123, "ɾ": 125, "ɻ": 126, "ʁ": 128, "ɽ": 129, "ʂ": 130, "ʃ": 131, "ʈ": 132, "ʧ": 133, "ʊ": 135, "ʋ": 136, "ʌ": 138, "ɣ": 139, "ɤ": 140, "χ": 142, "ʎ": 143, "ʒ": 147, "ʔ": 148, "ˈ": 156, "ˌ": 157, "ː": 158, "ʰ": 162, "ʲ": 164, "↓": 169, "→": 171, "↗": 172, "↘": 173, "ᵻ": 177};
const MAX_TOKENS = 510;

// Split text into sentence-ish chunks so each fits the 510-token context.
function splitText(text) {
  const raw = text.replace(/\r/g, '').split(/\n+/).flatMap((p) => p.split(/(?<=[.!?…]["”’)]*)\s+(?=\S)/)).map((s) => s.trim()).filter(Boolean);
  const parts = [];
  for (const r of raw) {
    if (parts.length && /\b(Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|etc|e\.g|i\.e|No)\.$/i.test(parts.at(-1))) parts[parts.length - 1] += ' ' + r;
    else parts.push(r);
  }
  return parts;
}
function chunkPhonemes(ps) {
  const out = [];
  while ([...ps].length > MAX_TOKENS - 2) {
    const arr = [...ps].slice(0, MAX_TOKENS - 2);
    let cut = Math.max(arr.lastIndexOf(','), arr.lastIndexOf(';'), arr.lastIndexOf(':'));
    if (cut < 50) cut = arr.lastIndexOf(' ');
    if (cut < 1) cut = arr.length - 1;
    out.push(arr.slice(0, cut + 1).join('').trim());
    ps = [...ps].slice(cut + 1).join('').trim();
  }
  if (ps) out.push(ps);
  return out;
}

async function synth(model, ps, pack, speed) {
  const ids = [...ps].map((c) => VOCAB[c]).filter((x) => x !== undefined);
  const n = Math.min(ids.length, MAX_TOKENS - 2);
  const input = BigInt64Array.from([0, ...ids.slice(0, n), 0].map(BigInt));
  const style = pack.slice(Math.max(0, n - 1) * 256, Math.max(1, n) * 256);
  const sess = sessions[model];
  const out = await sess.run({
    input_ids: new ort.Tensor('int64', input, [1, input.length]),
    style: new ort.Tensor('float32', style, [1, 256]),
    speed: new ort.Tensor('float32', new Float32Array([speed]), [1]),
  });
  return out.waveform.data;
}

async function generate({ text, voice, speed, model, id }) {
  await loadModel(model);
  const pack = await loadVoice(model, voice);
  const tG = performance.now();
  const sentences = splitText(text);
  const chunks = [];
  // pack whole sentences into as few model calls as possible (each call <= ~400 tokens)
  for (const s of sentences) {
    for (const c of chunkPhonemes(await g2p.phonemize(s))) {
      const last = chunks.at(-1);
      if (last && [...last].length + [...c].length + 1 <= 400) chunks[chunks.length - 1] = last + ' ' + c;
      else chunks.push(c);
    }
  }
  const g2pMs = performance.now() - tG;
  const audio = [];
  let samples = 0;
  const t0 = performance.now();
  const gap = new Float32Array(Math.round(24000 * 0.08));
  for (let i = 0; i < chunks.length; i++) {
    const wav = await synth(model, chunks[i], pack, speed);
    audio.push(wav); samples += wav.length;
    if (i < chunks.length - 1) { audio.push(gap); samples += gap.length; }
    post('chunk', { id, done: i + 1, total: chunks.length });
  }
  const synthMs = performance.now() - t0;
  const merged = new Float32Array(samples); let o = 0;
  for (const a of audio) { merged.set(a, o); o += a.length; }
  post('audio', { id, model, audio: merged, sampleRate: 24000, phonemes: chunks.join(' '), g2pMs, synthMs, seconds: samples / 24000, device: MODELS[model].forceWasm ? 'wasm' : device }, [merged.buffer]);
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      const dev = await pickDevice();
      post('device', { device: dev });
      await Promise.all([initG2P(), loadModel('7m'), loadVoice('7m', 'af_msa')]);
      // warm-up pass so the first real request does not pay shader compilation
      const t = performance.now();
      await synth('7m', 'hˈɛlO.', voices['7m:af_msa'], 1);
      post('ready', { device: dev, warmupMs: performance.now() - t });
    } else if (data.type === 'generate') {
      await generate(data);
    } else if (data.type === 'phonemize') {
      post('phonemes', { phonemes: await g2p.phonemize(data.text) });
    }
  } catch (e) {
    post('error', { message: String(e?.message || e), id: data.id });
  }
};
