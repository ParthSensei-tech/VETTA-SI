/**
 * India hiring domain encoder.
 *
 * Hashed text features → two-layer encoder → 32-d embedding, with a
 * decoder used only for unsupervised reconstruction on real documents.
 * Pairwise rank loss (shortlist vs reject) updates the encoder.
 * No market statistics are stored in this file.
 */

export const HASH_DIM = 192;
export const HIDDEN = 48;
export const EMBED_DIM = 32;

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "are",
  "was",
  "were",
  "you",
  "your",
  "our",
  "their",
  "have",
  "has",
  "had",
  "not",
  "but",
  "into",
  "about",
  "over",
  "will",
  "can",
  "all",
  "any",
  "job",
  "role",
  "work",
]);

export type EmbedWeights = {
  version: number;
  steps: number;
  docs: number;
  reconLossEma: number;
  rankSteps: number;
  w1: Float32Array;
  b1: Float32Array;
  w2: Float32Array;
  b2: Float32Array;
  w3: Float32Array;
  b3: Float32Array;
  w4: Float32Array;
  b4: Float32Array;
};

export type MarketMetric = {
  key: string;
  value: number;
  unit: "percent" | "index" | "count";
  source: string;
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function xavier(nOut: number, nIn: number, rng: () => number) {
  const scale = Math.sqrt(6 / (nIn + nOut));
  const a = new Float32Array(nOut * nIn);
  for (let i = 0; i < a.length; i += 1) a[i] = (rng() * 2 - 1) * scale;
  return a;
}

export function initWeights(seed = 0x51ed): EmbedWeights {
  const rng = mulberry32(seed);
  return {
    version: 1,
    steps: 0,
    docs: 0,
    reconLossEma: 1,
    rankSteps: 0,
    w1: xavier(HIDDEN, HASH_DIM, rng),
    b1: new Float32Array(HIDDEN),
    w2: xavier(EMBED_DIM, HIDDEN, rng),
    b2: new Float32Array(EMBED_DIM),
    w3: xavier(HIDDEN, EMBED_DIM, rng),
    b3: new Float32Array(HIDDEN),
    w4: xavier(HASH_DIM, HIDDEN, rng),
    b4: new Float32Array(HASH_DIM),
  };
}

function fnv(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hashFeatures(text: string): Float32Array {
  const x = new Float32Array(HASH_DIM);
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9+.#]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
  const feats: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!;
    feats.push(t);
    if (i + 1 < tokens.length) feats.push(`${t}_${tokens[i + 1]}`);
    if (t.length >= 5) {
      for (let c = 0; c < t.length - 2; c += 1) feats.push(`#${t.slice(c, c + 3)}`);
    }
  }
  if (feats.length === 0) return x;
  for (const f of feats) {
    const h = fnv(f);
    const bucket = h % HASH_DIM;
    const sign = h & 1 ? 1 : -1;
    x[bucket] += sign;
  }
  let norm = 0;
  for (let i = 0; i < HASH_DIM; i += 1) {
    x[i] = Math.tanh(x[i] / 3);
    norm += x[i] * x[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < HASH_DIM; i += 1) x[i] /= norm;
  return x;
}

function gemv(
  w: Float32Array,
  rows: number,
  cols: number,
  x: Float32Array,
  b: Float32Array,
  relu: boolean,
) {
  const y = new Float32Array(rows);
  for (let r = 0; r < rows; r += 1) {
    let s = b[r] ?? 0;
    const off = r * cols;
    for (let c = 0; c < cols; c += 1) s += w[off + c]! * x[c]!;
    y[r] = relu ? (s > 0 ? s : 0) : s;
  }
  return y;
}

export function encode(x: Float32Array, w: EmbedWeights): Float32Array {
  const h1 = gemv(w.w1, HIDDEN, HASH_DIM, x, w.b1, true);
  return gemv(w.w2, EMBED_DIM, HIDDEN, h1, w.b2, false);
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  if (d < 1e-8) return 0;
  return Math.max(-1, Math.min(1, dot / d));
}

export function alignmentScore(cos: number): number {
  return Math.round(Math.max(0, Math.min(100, ((cos + 1) / 2) * 100)));
}

function outerAdd(
  w: Float32Array,
  rows: number,
  cols: number,
  dy: Float32Array,
  x: Float32Array,
  lr: number,
) {
  for (let r = 0; r < rows; r += 1) {
    const g = dy[r] ?? 0;
    if (g === 0) continue;
    const off = r * cols;
    const step = lr * g;
    for (let c = 0; c < cols; c += 1) {
      const idx = off + c;
      w[idx] = (w[idx] ?? 0) - step * (x[c] ?? 0);
    }
  }
}

function addScaled(b: Float32Array, dy: Float32Array, lr: number) {
  for (let i = 0; i < b.length; i += 1) b[i] = (b[i] ?? 0) - lr * (dy[i] ?? 0);
}

/** One unsupervised step: reconstruct hashed features. Returns MSE. */
export function trainReconstruction(w: EmbedWeights, x: Float32Array, lr = 0.02): number {
  const h1Pre = gemv(w.w1, HIDDEN, HASH_DIM, x, w.b1, false);
  const h1 = new Float32Array(HIDDEN);
  for (let i = 0; i < HIDDEN; i += 1) h1[i] = h1Pre[i]! > 0 ? h1Pre[i]! : 0;
  const z = gemv(w.w2, EMBED_DIM, HIDDEN, h1, w.b2, false);
  const h2Pre = gemv(w.w3, HIDDEN, EMBED_DIM, z, w.b3, false);
  const h2 = new Float32Array(HIDDEN);
  for (let i = 0; i < HIDDEN; i += 1) h2[i] = h2Pre[i]! > 0 ? h2Pre[i]! : 0;
  const y = gemv(w.w4, HASH_DIM, HIDDEN, h2, w.b4, false);

  const dy = new Float32Array(HASH_DIM);
  let loss = 0;
  for (let i = 0; i < HASH_DIM; i += 1) {
    const e = y[i]! - x[i]!;
    loss += e * e;
    dy[i] = (2 * e) / HASH_DIM;
  }
  loss /= HASH_DIM;
  if (!Number.isFinite(loss)) return w.reconLossEma;

  const dh2 = new Float32Array(HIDDEN);
  for (let c = 0; c < HIDDEN; c += 1) {
    let s = 0;
    for (let r = 0; r < HASH_DIM; r += 1) s += w.w4[r * HIDDEN + c]! * dy[r]!;
    dh2[c] = h2Pre[c]! > 0 ? s : 0;
  }
  const dz = new Float32Array(EMBED_DIM);
  for (let c = 0; c < EMBED_DIM; c += 1) {
    let s = 0;
    for (let r = 0; r < HIDDEN; r += 1) s += w.w3[r * EMBED_DIM + c]! * dh2[r]!;
    dz[c] = s;
  }
  const dh1 = new Float32Array(HIDDEN);
  for (let c = 0; c < HIDDEN; c += 1) {
    let s = 0;
    for (let r = 0; r < EMBED_DIM; r += 1) s += w.w2[r * HIDDEN + c]! * dz[r]!;
    dh1[c] = h1Pre[c]! > 0 ? s : 0;
  }

  outerAdd(w.w4, HASH_DIM, HIDDEN, dy, h2, lr);
  addScaled(w.b4, dy, lr);
  outerAdd(w.w3, HIDDEN, EMBED_DIM, dh2, z, lr);
  addScaled(w.b3, dh2, lr);
  outerAdd(w.w2, EMBED_DIM, HIDDEN, dz, h1, lr);
  addScaled(w.b2, dz, lr);
  outerAdd(w.w1, HIDDEN, HASH_DIM, dh1, x, lr);
  addScaled(w.b1, dh1, lr);

  w.steps += 1;
  w.docs += 1;
  w.reconLossEma = w.reconLossEma * 0.95 + loss * 0.05;
  return loss;
}

function encoderGrads(w: EmbedWeights, x: Float32Array, dz: Float32Array, lr: number) {
  const h1Pre = gemv(w.w1, HIDDEN, HASH_DIM, x, w.b1, false);
  const h1 = new Float32Array(HIDDEN);
  for (let i = 0; i < HIDDEN; i += 1) h1[i] = h1Pre[i]! > 0 ? h1Pre[i]! : 0;
  const dh1 = new Float32Array(HIDDEN);
  for (let c = 0; c < HIDDEN; c += 1) {
    let s = 0;
    for (let r = 0; r < EMBED_DIM; r += 1) s += w.w2[r * HIDDEN + c]! * dz[r]!;
    dh1[c] = h1Pre[c]! > 0 ? s : 0;
  }
  outerAdd(w.w2, EMBED_DIM, HIDDEN, dz, h1, lr);
  addScaled(w.b2, dz, lr);
  outerAdd(w.w1, HIDDEN, HASH_DIM, dh1, x, lr);
  addScaled(w.b1, dh1, lr);
}

/**
 * Pairwise objective: pull shortlist pairs together, push rejects apart.
 * Updates the shared encoder. Optional org bias (private adapter) is added
 * to the resume embedding before cosine.
 */
export function trainPair(
  w: EmbedWeights,
  resume: Float32Array,
  role: Float32Array,
  positive: boolean,
  orgBias: Float32Array | null,
  lr = 0.015,
): number {
  const zr0 = encode(resume, w);
  const zp = encode(role, w);
  const zr = new Float32Array(EMBED_DIM);
  for (let i = 0; i < EMBED_DIM; i += 1) zr[i] = zr0[i]! + (orgBias?.[i] ?? 0);
  const c = cosine(zr, zp);
  const target = positive ? 0.72 : -0.15;
  const loss = (c - target) * (c - target);
  if (!Number.isFinite(loss)) return loss;

  let nr = 0;
  let np = 0;
  for (let i = 0; i < EMBED_DIM; i += 1) {
    nr += zr[i]! * zr[i]!;
    np += zp[i]! * zp[i]!;
  }
  nr = Math.sqrt(nr) || 1e-8;
  np = Math.sqrt(np) || 1e-8;
  const inv = 1 / (nr * np);
  const dc = 2 * (c - target);
  const dzr = new Float32Array(EMBED_DIM);
  const dzp = new Float32Array(EMBED_DIM);
  for (let i = 0; i < EMBED_DIM; i += 1) {
    const gi = inv * zp[i]! - (c * zr[i]!) / (nr * nr);
    const gj = inv * zr[i]! - (c * zp[i]!) / (np * np);
    dzr[i] = dc * gi;
    dzp[i] = dc * gj;
  }
  encoderGrads(w, resume, dzr, lr);
  encoderGrads(w, role, dzp, lr);
  if (orgBias) {
    for (let i = 0; i < EMBED_DIM; i += 1) {
      orgBias[i] = (orgBias[i] ?? 0) - lr * dzr[i]!;
      orgBias[i] = Math.max(-1.5, Math.min(1.5, orgBias[i]!));
    }
  }
  w.rankSteps += 1;
  return loss;
}

export function embedText(text: string, w: EmbedWeights, bias?: Float32Array | null): Float32Array {
  const z = encode(hashFeatures(text), w);
  if (!bias) return z;
  const out = new Float32Array(EMBED_DIM);
  for (let i = 0; i < EMBED_DIM; i += 1) out[i] = z[i]! + (bias[i] ?? 0);
  return out;
}

/** Turn a fetched metric list into training text. Values come from the caller. */
export function metricsToDocument(metrics: MarketMetric[]): string {
  return metrics
    .map((m) => {
      const dir = m.value < 0 ? "contracting" : "expanding";
      if (m.unit === "percent") {
        return `india hiring ${m.key.replaceAll("_", " ")} ${dir} ${m.value} percent year on year source ${m.source}`;
      }
      if (m.unit === "index") {
        return `india white collar hiring index ${m.key.replaceAll("_", " ")} level ${m.value} source ${m.source}`;
      }
      return `india job market ${m.key.replaceAll("_", " ")} volume ${m.value} source ${m.source}`;
    })
    .join("\n");
}

const TAG = /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi;

/** Parse percent / index / count figures out of a public market page. */
export function parseMarketPage(html: string, source: string): MarketMetric[] {
  const text = html
    .replace(TAG, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&/g, "&")
    .replace(/\s+/g, " ")
    .slice(0, 80_000);
  const metrics: MarketMetric[] = [];
  const seen = new Set<string>();

  const push = (key: string, value: number, unit: MarketMetric["unit"]) => {
    const k = key
      .toLowerCase()
      .replace(/[^a-z0-9+.# ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 48)
      .replaceAll(" ", "_");
    if (k.length < 3 || seen.has(k) || !Number.isFinite(value)) return;
    if (unit === "percent" && Math.abs(value) > 400) return;
    if (unit === "index" && (value < 100 || value > 20000)) return;
    if (unit === "count" && value < 1000) return;
    seen.add(k);
    metrics.push({ key: k, value, unit, source });
  };

  const pct =
    /([A-Za-z][A-Za-z0-9 /&+-]{2,42}?)(?:\s+hiring|\s+roles|\s+sector)?\s+(grew|growth|rising|rose|up|down|declined|fell|recorded|at|by)?\s*(-?\d+(?:\.\d+)?)\s*%/gi;
  let m: RegExpExecArray | null;
  while ((m = pct.exec(text))) {
    const verb = (m[2] ?? "").toLowerCase();
    let value = Number(m[3]);
    if ((verb === "down" || verb === "declined" || verb === "fell") && value > 0) value = -value;
    push(m[1] ?? "hiring", value, "percent");
    if (metrics.length > 40) break;
  }

  const idx = /(?:jobspeak|hiring index|index)[^0-9]{0,40}(\d{3,5})/i.exec(text);
  if (idx) push("jobspeak_index", Number(idx[1]), "index");

  const vol = /(\d{1,3}(?:,\d{3})+)\s+(?:live )?postings/i.exec(text);
  if (vol) push("live_postings", Number(vol[1]!.replaceAll(",", "")), "count");

  return metrics;
}

export type SerializedWeights = {
  version: number;
  steps: number;
  docs: number;
  reconLossEma: number;
  rankSteps: number;
  w1: number[];
  b1: number[];
  w2: number[];
  b2: number[];
  w3: number[];
  b3: number[];
  w4: number[];
  b4: number[];
};

function arr(a: ArrayLike<number>): number[] {
  return Array.from(a);
}

export function serializeWeights(w: EmbedWeights): string {
  const s: SerializedWeights = {
    version: w.version,
    steps: w.steps,
    docs: w.docs,
    reconLossEma: w.reconLossEma,
    rankSteps: w.rankSteps,
    w1: arr(w.w1),
    b1: arr(w.b1),
    w2: arr(w.w2),
    b2: arr(w.b2),
    w3: arr(w.w3),
    b3: arr(w.b3),
    w4: arr(w.w4),
    b4: arr(w.b4),
  };
  return JSON.stringify(s);
}

function asF32(v: number[] | undefined, n: number): Float32Array {
  const a = new Float32Array(n);
  if (!v) return a;
  for (let i = 0; i < n && i < v.length; i += 1) a[i] = v[i] ?? 0;
  return a;
}

export function deserializeWeights(raw: string): EmbedWeights | null {
  try {
    const s = JSON.parse(raw) as SerializedWeights;
    if (!s || s.w1?.length !== HIDDEN * HASH_DIM) return null;
    return {
      version: s.version || 1,
      steps: s.steps || 0,
      docs: s.docs || 0,
      reconLossEma: s.reconLossEma || 1,
      rankSteps: s.rankSteps || 0,
      w1: asF32(s.w1, HIDDEN * HASH_DIM),
      b1: asF32(s.b1, HIDDEN),
      w2: asF32(s.w2, EMBED_DIM * HIDDEN),
      b2: asF32(s.b2, EMBED_DIM),
      w3: asF32(s.w3, HIDDEN * EMBED_DIM),
      b3: asF32(s.b3, HIDDEN),
      w4: asF32(s.w4, HASH_DIM * HIDDEN),
      b4: asF32(s.b4, HASH_DIM),
    };
  } catch {
    return null;
  }
}
