// misaki-lite: a JavaScript port of the US-English path of hexgrad/misaki (en.G2P + EspeakFallback),
// the front-end Kokoro-82M and Kokoro-7M-Distill were trained on. spaCy POS tagging is replaced by
// a few context heuristics; the gold/silver lexicons and all lookup/stemming/stress rules are ported.
// Out-of-vocabulary words go through espeak-ng (phonemizer.js) with misaki's E2M mapping.

const PRIMARY = 'ˈ', SECONDARY = 'ˌ', STRESSES = 'ˌˈ';
const VOWELS = new Set('AIOQWYaiuæɑɒɔəɛɜɪʊʌᵻ');
const CONSONANTS = new Set('bdfhjklmnpstvwzðŋɡɹɾʃʒʤʧθ');
const US_TAUS = new Set('AIOWYiuæɑəɛɪɹʊʌ');
const DIPHTHONGS = new Set('AIOQWYʤʧ');
const PUNCTS = new Set(';:,.!?—…"“”');
const NON_QUOTE_PUNCTS = new Set(';:,.!?—…');
const SUBTOKEN_JUNKS = new Set("',-._‘’/");
const CURRENCIES = { '$': ['dollar', 'cent'], '£': ['pound', 'pence'], '€': ['euro', 'cent'] };
const ORDINALS = new Set(['st', 'nd', 'rd', 'th']);
const SYMBOLS = { '%': 'percent', '&': 'and', '+': 'plus', '@': 'at' };
const NUM_WORDS = new Set(['hundred', 'thousand', 'million', 'billion', 'trillion', 'dozen']);
const DETERMINERS = new Set(['the', 'a', 'an', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'this', 'that', 'these', 'those', 'some', 'any', 'no', 'every', 'each']);
const VERB_CUES = new Set(['to', 'will', 'would', 'can', 'could', 'should', 'shall', 'may', 'might', 'must', "don't", "doesn't", "didn't", "won't", "can't", 'i', 'we', 'you', 'they', 'please', 'lets', "let's"]);

const isAlpha = (s) => /^\p{L}+$/u.test(s);
const isDigit = (s) => /^[0-9]+$/.test(s);
const isLexChar = (c) => /[A-Za-z'\-]/.test(c);
const lower = (s) => s.toLowerCase();
const upper = (s) => s.toUpperCase();
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

function restress(ps) {
  const ips = [...ps].map((p, i) => [i, p]);
  for (let i = 0; i < ips.length; i++) {
    if (STRESSES.includes(ips[i][1])) {
      let j = i; while (j < ips.length && !VOWELS.has(ips[j][1])) j++;
      if (j < ips.length) ips[i] = [j - 0.5, ips[i][1]];
    }
  }
  return ips.sort((a, b) => a[0] - b[0]).map((x) => x[1]).join('');
}

export function applyStress(ps, stress) {
  if (stress == null || ps == null) return ps;
  const hasP = ps.includes(PRIMARY), hasS = ps.includes(SECONDARY);
  const hasV = [...ps].some((c) => VOWELS.has(c));
  if (stress < -1) return ps.replaceAll(PRIMARY, '').replaceAll(SECONDARY, '');
  if (stress === -1 || ((stress === 0 || stress === -0.5) && hasP))
    return ps.replaceAll(SECONDARY, '').replaceAll(PRIMARY, SECONDARY);
  if ((stress === 0 || stress === 0.5 || stress === 1) && !hasP && !hasS)
    return hasV ? restress(SECONDARY + ps) : ps;
  if (stress >= 1 && !hasP && hasS) return ps.replaceAll(SECONDARY, PRIMARY);
  if (stress > 1 && !hasP && !hasS) return hasV ? restress(PRIMARY + ps) : ps;
  return ps;
}

const stressWeight = (ps) => (ps ? [...ps].reduce((a, c) => a + (DIPHTHONGS.has(c) ? 2 : 1), 0) : 0);

// ---------------- num2words (English) ----------------
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
function under1000(n) {
  const out = [];
  if (n >= 100) { out.push(ONES[Math.floor(n / 100)] + ' hundred'); n %= 100; if (n) out.push('and'); }
  if (n >= 20) out.push(TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : ''));
  else if (n > 0 || !out.length) out.push(ONES[n]);
  return out.join(' ');
}
export function cardinal(n) {
  n = Math.floor(n);
  if (n < 0) return 'minus ' + cardinal(-n);
  if (n < 1000) return under1000(n);
  const parts = [];
  for (const [v, name] of SCALES) {
    if (n >= v) { parts.push(cardinal(Math.floor(n / v)) + ' ' + name); n %= v; }
  }
  if (n) parts.push((n < 100 ? 'and ' : '') + under1000(n));
  return parts.join(', ').replace(', and', ' and');
}
const ORD_IRREG = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
export function ordinal(n) {
  const c = cardinal(n);
  const m = c.match(/([a-z]+)$/);
  const last = m[1];
  let o;
  if (ORD_IRREG[last]) o = ORD_IRREG[last];
  else if (last.endsWith('y')) o = last.slice(0, -1) + 'ieth';
  else o = last + 'th';
  return c.slice(0, -last.length) + o;
}
export function year(n) {
  if (n % 1000 < 10 && n % 1000 !== 0 && n >= 2000 && n < 2010) return cardinal(n);
  if (n % 100 === 0 && n % 1000 !== 0) return cardinal(n / 100) + ' hundred';
  if (n % 1000 === 0) return cardinal(n);
  const hi = Math.floor(n / 100), lo = n % 100;
  return cardinal(hi) + ' ' + (lo < 10 ? 'oh-' + ONES[lo] : cardinal(lo));
}
function floatWords(s) {
  const [a, b] = s.split('.');
  return cardinal(parseInt(a || '0', 10)) + ' point ' + [...b].map((d) => ONES[+d]).join(' ');
}

// ---------------- Lexicon ----------------
export class Lexicon {
  constructor(gold, silver) {
    this.golds = Lexicon.grow(gold);
    this.silvers = Lexicon.grow(silver);
    this.capStresses = [0.5, 2];
  }
  static grow(d) {
    const e = {};
    for (const [k, v] of Object.entries(d)) {
      if (k.length < 2) continue;
      if (k === lower(k)) { if (k !== capitalize(k)) e[capitalize(k)] = v; }
      else if (k === capitalize(k)) e[lower(k)] = v;
    }
    return Object.assign(e, d);
  }
  has(d, w) { return Object.prototype.hasOwnProperty.call(d, w); }
  getNNP(word) {
    const ps = [];
    for (const c of word) {
      if (!isAlpha(c)) continue;
      const p = this.has(this.golds, upper(c)) ? this.golds[upper(c)] : null;
      if (p == null || typeof p !== 'string') return [null, null];
      ps.push(p);
    }
    let s = applyStress(ps.join(''), 0);
    const i = s.lastIndexOf(SECONDARY);
    if (i >= 0) s = s.slice(0, i) + PRIMARY + s.slice(i + 1);
    return [s, 3];
  }
  getSpecial(word, tag, stress, ctx) {
    if (this.has(SYMBOLS, word)) return this.lookup(SYMBOLS[word], null, null, ctx);
    const stripped = word.replace(/^\.+|\.+$/g, '');
    if (stripped.includes('.') && isAlpha(word.replaceAll('.', '')) && Math.max(...word.split('.').map((x) => x.length)) < 3) return this.getNNP(word);
    if (word === 'a' || word === 'A') return [tag === 'DT' ? 'ɐ' : 'ˈA', 4];
    if (['am', 'Am', 'AM'].includes(word)) {
      if (ctx.futureVowel == null || word !== 'am' || (stress && stress > 0)) return [this.golds['am'], 4];
      return ['ɐm', 4];
    }
    if (['an', 'An', 'AN'].includes(word)) return ['ɐn', 4];
    if (word === 'I') return [SECONDARY + 'I', 4];
    if (['by', 'By', 'BY'].includes(word) && tag === 'ADV') return ['bˈI', 4];
    if (word === 'to' || word === 'To' || word === 'TO') {
      const t = this.golds['to'];
      return [ctx.futureVowel == null ? t : ctx.futureVowel ? 'tʊ' : 'tə', 4];
    }
    if (word === 'in' || word === 'In' || word === 'IN') return [(ctx.futureVowel == null || tag !== 'IN' ? PRIMARY : '') + 'ɪn', 4];
    if (word === 'the' || word === 'The' || word === 'THE') return [ctx.futureVowel === true ? 'ði' : 'ðə', 4];
    if (/^vs\.?$/i.test(word)) return this.lookup('versus', null, null, ctx);
    if (['used', 'Used', 'USED'].includes(word)) {
      const u = this.golds['used'];
      return [ctx.futureTo ? u['VBD'] : u['DEFAULT'], 4];
    }
    return [null, null];
  }
  static parentTag(tag) {
    if (tag == null) return tag;
    if (tag.startsWith('VB')) return 'VERB';
    if (tag.startsWith('NN')) return 'NOUN';
    if (tag.startsWith('ADV') || tag.startsWith('RB')) return 'ADV';
    if (tag.startsWith('ADJ') || tag.startsWith('JJ')) return 'ADJ';
    return tag;
  }
  isKnown(word) {
    if (this.has(this.golds, word) || this.has(SYMBOLS, word) || this.has(this.silvers, word)) return true;
    if (!isAlpha(word) || ![...word].every((c) => /[A-Za-z']/.test(c))) return false;
    if (word.length === 1) return true;
    if (word === upper(word) && this.has(this.golds, lower(word))) return true;
    return word.slice(1) === upper(word.slice(1));
  }
  lookup(word, tag, stress, ctx) {
    let isNNP = null;
    if (word === upper(word) && !this.has(this.golds, word)) { word = lower(word); isNNP = tag === 'NNP'; }
    let ps = this.has(this.golds, word) ? this.golds[word] : null, rating = 4;
    if (ps == null && !isNNP) { ps = this.has(this.silvers, word) ? this.silvers[word] : null; rating = 3; }
    if (ps && typeof ps === 'object') {
      if (ctx && ctx.futureVowel == null && 'None' in ps) tag = 'None';
      else if (!(tag in ps)) tag = Lexicon.parentTag(tag);
      ps = tag in ps ? ps[tag] : ps['DEFAULT'];
    }
    if (ps == null || (isNNP && !ps.includes(PRIMARY))) {
      const [p, r] = this.getNNP(word);
      if (p != null) return [p, r];
    }
    return [applyStress(ps, stress), rating];
  }
  _s(stem) {
    if (!stem) return null;
    const l = stem.at(-1);
    if ('ptkfθ'.includes(l)) return stem + 's';
    if ('szʃʒʧʤ'.includes(l)) return stem + 'ᵻz';
    return stem + 'z';
  }
  stemS(word, tag, stress, ctx) {
    if (word.length < 3 || !word.endsWith('s')) return [null, null];
    let stem;
    if (!word.endsWith('ss') && this.isKnown(word.slice(0, -1))) stem = word.slice(0, -1);
    else if ((word.endsWith("'s") || (word.length > 4 && word.endsWith('es') && !word.endsWith('ies'))) && this.isKnown(word.slice(0, -2))) stem = word.slice(0, -2);
    else if (word.length > 4 && word.endsWith('ies') && this.isKnown(word.slice(0, -3) + 'y')) stem = word.slice(0, -3) + 'y';
    else return [null, null];
    const [p, r] = this.lookup(stem, tag, stress, ctx);
    return [this._s(p), r];
  }
  _ed(stem) {
    if (!stem) return null;
    const l = stem.at(-1);
    if ('pkfθʃsʧ'.includes(l)) return stem + 't';
    if (l === 'd') return stem + 'ᵻd';
    if (l !== 't') return stem + 'd';
    if (stem.length < 2) return stem + 'ɪd';
    if (US_TAUS.has(stem.at(-2))) return stem.slice(0, -1) + 'ɾᵻd';
    return stem + 'ᵻd';
  }
  stemEd(word, tag, stress, ctx) {
    if (word.length < 4 || !word.endsWith('d')) return [null, null];
    let stem;
    if (!word.endsWith('dd') && this.isKnown(word.slice(0, -1))) stem = word.slice(0, -1);
    else if (word.length > 4 && word.endsWith('ed') && !word.endsWith('eed') && this.isKnown(word.slice(0, -2))) stem = word.slice(0, -2);
    else return [null, null];
    const [p, r] = this.lookup(stem, tag, stress, ctx);
    return [this._ed(p), r];
  }
  _ing(stem) {
    if (!stem) return null;
    if (stem.length > 1 && stem.at(-1) === 't' && US_TAUS.has(stem.at(-2))) return stem.slice(0, -1) + 'ɾɪŋ';
    return stem + 'ɪŋ';
  }
  stemIng(word, tag, stress, ctx) {
    if (word.length < 5 || !word.endsWith('ing')) return [null, null];
    let stem;
    if (word.length > 5 && this.isKnown(word.slice(0, -3))) stem = word.slice(0, -3);
    else if (this.isKnown(word.slice(0, -3) + 'e')) stem = word.slice(0, -3) + 'e';
    else if (word.length > 5 && /([bcdgklmnprstvxz])\1ing$|cking$/.test(word) && this.isKnown(word.slice(0, -4))) stem = word.slice(0, -4);
    else return [null, null];
    const [p, r] = this.lookup(stem, tag, stress, ctx);
    return [this._ing(p), r];
  }
  getWord(word, tag, stress, ctx) {
    let [ps, rating] = this.getSpecial(word, tag, stress, ctx);
    if (ps != null) return [ps, rating];
    const wl = lower(word);
    if (word.length > 1 && isAlpha(word.replaceAll("'", '')) && word !== wl && (tag !== 'NNP' || word.length > 7) &&
        !this.has(this.golds, word) && !this.has(this.silvers, word) && (word === upper(word) || word.slice(1) === lower(word.slice(1))) &&
        (this.has(this.golds, wl) || this.has(this.silvers, wl) || [this.stemS, this.stemEd, this.stemIng].some((fn) => fn.call(this, wl, tag, stress, ctx)[0]))) {
      word = wl;
    }
    if (this.isKnown(word)) return this.lookup(word, tag, stress, ctx);
    if (word.endsWith("s'") && this.isKnown(word.slice(0, -2) + "'s")) return this.lookup(word.slice(0, -2) + "'s", tag, stress, ctx);
    if (word.endsWith("'") && this.isKnown(word.slice(0, -1))) return this.lookup(word.slice(0, -1), tag, stress, ctx);
    let r = this.stemS(word, tag, stress, ctx); if (r[0] != null) return r;
    r = this.stemEd(word, tag, stress, ctx); if (r[0] != null) return r;
    r = this.stemIng(word, tag, stress == null ? 0.5 : stress, ctx); if (r[0] != null) return r;
    return [null, null];
  }
  static isCurrency(word) {
    if (!word.includes('.')) return true;
    if (word.split('.').length > 2) return false;
    return word.split('.')[1].length < 3;
  }
  getNumber(word, currency) {
    const sm = word.match(/[a-z']+$/);
    const suffix = sm ? sm[0] : null;
    if (suffix) word = word.slice(0, -suffix.length);
    const result = [];
    if (word.startsWith('-')) { result.push(this.lookup('minus', null, null, null)); word = word.slice(1); }
    const extend = (s) => {
      for (const w of s.split(/[^a-z]+/)) {
        if (!w || w === 'and') continue;
        result.push(this.lookup(w, null, w === 'point' ? -2 : null, null));
      }
    };
    if (isDigit(word) && ORDINALS.has(suffix)) extend(ordinal(+word));
    else if (!result.length && word.length === 4 && !(currency in CURRENCIES) && isDigit(word)) extend(year(+word));
    else if (word.split('.').length > 2) {
      for (const n of word.replaceAll(',', '').split('.')) {
        if (!n) continue;
        if (n[0] === '0' || (n.length !== 2 && [...n.slice(1)].some((d) => d !== '0'))) for (const d of n) extend(cardinal(+d));
        else extend(cardinal(+n));
      }
    } else if (currency in CURRENCIES && Lexicon.isCurrency(word)) {
      let pairs = word.replaceAll(',', '').split('.').map((n, i) => [n ? parseInt(n, 10) : 0, CURRENCIES[currency][i]]).slice(0, 2);
      if (pairs.length > 1) { if (pairs[1][0] === 0) pairs = pairs.slice(0, 1); else if (pairs[0][0] === 0) pairs = pairs.slice(1); }
      pairs.forEach(([num, unit], i) => {
        if (i > 0) result.push(this.lookup('and', null, null, null));
        extend(cardinal(num));
        result.push(Math.abs(num) !== 1 && unit !== 'pence' ? this.stemS(unit + 's', null, null, null) : this.lookup(unit, null, null, null));
      });
    } else {
      const clean = word.replaceAll(',', '');
      if (isDigit(clean)) extend(ORDINALS.has(suffix) ? ordinal(+clean) : cardinal(+clean));
      else if (clean.startsWith('.')) extend('point ' + [...clean.slice(1)].map((d) => ONES[+d]).join(' '));
      else if (/^\d+\.\d+$/.test(clean)) extend(floatWords(clean));
      else return [null, null];
    }
    if (!result.length || result.some(([p]) => p == null)) return [null, null];
    let ps = result.map(([p]) => p).join(' ');
    const rating = Math.min(...result.map(([, r]) => r));
    if (suffix === 's' || suffix === "'s") ps = this._s(ps);
    else if (suffix === 'ed' || suffix === "'d") ps = this._ed(ps);
    else if (suffix === 'ing') ps = this._ing(ps);
    return [ps, rating];
  }
  static isNumber(word) {
    if (![...word].some((c) => /[0-9]/.test(c))) return false;
    for (const s of ['ing', "'d", 'ed', "'s", 'st', 'nd', 'rd', 'th', 's']) if (word.endsWith(s)) { word = word.slice(0, -s.length); break; }
    return [...word].every((c, i) => /[0-9,.]/.test(c) || (i === 0 && c === '-'));
  }
  appendCurrency(ps, currency) {
    if (!currency || !CURRENCIES[currency]) return ps;
    const c = this.stemS(CURRENCIES[currency][0] + 's', null, null, null)[0];
    return c ? `${ps} ${c}` : ps;
  }
  call(tk, ctx) {
    let word = (tk.alias ?? tk.text).replaceAll('‘', "'").replaceAll('’', "'").normalize('NFKC');
    const stress = word === lower(word) ? null : this.capStresses[word === upper(word) ? 1 : 0];
    let [ps, rating] = this.getWord(word, tk.tag, stress, ctx);
    if (ps != null) return [applyStress(this.appendCurrency(ps, tk.currency), tk.stress), rating];
    if (Lexicon.isNumber(word)) {
      [ps, rating] = this.getNumber(word, tk.currency);
      return [applyStress(ps, tk.stress), rating];
    }
    return [null, null];
  }
}

// ---------------- espeak fallback ----------------
const E2M = [
  ['ʔˌn̩', 'ʔn'], ['ʔn̩', 'ʔn'],
  ['aɪ', 'I'], ['aʊ', 'W'], ['dʒ', 'ʤ'], ['eɪ', 'A'], ['tʃ', 'ʧ'], ['ɔɪ', 'Y'],
  ['ʲo', 'jo'], ['ʲə', 'jə'], ['ʲ', ''], ['ɚ', 'əɹ'], ['e', 'A'], ['r', 'ɹ'], ['x', 'k'], ['ç', 'k'], ['ɐ', 'ə'], ['ɬ', 'l'], ['̃', ''],
].sort((a, b) => b[0].length - a[0].length);

export function espeakToMisaki(ps) {
  ps = ps.trim();
  // 'oʊ' must be handled before the generic E2M 'o' fix; diphthongs before single chars.
  ps = ps.replaceAll('oʊ', 'O');
  for (const [a, b] of E2M) ps = ps.replaceAll(a, b);
  ps = ps.replace(/(\S)̩/gu, 'ᵊ$1').replaceAll('̩', '');
  ps = ps.replaceAll('ɜːɹ', 'ɜɹ').replaceAll('ɜː', 'ɜɹ').replaceAll('ɪə', 'iə').replaceAll('ː', '');
  ps = ps.replaceAll('o', 'ɔ');
  ps = ps.replaceAll('ɾ', 'T').replaceAll('ʔ', 't');
  return ps.replaceAll('-', '');
}

// ---------------- tokenizer (spaCy replacement) ----------------
// token: {text, ws, tag, kind: 'word'|'num'|'punct'|'sym'}
const TOKEN_RE = /(\p{L}+(?:['’]\p{L}+)*['’]?)|((?:(?<![\d\p{L}])-)?\d+(?:,\d{3})*(?:\.\d+)?(?:st|nd|rd|th|s|'s|ed|ing)?|\.\d+)|([$£€%&+@])|(\.\.\.|[—–-]+|[^\s\p{L}\d])/gu;

function tokenize(text) {
  const tokens = [];
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text))) {
    const end = m.index + m[0].length;
    let j = end; while (j < text.length && /\s/.test(text[j])) j++;
    const ws = j > end ? ' ' : '';
    const kind = m[1] ? 'word' : m[2] ? 'num' : m[3] ? 'sym' : 'punct';
    let t = m[0];
    if (t === '...') t = '…';
    tokens.push({ text: t, ws, kind, tag: null, start: m.index });
  }
  // heuristic tags
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i], prev = tokens[i - 1], next = tokens[i + 1];
    const lw = lower(tk.text);
    if (tk.kind === 'num' || (tk.kind === 'word' && NUM_WORDS.has(lw))) tk.tag = 'CD';
    else if (tk.kind === 'sym' && CURRENCIES[tk.text]) tk.tag = '$';
    else if (lw === 'a' && tk.kind === 'word') tk.tag = (next && next.text === '.') ? 'NN' : 'DT';
    else if (lw === 'in') tk.tag = 'IN';
    else if (tk.kind === 'word' && prev && prev.kind === 'word') {
      const pl = lower(prev.text);
      if (DETERMINERS.has(pl)) tk.tag = 'NN';
      else if (VERB_CUES.has(pl)) tk.tag = 'VB';
    }
  }
  return tokens;
}

function tokenContext(ctx, ps, tk) {
  let vowel = ctx.futureVowel;
  if (ps) {
    for (const c of ps) {
      if (VOWELS.has(c) || CONSONANTS.has(c) || NON_QUOTE_PUNCTS.has(c)) {
        vowel = NON_QUOTE_PUNCTS.has(c) ? null : VOWELS.has(c);
        break;
      }
    }
  }
  const futureTo = tk && (tk.text === 'to' || tk.text === 'To' || tk.text === 'TO');
  return { futureVowel: vowel, futureTo: !!futureTo };
}

// misaki subtokenize: splits "on-device", "iPhone" style words into lookup-able pieces.
const SUBTOKEN_RE = /^['‘’]+|\p{Lu}(?=\p{Lu}\p{Ll})|(?:^-)?(?:\d?[,.]?\d)+|[-_]+|['‘’]{2,}|\p{L}*?(?:['‘’]\p{L})*?\p{Ll}(?=\p{Lu})|\p{L}+(?:['‘’]\p{L})*|[^-_\p{L}'‘’\d]|['‘’]+$/gu;

export class G2P {
  constructor(lexicon, fallback) {
    this.lexicon = lexicon;
    this.fallback = fallback; // async (word) => espeak IPA string
  }

  // Groups: consecutive non-punctuation tokens without whitespace form one "word" (list) in misaki.
  _words(tokens) {
    // merge known abbreviations ("Dr.", "Mr.", "etc.") that spaCy would keep as one token
    for (let i = 0; i < tokens.length - 1; i++) {
      const a = tokens[i], b = tokens[i + 1];
      if (a.kind === 'word' && !a.ws && b.text === '.' && this.lexicon.has(this.lexicon.golds, a.text + '.')) {
        a.text += '.'; a.ws = b.ws; tokens.splice(i + 1, 1);
      }
    }
    const words = [];
    let currency = null;
    for (let i = 0; i < tokens.length; i++) {
      const tk = tokens[i];
      if (tk.tag === '$' && CURRENCIES[tk.text]) { currency = tk.text; tk.phonemes = ''; words.push(tk); continue; }
      if (tk.kind === 'punct') {
        if (tk.text === '-' || tk.text === '–' || /^[—–-]{2,}$/.test(tk.text)) {
          // hyphen inside a word (no whitespace on either side) is a subtoken junk; otherwise a dash
          const prev = tokens[i - 1];
          if (prev && !prev.ws && !tk.ws && tokens[i + 1] && tokens[i + 1].kind !== 'punct' && tk.text === '-') {
            const last = words.at(-1);
            if (Array.isArray(last)) { tk.isHead = false; last.push(tk); continue; }
          }
          tk.phonemes = '—';
        } else if (tk.text === '(' || tk.text === ')') tk.phonemes = tk.text;
        else tk.phonemes = [...tk.text].filter((c) => PUNCTS.has(c)).join('');
        words.push(tk);
        continue;
      }
      if (currency !== null) {
        if (tk.tag !== 'CD') currency = null;
        else if (!(tokens[i + 1] && tokens[i + 1].tag === 'CD')) tk.currency = currency;
      }
      // subtokenize this token
      const subs = tk.kind === 'word' ? (tk.text.match(SUBTOKEN_RE) || [tk.text]) : [tk.text];
      const parts = subs.map((t, j) => ({ ...tk, text: t, ws: j === subs.length - 1 ? tk.ws : '', isHead: true }));
      for (const p of parts) {
        const last = words.at(-1);
        if (Array.isArray(last) && !last.at(-1).ws) { p.isHead = false; last.push(p); }
        else words.push(p.ws ? p : [p]);
      }
    }
    return words.map((w) => (Array.isArray(w) && w.length === 1 ? w[0] : w));
  }

  _resolve(group) {
    const text = group.map((t, i) => t.text + (i < group.length - 1 ? t.ws : '')).join('');
    const kinds = new Set([...text].filter((c) => !SUBTOKEN_JUNKS.has(c)).map((c) => (/\p{L}/u.test(c) ? 0 : /\d/.test(c) ? 1 : 2)));
    const prespace = text.includes(' ') || text.includes('/') || kinds.size > 1;
    group.forEach((tk, i) => {
      if (tk.phonemes == null) {
        if (i === group.length - 1 && NON_QUOTE_PUNCTS.has(tk.text)) tk.phonemes = tk.text;
        else if ([...tk.text].every((c) => SUBTOKEN_JUNKS.has(c))) tk.phonemes = '';
      } else if (i > 0) tk.prespace = prespace;
    });
    if (prespace) return;
    let idx = group.map((tk, i) => [tk.phonemes && tk.phonemes.includes(PRIMARY) ? 1 : 0, stressWeight(tk.phonemes), i]).filter(([, , i]) => group[i].phonemes);
    if (idx.length === 2 && group[idx[0][2]].text.length === 1) {
      const i = idx[1][2]; group[i].phonemes = applyStress(group[i].phonemes, -0.5); return;
    }
    if (idx.length < 2 || idx.reduce((a, [b]) => a + b, 0) <= Math.floor((idx.length + 1) / 2)) return;
    idx = idx.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).slice(0, Math.floor(idx.length / 2));
    for (const [, , i] of idx) group[i].phonemes = applyStress(group[i].phonemes, -0.5);
  }

  async _fallback(text) {
    if (!this.fallback) return '';
    const raw = await this.fallback(text);
    return espeakToMisaki(raw);
  }

  async phonemize(text) {
    text = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
    const tokens = tokenize(text);
    const words = this._words(tokens);
    let ctx = { futureVowel: null, futureTo: false };
    for (let wi = words.length - 1; wi >= 0; wi--) {
      const w = words[wi];
      if (!Array.isArray(w)) {
        if (w.phonemes == null) [w.phonemes] = this.lexicon.call(w, ctx);
        if (w.phonemes == null) w.phonemes = await this._fallback(w.text);
        ctx = tokenContext(ctx, w.phonemes, w);
        continue;
      }
      let left = 0, right = w.length, shouldFallback = false;
      while (left < right) {
        const span = w.slice(left, right);
        let ps = null;
        if (!span.some((t) => t.phonemes != null)) {
          const merged = { text: span.map((t, i) => t.text + (i < span.length - 1 ? t.ws : '')).join(''), tag: span.at(-1).tag, currency: span.at(-1).currency, stress: null };
          [ps] = this.lexicon.call(merged, ctx);
          if (ps != null) {
            w[left].phonemes = ps;
            for (const x of w.slice(left + 1, right)) x.phonemes = '';
            ctx = tokenContext(ctx, ps, merged);
            right = left; left = 0;
            continue;
          }
        }
        if (left + 1 < right) left++;
        else {
          right--;
          const tk = w[right];
          if (tk.phonemes == null) {
            if ([...tk.text].every((c) => SUBTOKEN_JUNKS.has(c))) tk.phonemes = '';
            else { shouldFallback = true; break; }
          }
          left = 0;
        }
      }
      if (shouldFallback) {
        const t = w.map((x, i) => x.text + (i < w.length - 1 ? x.ws : '')).join('');
        w[0].phonemes = await this._fallback(t);
        for (let j = 1; j < w.length; j++) w[j].phonemes = '';
        ctx = tokenContext(ctx, w[0].phonemes, w[0]);
      } else this._resolve(w);
    }
    // merge
    let out = '';
    for (const w of words) {
      if (Array.isArray(w)) {
        let ps = '';
        for (const tk of w) {
          if (tk.prespace && ps && !/\s$/.test(ps) && tk.phonemes) ps += ' ';
          ps += tk.phonemes ?? '';
        }
        out += ps + w.at(-1).ws;
      } else out += (w.phonemes ?? '') + w.ws;
    }
    out = out.replaceAll('ɾ', 'T').replaceAll('ʔ', 't');
    return out.replace(/ +/g, ' ').trim();
  }
}
