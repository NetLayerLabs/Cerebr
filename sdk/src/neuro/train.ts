// "Train a neuron in the browser": learn a binarized threshold neuron (or a tiny 2-layer network)
// from labelled bit vectors and compile it to a TapeOut NAND netlist.
//
//   y = [ Σ_i w_i·x_i ≥ θ ]     x_i ∈ {0,1}, w_i ∈ {-W..W} (W = maxWeight, default 1: ternary)
//
// Single neuron (trainNeuron):
//  - 'exact': enumerate weight vectors in order of increasing Σ|w| (zero weights first), with the
//    best θ for each vector found in O(m + range) from a histogram of the weighted sums. The first
//    Σ|w| level that separates the data is the answer (fewest synapses); ties are broken by the
//    compiled NAND count, then by margin (θ centred in its feasible interval). Enumerating every
//    level without a separator PROVES no neuron with |w| <= W fits, and yields the best-accuracy one.
//    The search is bounded by a work budget (nodes × examples).
//  - 'perceptron': pocket perceptron on integer weights clipped to [-W, W] (seeded shuffling), plus
//    a wider-precision run quantized down, both polished by coordinate descent (θ re-fitted, useless
//    synapses dropped). Used when the exact search would exceed its budget (large n or wide weights).
//
// prefer: 'gates' (default) is all of the above: the cheapest circuit that fits the examples. It
// often leans on one or two pixels and misreads new drawings. prefer: 'robust' ranks separating
// neurons by margin in FLIPPED INPUT BITS, (min_pos Σ - max_neg Σ) / max|w| (how many pixels a
// training example must lose or gain before its class changes), then by mean margin, then by gates,
// and centres θ in the gap. Exhaustive over all (2W+1)^n vectors when that fits the budget
// (n <= 9 ternary), else a local search from class-centroid and perceptron starts.
//
// Two layers (trainNetwork), when no single neuron fits: hidden neurons each fire on some positive
// examples and on no negative one, and the output ORs them (or the mirror image: hidden neurons
// cover the negatives and the output is a NOR). Picking the hidden neurons is a set cover over the
// maximal "pure" neurons, solved exactly (iterative deepening) for small instances, greedily
// otherwise. Pure neurons come from exhaustive ternary enumeration for small n, or from prototype
// neurons (one per positive example, loosened greedily) for larger n. Any consistent dataset is
// learnable this way (a prototype neuron fires on exactly one input). In robust mode the cover is a
// bottleneck cover (maximise the smallest hidden-neuron margin, then the fewest hidden neurons), so
// e.g. horizontal-vs-vertical learns one row detector per row instead of two pixel-specific tricks.

import type { BuildOptions, GateCounts, Netlist } from './netlist.ts';
import { compileNetwork, compileNeuron, evalNetwork, MAX_NEURON_WEIGHT, type NeuronSpec, type ThresholdStrategy } from './neuron.ts';
import { bitsOf, programOf, run } from './sim.ts';

export interface Example {
  x: number[];
  y: 0 | 1;
}

export interface TrainOptions {
  /** Largest |weight| (default 1: ternary {-1,0,+1}; at most MAX_NEURON_WEIGHT). */
  maxWeight?: number;
  /** Perceptron epochs (default 200). */
  epochs?: number;
  /** Seed for the perceptron's example order (default 1). */
  seed?: number;
  /** 'auto' (default): exact search when it fits the budget, perceptron otherwise. */
  method?: 'auto' | 'exact' | 'perceptron';
  /** Exact-search work budget, in (search node × distinct example) steps (default 2e7). */
  budget?: number;
  /**
   * 'gates' (default): fewest synapses, then fewest NAND gates - the cheapest circuit to tape out.
   * 'robust': among separating neurons, maximise the worst-case margin (min_pos Σ - max_neg Σ) /
   * max|w| - the number of input bits (pixels) that must flip before any training example changes
   * class - then the mean margin over all examples (penalises relying on a few pixels), then fewest
   * gates; θ is centred in the gap. Generalises far better to new drawings, at a higher gate cost.
   */
  prefer?: 'gates' | 'robust';
}

export interface TrainedNeuron {
  kind: 'neuron';
  nIn: number;
  weights: number[];
  theta: number;
  /** Fraction of training examples classified correctly. */
  accuracy: number;
  errors: number;
  /** Perceptron epochs run (0 for the exact search). */
  epochs: number;
  /** 100% training accuracy. */
  converged: boolean;
  /** 'local-search': robust mode's heuristic for large n (centroid / perceptron starts, polished). */
  method: 'exact' | 'perceptron' | 'local-search';
  /**
   * true: the exact search covered every weight vector with |w| <= maxWeight, so `converged` is a
   * proof either way (separable or not) and the result is optimal for `prefer`.
   */
  exhaustive: boolean;
  maxWeight: number;
  prefer: 'gates' | 'robust';
  /** Worst-case margin in flipped input bits, (min_pos Σ - max_neg Σ) / max|w|, when converged; else 0. */
  margin: number;
  /** Perceptron progress (errors on the whole training set after each epoch); [] for 'exact'. */
  history: { epoch: number; errors: number }[];
}

export interface TrainNetworkOptions extends TrainOptions {
  /** Largest hidden layer the exact cover search tries (default 6). Greedy covers may be larger. */
  maxHidden?: number;
}

export interface TrainedNetwork {
  kind: 'network';
  nIn: number;
  /** Same shape as the catalog's `layers`: [hidden, [output]] or [[neuron]] if one neuron suffices. */
  layers: NeuronSpec[][];
  hidden: number;
  /** 'single' | 'or' (output = OR of hidden) | 'nor' (output = NOR of hidden). */
  structure: 'single' | 'or' | 'nor';
  accuracy: number;
  errors: number;
  converged: boolean;
  /** Did a single neuron (|w| <= maxWeight) fit? null when the search could not decide. */
  separable: boolean | null;
  /** The single-neuron attempt (always made first). */
  neuron: TrainedNeuron;
  prefer: 'gates' | 'robust';
  /**
   * Robustness in flipped input bits: the neuron's margin for 'single'; for 2 layers, the smallest
   * margin of a hidden neuron between the points it fires on and the points it must ignore.
   */
  margin: number;
}

export type TrainedModel = TrainedNeuron | TrainedNetwork;

// ------------------------------------------------------------------ data preparation

/** Distinct inputs with the (weighted) number of positive and negative labels on each. */
interface Data {
  n: number;
  xs: Uint8Array[];
  pos: number[];
  neg: number[];
  total: number;
}

function checkExamples(examples: readonly Example[]): number {
  if (!Array.isArray(examples) || examples.length === 0) throw new Error('need at least one example');
  const n = examples[0].x.length;
  examples.forEach((e, i) => {
    if (!e || !Array.isArray(e.x) || e.x.length !== n) throw new Error(`example ${i} has ${e?.x?.length} inputs, expected ${n}`);
    if (!e.x.every((v: number) => v === 0 || v === 1)) throw new Error(`example ${i}: inputs must be 0/1`);
    if (e.y !== 0 && e.y !== 1) throw new Error(`example ${i}: label must be 0 or 1`);
  });
  return n;
}

function prepareData(examples: readonly Example[]): Data {
  const n = checkExamples(examples);
  const index = new Map<string, number>();
  const xs: Uint8Array[] = [], pos: number[] = [], neg: number[] = [];
  for (const e of examples) {
    const key = e.x.join('');
    let k = index.get(key);
    if (k === undefined) {
      k = xs.length;
      index.set(key, k);
      xs.push(Uint8Array.from(e.x));
      pos.push(0);
      neg.push(0);
    }
    if (e.y) pos[k]++;
    else neg[k]++;
  }
  return { n, xs, pos, neg, total: examples.length };
}

function checkMaxWeight(w: number | undefined): number {
  const W = w ?? 1;
  if (!Number.isInteger(W) || W < 1 || W > MAX_NEURON_WEIGHT) throw new Error(`maxWeight must be an integer in 1..${MAX_NEURON_WEIGHT}`);
  return W;
}

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sumOf = (w: ArrayLike<number>, x: Uint8Array) => {
  let s = 0;
  for (let i = 0; i < x.length; i++) if (x[i]) s += w[i];
  return s;
};

const l1 = (w: readonly number[]) => w.reduce((a, v) => a + Math.abs(v), 0);

/**
 * Best thresholds for fixed sums: errors(θ) = Σ pos[s<θ] + Σ neg[s≥θ], θ ∈ [lo, hi+1].
 * Returns the minimum and every θ achieving it.
 */
function bestThetas(d: Data, sums: ArrayLike<number>, lo: number, hi: number, hp: Float64Array, hn: Float64Array): { err: number; thetas: number[] } {
  const R = hi - lo + 1;
  hp.fill(0, 0, R);
  hn.fill(0, 0, R);
  let negTotal = 0;
  for (let k = 0; k < d.xs.length; k++) {
    hp[sums[k] - lo] += d.pos[k];
    hn[sums[k] - lo] += d.neg[k];
    negTotal += d.neg[k];
  }
  let below = 0, above = negTotal, err = Infinity, thetas: number[] = [];
  for (let t = lo; t <= hi + 1; t++) {
    const e = below + above;
    if (e < err) { err = e; thetas = [t]; }
    else if (e === err) thetas.push(t);
    if (t <= hi) { below += hp[t - lo]; above -= hn[t - lo]; }
  }
  return { err, thetas };
}

function errorsOf(d: Data, w: readonly number[], theta: number): number {
  let e = 0;
  d.xs.forEach((x, k) => { e += sumOf(w, x) >= theta ? d.neg[k] : d.pos[k]; });
  return e;
}

// ------------------------------------------------------------------ gate cost (tie-breaker)

const gateMemo = new Map<string, number>();

/** NAND count of the compiled neuron ('direct' outputs). Memoised on the non-zero weight sequence. */
export function neuronGateCount(weights: readonly number[], theta: number): number {
  const nz = weights.filter((w) => w !== 0);
  const key = `${nz.join(',')}>=${theta}`;
  let g = gateMemo.get(key);
  if (g === undefined) {
    g = compileNeuron({ weights: nz, theta }, { mode: 'direct' }).counts.nand;
    if (gateMemo.size > 50_000) gateMemo.clear();
    gateMemo.set(key, g);
  }
  return g;
}

interface Candidate {
  w: number[];
  theta: number;
  margin: number;
  order: number;
}

/** Fewest gates, then widest margin, then search order. */
function pickCandidate(cands: Candidate[]): Candidate {
  let best = cands[0], bestGates = Infinity;
  for (const c of cands) {
    const g = neuronGateCount(c.w, c.theta);
    if (g < bestGates || (g === bestGates && (c.margin > best.margin || (c.margin === best.margin && c.order < best.order)))) {
      best = c;
      bestGates = g;
    }
  }
  return best;
}

function candidatesFor(w: number[], thetas: number[], order: number): Candidate[] {
  // margin: distance to the ends of the run of optimal thetas (wider = more robust to new inputs)
  const first = thetas[0], last = thetas[thetas.length - 1];
  return thetas.map((t) => ({ w, theta: t, margin: Math.min(t - first, last - t), order }));
}

// ------------------------------------------------------------------ exact search

interface ExactResult {
  /** Search finished (not cut by the budget). */
  complete: boolean;
  err: number;
  best?: Candidate;
}

const MAX_TIES = 4096;

function exactSearch(d: Data, W: number, budget: number): ExactResult {
  const { n } = d;
  const m = d.xs.length;
  const values: number[] = [0];
  for (let v = 1; v <= W; v++) values.push(v, -v);
  const sums = Array.from({ length: n + 1 }, () => new Int32Array(m));
  const w = new Array<number>(n).fill(0);
  const hp = new Float64Array(2 * n * W + 2), hn = new Float64Array(2 * n * W + 2);
  // column j: which distinct inputs have bit j set
  const cols = Array.from({ length: n }, (_, j) => d.xs.map((x, k) => (x[j] ? k : -1)).filter((k) => k >= 0));
  let work = 0, aborted = false, bestErr = Infinity, ties: Candidate[] = [], leaves = 0;

  const dfs = (i: number, rem: number, lo: number, hi: number) => {
    if (aborted) return;
    if (i === n) {
      if (rem !== 0) return;
      const r = bestThetas(d, sums[n], lo, hi, hp, hn);
      leaves++;
      if (r.err < bestErr) { bestErr = r.err; ties = []; }
      if (r.err === bestErr && ties.length < MAX_TIES) ties.push(...candidatesFor(w.slice(), r.thetas, leaves));
      return;
    }
    if (rem > (n - i) * W) return;
    const src = sums[i], dst = sums[i + 1];
    for (const v of values) {
      if (Math.abs(v) > rem) continue;
      work += m;
      if (work > budget) { aborted = true; return; }
      dst.set(src);
      if (v !== 0) for (const k of cols[i]) dst[k] += v;
      w[i] = v;
      dfs(i + 1, rem - Math.abs(v), lo + Math.min(0, v), hi + Math.max(0, v));
      if (aborted) return;
    }
    w[i] = 0;
  };

  for (let L = 0; L <= n * W; L++) {
    dfs(0, L, 0, 0);
    if (aborted) break;
    if (bestErr === 0) break; // first separating level = fewest synapses
  }
  if (bestErr === Infinity) return { complete: false, err: Infinity };
  return { complete: !aborted, err: bestErr, best: pickCandidate(ties) };
}

// ------------------------------------------------------------------ perceptron

interface Fit {
  w: number[];
  theta: number;
  err: number;
}

/** Best θ for weights w (median of the optimal run, for margin). */
function fitTheta(d: Data, w: readonly number[], sums?: ArrayLike<number>): Fit {
  const s = sums ?? d.xs.map((x) => sumOf(w, x));
  const lo = w.reduce((a, v) => a + Math.min(0, v), 0), hi = w.reduce((a, v) => a + Math.max(0, v), 0);
  const R = hi - lo + 2;
  const r = bestThetas(d, s, lo, hi, new Float64Array(R), new Float64Array(R));
  return { w: w.slice(), err: r.err, theta: r.thetas[Math.floor((r.thetas.length - 1) / 2)] };
}

const better = (a: Fit, b: Fit) => a.err < b.err || (a.err === b.err && l1(a.w) < l1(b.w));

/** Pocket perceptron on integer weights clipped to [-W, W]; returns the best epoch. */
function perceptron(d: Data, W: number, epochs: number, seed: number): { fit: Fit; epochs: number; history: { epoch: number; errors: number }[] } {
  const { n, xs } = d;
  const rand = rng(seed);
  // one entry per example occurrence, so duplicates weigh in like they do in the error count
  const order: { k: number; y: number }[] = [];
  xs.forEach((_, k) => {
    for (let i = 0; i < d.pos[k]; i++) order.push({ k, y: 1 });
    for (let i = 0; i < d.neg[k]; i++) order.push({ k, y: 0 });
  });
  const w = new Array<number>(n).fill(0);
  const tMax = n * W + 1;
  let theta = 0;
  let pocket = fitTheta(d, w);
  const history: { epoch: number; errors: number }[] = [];
  let ran = 0;
  for (let epoch = 1; epoch <= epochs && pocket.err > 0; epoch++) {
    ran = epoch;
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const { k, y } of order) {
      const x = xs[k];
      const fire = sumOf(w, x) >= theta ? 1 : 0;
      if (fire === y) continue;
      const step = y ? 1 : -1;
      for (let j = 0; j < n; j++) if (x[j]) w[j] = Math.max(-W, Math.min(W, w[j] + step));
      theta = Math.max(-tMax, Math.min(tMax, theta - step));
    }
    const cur = fitTheta(d, w);
    history.push({ epoch, errors: cur.err });
    if (better(cur, pocket)) pocket = cur;
  }
  return { fit: pocket, epochs: ran, history };
}

/** Scale weights down to [-W, W] by magnitude (rounding), keeping signs. */
function quantize(w: readonly number[], W: number): number[] {
  const big = Math.max(1, ...w.map(Math.abs));
  return w.map((v) => Math.round((v * W) / big));
}

/**
 * Coordinate descent: move single weights to any value in [-W, W] (θ re-fitted) while that lowers
 * the error, or keeps it and lowers Σ|w| (fewer synapses / gates).
 */
function polish(d: Data, W: number, start: Fit): Fit {
  const { n, xs } = d;
  let cur = fitTheta(d, start.w);
  if (better(start, cur)) cur = { ...start, w: start.w.slice() };
  const sums = Int32Array.from(xs, (x) => sumOf(cur.w, x));
  const trial = new Int32Array(xs.length);
  for (let sweep = 0; sweep < 64; sweep++) {
    let improved = false;
    for (let j = 0; j < n; j++) {
      for (let v = -W; v <= W; v++) {
        const delta = v - cur.w[j];
        if (delta === 0) continue;
        for (let k = 0; k < xs.length; k++) trial[k] = sums[k] + (xs[k][j] ? delta : 0);
        const w2 = cur.w.slice();
        w2[j] = v;
        const f = fitTheta(d, w2, trial);
        if (better(f, cur)) {
          cur = f;
          sums.set(trial);
          improved = true;
        }
      }
    }
    if (!improved || cur.err === 0) break;
  }
  return cur;
}

// ------------------------------------------------------------------ robust (max-margin) mode

interface RobustFit extends Fit {
  /** Worst-case margin (minPos - maxNeg) / max|w|; -Infinity when not separating. */
  score: number;
  /** Mean distance (in pixel flips) of the examples from the centred threshold. */
  mean: number;
}

const EPS = 1e-9;

/** θ centred in the integer gap: fires for Σ >= θ, i.e. the real cut θ - ½ sits mid-way. */
const centredTheta = (minPos: number, maxNeg: number) => Math.ceil((minPos + maxNeg + 1) / 2);

function robustFit(d: Data, w: readonly number[], sums?: ArrayLike<number>): RobustFit {
  const s = sums ?? d.xs.map((x) => sumOf(w, x));
  let minPos = Infinity, maxNeg = -Infinity, big = 0;
  for (const v of w) big = Math.max(big, Math.abs(v));
  for (let k = 0; k < d.xs.length; k++) {
    if (d.pos[k] && s[k] < minPos) minPos = s[k];
    if (d.neg[k] && s[k] > maxNeg) maxNeg = s[k];
  }
  if (big === 0 || minPos <= maxNeg || !Number.isFinite(minPos) || !Number.isFinite(maxNeg)) {
    return { ...fitTheta(d, w, s), score: -Infinity, mean: -Infinity };
  }
  const norm = big, mid = (minPos + maxNeg) / 2;
  let tot = 0;
  for (let k = 0; k < d.xs.length; k++) tot += d.pos[k] * (s[k] - mid) + d.neg[k] * (mid - s[k]);
  return { w: w.slice(), theta: centredTheta(minPos, maxNeg), err: 0, score: (minPos - maxNeg) / norm, mean: tot / d.total / norm };
}

/** Fewer errors; then (separating) larger worst-case margin, larger mean margin; then smaller Σ|w|. */
function robustBetter(a: RobustFit, b: RobustFit): boolean {
  if (a.err !== b.err) return a.err < b.err;
  if (a.err === 0) {
    if (a.score > b.score + EPS) return true;
    if (a.score < b.score - EPS) return false;
    if (a.mean > b.mean + EPS) return true;
    if (a.mean < b.mean - EPS) return false;
  }
  return l1(a.w) < l1(b.w);
}

/**
 * Exhaustive max-margin search over every weight vector (only when (2W+1)^n fits the budget).
 * Separating vectors rank by (score, mean), ties by gates; if none separates, the gates-mode
 * ranking (errors, Σ|w|) picks the best-accuracy neuron, and the result proves non-separability.
 */
function robustExact(d: Data, W: number, budget: number): { best: Candidate; err: number } | undefined {
  const { n } = d;
  const m = d.xs.length;
  if (1.5 * Math.pow(2 * W + 1, n) * m > budget) return undefined;
  const sums = Array.from({ length: n + 1 }, () => new Int32Array(m));
  const cols = Array.from({ length: n }, (_, j) => d.xs.map((x, k) => (x[j] ? k : -1)).filter((k) => k >= 0));
  const w = new Array<number>(n).fill(0);
  const hp = new Float64Array(2 * n * W + 2), hn = new Float64Array(2 * n * W + 2);
  let leaves = 0, sepBest: RobustFit | undefined, sepTies: Candidate[] = [];
  let errBest = Infinity, errL1 = Infinity, errTies: Candidate[] = [];
  const rec = (i: number, lo: number, hi: number) => {
    if (i === n) {
      leaves++;
      const s = sums[n];
      const f = robustFit(d, w, s);
      if (f.err === 0) {
        if (!sepBest || robustBetterNoL1(f, sepBest)) { sepBest = f; sepTies = []; }
        if (!robustBetterNoL1(sepBest, f) && sepTies.length < MAX_TIES) sepTies.push({ w: f.w, theta: f.theta, margin: 0, order: leaves });
      } else if (!sepBest) {
        const r = bestThetas(d, s, lo, hi, hp, hn);
        const L = l1(w);
        if (r.err < errBest || (r.err === errBest && L < errL1)) { errBest = r.err; errL1 = L; errTies = []; }
        if (r.err === errBest && L === errL1 && errTies.length < MAX_TIES) errTies.push(...candidatesFor(w.slice(), r.thetas, leaves));
      }
      return;
    }
    const src = sums[i], dst = sums[i + 1];
    for (let v = -W; v <= W; v++) {
      dst.set(src);
      if (v !== 0) for (const k of cols[i]) dst[k] += v;
      w[i] = v;
      rec(i + 1, lo + Math.min(0, v), hi + Math.max(0, v));
    }
    w[i] = 0;
  };
  rec(0, 0, 0);
  if (sepBest) return { best: pickCandidate(sepTies), err: 0 };
  return { best: pickCandidate(errTies), err: errBest };
}

/** robustBetter without the Σ|w| tie-break (exact ties are resolved by gate count instead). */
function robustBetterNoL1(a: RobustFit, b: RobustFit): boolean {
  return robustBetter({ ...a, w: [] }, { ...b, w: [] });
}

/** Coordinate descent on the robust ranking. */
function robustPolish(d: Data, W: number, start: readonly number[]): RobustFit {
  const { n, xs } = d;
  let cur = robustFit(d, start);
  const sums = Int32Array.from(xs, (x) => sumOf(cur.w, x));
  const trial = new Int32Array(xs.length);
  for (let sweep = 0; sweep < 64; sweep++) {
    let improved = false;
    for (let j = 0; j < n; j++) {
      for (let v = -W; v <= W; v++) {
        const delta = v - cur.w[j];
        if (delta === 0) continue;
        for (let k = 0; k < xs.length; k++) trial[k] = sums[k] + (xs[k][j] ? delta : 0);
        const w2 = cur.w.slice();
        w2[j] = v;
        const f = robustFit(d, w2, trial);
        if (robustBetter(f, cur)) {
          cur = f;
          sums.set(trial);
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return cur;
}

/**
 * Starting points for the robust local search: the class-centroid difference cut at every
 * magnitude level (a quantised linear discriminant), plus the perceptron's pocket weights.
 */
function robustStarts(d: Data, W: number): number[][] {
  const { n, xs } = d;
  let np = 0, nn = 0;
  const diff = new Array<number>(n).fill(0);
  xs.forEach((x, k) => {
    np += d.pos[k];
    nn += d.neg[k];
  });
  xs.forEach((x, k) => {
    for (let j = 0; j < n; j++) if (x[j]) diff[j] += (np ? d.pos[k] / np : 0) - (nn ? d.neg[k] / nn : 0);
  });
  const big = Math.max(...diff.map(Math.abs));
  if (big === 0) return [];
  const levels = [...new Set(diff.map((v) => Math.abs(v)))].filter((v) => v > 0).sort((a, b) => b - a);
  return levels.map((cut) => diff.map((v) => (Math.abs(v) + EPS >= cut ? Math.max(1, Math.round((Math.abs(v) * W) / big)) * Math.sign(v) : 0)));
}

// ------------------------------------------------------------------ public: single neuron

type NeuronFields = Pick<TrainedNeuron, 'weights' | 'theta' | 'epochs' | 'method' | 'exhaustive' | 'history'>;

function neuronFrom(d: Data, W: number, prefer: 'gates' | 'robust', fields: NeuronFields): TrainedNeuron {
  const errors = errorsOf(d, fields.weights, fields.theta);
  const r = errors === 0 ? robustFit(d, fields.weights) : undefined;
  const margin = r && Number.isFinite(r.score) ? r.score : 0;
  return { kind: 'neuron', nIn: d.n, ...fields, accuracy: 1 - errors / d.total, errors, converged: errors === 0, maxWeight: W, prefer, margin };
}

function checkPrefer(p: TrainOptions['prefer']): 'gates' | 'robust' {
  if (p !== undefined && p !== 'gates' && p !== 'robust') throw new Error(`prefer must be 'gates' or 'robust'`);
  return p ?? 'gates';
}

function trainData(d: Data, opts: TrainOptions): TrainedNeuron {
  const prefer = checkPrefer(opts.prefer);
  // one class only: a constant neuron is both the smallest and the only sensible answer
  const oneClass = d.pos.every((v) => v === 0) || d.neg.every((v) => v === 0);
  if (prefer === 'robust' && !oneClass) return trainRobust(d, opts);
  return { ...trainGates(d, opts), prefer };
}

function trainRobust(d: Data, opts: TrainOptions): TrainedNeuron {
  const W = checkMaxWeight(opts.maxWeight);
  const method = opts.method ?? 'auto';
  const budget = method === 'exact' ? Infinity : opts.budget ?? 2e7;
  if (method !== 'perceptron') {
    const r = robustExact(d, W, budget);
    if (r) return neuronFrom(d, W, 'robust', { weights: r.best.w, theta: r.best.theta, epochs: 0, method: 'exact', exhaustive: true, history: [] });
  }
  const p1 = perceptron(d, W, opts.epochs ?? 200, opts.seed ?? 1);
  const starts = [...robustStarts(d, W), p1.fit.w];
  if (W < MAX_NEURON_WEIGHT) starts.push(quantize(perceptron(d, Math.min(MAX_NEURON_WEIGHT, 8 * W), opts.epochs ?? 200, opts.seed ?? 1).fit.w, W));
  let best: RobustFit | undefined;
  for (const s of starts) {
    const f = robustPolish(d, W, s);
    if (!best || robustBetter(f, best)) best = f;
  }
  return neuronFrom(d, W, 'robust', { weights: best!.w, theta: best!.theta, epochs: p1.epochs, method: 'local-search', exhaustive: false, history: p1.history });
}

function trainGates(d: Data, opts: TrainOptions): TrainedNeuron {
  const W = checkMaxWeight(opts.maxWeight);
  const method = opts.method ?? 'auto';
  const budget = opts.budget ?? 2e7;
  let partial: ExactResult | undefined;
  if (method !== 'perceptron') {
    const r = exactSearch(d, W, method === 'exact' ? Infinity : budget);
    if (r.best && (r.complete || r.err === 0)) {
      // err === 0 at an aborted level is still a separator, just maybe not the minimal one
      return neuronFrom(d, W, 'gates', { weights: r.best.w, theta: r.best.theta, epochs: 0, method: 'exact', exhaustive: r.complete, history: [] });
    }
    partial = r;
  }
  const epochs = opts.epochs ?? 200, seed = opts.seed ?? 1;
  // 1) perceptron at the target precision; 2) at a wider precision, quantized down; both polished
  const runs = [perceptron(d, W, epochs, seed)];
  if (W < MAX_NEURON_WEIGHT) {
    const wide = perceptron(d, Math.min(MAX_NEURON_WEIGHT, 8 * W), epochs, seed);
    runs.push({ ...wide, fit: fitTheta(d, quantize(wide.fit.w, W)) });
  }
  let best = runs[0], bestFit = polish(d, W, runs[0].fit);
  for (const r of runs.slice(1)) {
    const f = polish(d, W, r.fit);
    if (better(f, bestFit)) { best = r; bestFit = f; }
  }
  if (partial?.best && partial.err < bestFit.err) {
    return neuronFrom(d, W, 'gates', { weights: partial.best.w, theta: partial.best.theta, epochs: best.epochs, method: 'exact', exhaustive: false, history: best.history });
  }
  return neuronFrom(d, W, 'gates', { weights: bestFit.w, theta: bestFit.theta, epochs: best.epochs, method: 'perceptron', exhaustive: false, history: best.history });
}

/** Learn one binarized threshold neuron y = [Σ w_i·x_i ≥ θ] with |w_i| <= maxWeight. */
export function trainNeuron(examples: readonly Example[], opts: TrainOptions = {}): TrainedNeuron {
  return trainData(prepareData(examples), opts);
}

/**
 * Can one neuron with |w| <= maxWeight (default 1, ternary) classify every example?
 * Decided by the exact search; `proven` is false when the budget ran out before a proof of
 * non-separability (then `separable` reflects the best effort, i.e. false).
 */
export function separability(examples: readonly Example[], opts: Pick<TrainOptions, 'maxWeight' | 'budget' | 'seed' | 'epochs' | 'prefer'> = {}): { separable: boolean; proven: boolean; neuron: TrainedNeuron } {
  const nr = trainNeuron(examples, opts);
  return { separable: nr.converged, proven: nr.converged || nr.exhaustive, neuron: nr };
}

export function isLinearlySeparable(examples: readonly Example[], opts: Pick<TrainOptions, 'maxWeight' | 'budget'> = {}): boolean {
  return separability(examples, opts).separable;
}

// ------------------------------------------------------------------ two layers: cover by pure neurons

interface Pure {
  spec: { weights: number[]; theta: number };
  /** Bitset over the target points it fires on. */
  covers: bigint;
  size: number;
  cost: number;
  /** Margin (in pixel flips) between the covered targets and the avoid points (robust mode). */
  score: number;
}

const popcount = (b: bigint) => {
  let c = 0;
  while (b) { b &= b - 1n; c++; }
  return c;
};

/**
 * Pure neurons: fire on no `avoid` point. Keyed by the set of `target` points they fire on; only
 * maximal sets are kept, each with its cheapest (Σ|w|, then gates) neuron.
 */
function pureNeurons(n: number, targets: Uint8Array[], avoid: Uint8Array[], W: number, budget: number, robust: boolean): Pure[] {
  const byCover = new Map<bigint, Pure>();
  /**
   * Record neuron (w, θ); `row` = precomputed sums (targets first, then avoid points). Robust mode
   * scores it by its margin in flipped bits, (min covered Σ - max avoid Σ) / max|w|, and centres θ.
   */
  const add = (w: number[], theta: number, row?: ArrayLike<number>) => {
    const sum = (k: number, x: Uint8Array) => (row ? row[k] : sumOf(w, x));
    let covers = 0n, minCov = Infinity, maxAvoid = -Infinity;
    targets.forEach((x, k) => {
      const v = sum(k, x);
      if (v >= theta) { covers |= 1n << BigInt(k); minCov = Math.min(minCov, v); }
    });
    if (!covers) return;
    avoid.forEach((x, k) => { maxAvoid = Math.max(maxAvoid, sum(targets.length + k, x)); });
    const cost = l1(w);
    const big = Math.max(...w.map(Math.abs));
    const score = big ? (minCov - maxAvoid) / big : 0;
    const th = robust ? centredTheta(minCov, maxAvoid) : theta; // same training behaviour, centred in the gap
    const old = byCover.get(covers);
    const better = !old || (robust ? score > old.score + EPS || (score > old.score - EPS && cost < old.cost) : cost < old.cost);
    if (better) byCover.set(covers, { spec: { weights: w.slice(), theta: th }, covers, size: popcount(covers), cost, score });
  };
  /** Margin value used while loosening prototypes. */
  const marginOf = (w: number[], theta: number) => {
    let minCov = Infinity, maxAvoid = -Infinity;
    const big = Math.max(...w.map(Math.abs));
    for (const x of targets) { const v = sumOf(w, x); if (v >= theta && v < minCov) minCov = v; }
    for (const x of avoid) maxAvoid = Math.max(maxAvoid, sumOf(w, x));
    return { score: big ? (minCov - maxAvoid) / big : 0 };
  };
  const m = targets.length + avoid.length;
  const all = [...targets, ...avoid];
  if (Math.pow(2 * W + 1, n) * m * 2 <= budget) {
    // exhaustive: every weight vector, with the lowest θ that keeps every avoid point silent
    // (largest coverage); robust mode also records every higher θ (less coverage, wider margin)
    const w = new Array<number>(n).fill(0);
    const sums = Array.from({ length: n + 1 }, () => new Int32Array(all.length));
    const rec = (i: number) => {
      if (i === n) {
        const row = sums[n];
        let maxAvoid = -Infinity;
        for (let k = targets.length; k < all.length; k++) maxAvoid = Math.max(maxAvoid, row[k]);
        const lo = w.reduce((a, v) => a + Math.min(0, v), 0);
        add(w, Math.max(lo, maxAvoid + 1), row);
        if (robust) {
          const levels = new Set<number>();
          for (let k = 0; k < targets.length; k++) if (row[k] > maxAvoid + 1) levels.add(row[k]);
          for (const t of levels) add(w, t, row);
        }
        return;
      }
      for (let v = -W; v <= W; v++) {
        w[i] = v;
        const s = sums[i], t = sums[i + 1];
        for (let k = 0; k < all.length; k++) t[k] = s[k] + (all[k][i] ? v : 0);
        rec(i + 1);
      }
    };
    rec(0);
  } else {
    // prototypes: the neuron that fires on exactly x (w = ±1 matching x, θ = |x|), then loosened
    // greedily (lower θ / drop synapses) while no avoid point fires, maximising target coverage
    const silent = (w: number[], t: number) => avoid.every((a) => sumOf(w, a) < t);
    const coverage = (w: number[], t: number) => targets.reduce((c, x) => c + (sumOf(w, x) >= t ? 1 : 0), 0);
    for (const p of targets) {
      if (avoid.some((a) => a.every((v, j) => v === p[j]))) continue;
      let w: number[] = Array.from(p, (v) => (v ? 1 : -1));
      let t = p.reduce((a, v) => a + v, 0);
      // tie value at equal coverage: gates mode drops synapses, robust mode keeps the margin
      const value = (w2: number[], t2: number) => (robust ? marginOf(w2, t2).score : -l1(w2));
      let cov = coverage(w, t), val = value(w, t);
      for (;;) {
        let next: { w: number[]; t: number; cov: number; val: number } | undefined;
        const consider = (w2: number[], t2: number) => {
          if (!silent(w2, t2)) return;
          const c = coverage(w2, t2);
          if (c < cov) return;
          const v = value(w2, t2);
          if (!next || c > next.cov || (c === next.cov && v > next.val + EPS)) next = { w: w2, t: t2, cov: c, val: v };
        };
        consider(w, t - 1);
        for (let j = 0; j < n; j++) {
          if (w[j] === 0) continue;
          const w2 = w.slice();
          w2[j] = 0;
          consider(w2, t - (w[j] > 0 ? 1 : 0)); // dropping +1 lowers the reachable sum by one
          consider(w2, t);
        }
        // every move lowers θ or drops a synapse, so this terminates
        if (!next || (next.cov === cov && next.val < val - EPS)) break;
        ({ w, t, cov, val } = next);
      }
      add(w, t);
    }
  }
  // keep non-dominated sets only: gates mode by coverage; robust mode by (coverage, margin)
  const sets = [...byCover.values()].sort(robust
    ? (a, b) => b.score - a.score || b.size - a.size || a.cost - b.cost
    : (a, b) => b.size - a.size || a.cost - b.cost);
  const kept: Pure[] = [];
  for (const s of sets) if (!kept.some((k) => (k.covers & s.covers) === s.covers)) kept.push(s);
  return kept;
}

/** Smallest cover (iterative deepening up to maxK, node-limited), greedy beyond. */
function setCover(universe: bigint, sets: Pure[], maxK: number): Pure[] | undefined {
  const coverable = sets.reduce((a, s) => a | s.covers, 0n);
  if ((coverable & universe) !== universe) return undefined;
  const nBits = universe.toString(2).length;
  const containing: Pure[][] = Array.from({ length: nBits }, (_, k) => sets.filter((s) => (s.covers >> BigInt(k)) & 1n));
  let nodes = 0;
  const NODE_LIMIT = 200_000;
  const dfs = (left: bigint, k: number, chosen: Pure[]): Pure[] | undefined => {
    if (!left) return chosen;
    if (k === 0 || ++nodes > NODE_LIMIT) return undefined;
    // branch on the uncovered point with the fewest options
    let pick = -1;
    for (let b = 0; b < nBits; b++) {
      if ((left >> BigInt(b)) & 1n && (pick < 0 || containing[b].length < containing[pick].length)) pick = b;
    }
    for (const s of containing[pick]) {
      const r = dfs(left & ~s.covers, k - 1, [...chosen, s]);
      if (r) return r;
    }
    return undefined;
  };
  for (let k = 1; k <= maxK && nodes <= NODE_LIMIT; k++) {
    const r = dfs(universe, k, []);
    if (r) return r;
  }
  const out: Pure[] = [];
  let left = universe;
  while (left) {
    let best = sets[0], bestGain = -1;
    for (const s of sets) {
      const g = popcount(s.covers & left);
      if (g > bestGain) { best = s; bestGain = g; }
    }
    out.push(best);
    left &= ~best.covers;
  }
  return out;
}

const NAMES = 'abcdefghijklmnopqrstuvwxyz';

function coverNetwork(d: Data, positive: boolean, W: number, budget: number, maxHidden: number, robust: boolean): { layers: NeuronSpec[][]; margin: number } | undefined {
  // majority label per distinct point; points with tied labels count as negative for 'or' / positive for 'nor'
  const isTarget = (k: number) => (positive ? d.pos[k] > d.neg[k] : d.neg[k] > d.pos[k]);
  const targets = d.xs.filter((_, k) => isTarget(k));
  const avoid = d.xs.filter((_, k) => !isTarget(k));
  if (targets.length === 0 || avoid.length === 0) return undefined;
  const pure = pureNeurons(d.n, targets, avoid, W, budget, robust);
  const universe = (1n << BigInt(targets.length)) - 1n;
  let pool = pure;
  if (robust) {
    // bottleneck cover: the largest margin τ such that neurons with margin >= τ still cover every
    // target, then the fewest such neurons
    for (const tau of [...new Set(pure.map((p) => p.score))].sort((a, b) => b - a)) {
      const ok = pure.filter((p) => p.score >= tau - EPS);
      if ((ok.reduce((a, p) => a | p.covers, 0n) & universe) === universe) { pool = ok; break; }
    }
  }
  const cover = setCover(universe, pool, maxHidden);
  if (!cover) return undefined;
  const hidden: NeuronSpec[] = cover.map((p, i) => ({ weights: p.spec.weights, theta: p.spec.theta, name: `h${NAMES[i % 26]}${i >= 26 ? i : ''}` }));
  const k = hidden.length;
  const out: NeuronSpec = positive
    ? { weights: new Array(k).fill(1), theta: 1, name: 'or' }
    : { weights: new Array(k).fill(-1), theta: 0, name: 'nor' };
  return { layers: [hidden, [out]], margin: Math.min(...cover.map((p) => p.score)) };
}

function networkErrors(examples: readonly Example[], layers: NeuronSpec[][]): number {
  return examples.reduce((e, ex) => e + (evalNetwork(layers, ex.x)[0] === ex.y ? 0 : 1), 0);
}

/**
 * Learn a single neuron if one fits, otherwise a 2-layer network (k hidden neurons + an OR/NOR
 * output neuron) with as few hidden neurons as the search finds, then fewest gates.
 */
export function trainNetwork(examples: readonly Example[], opts: TrainNetworkOptions = {}): TrainedNetwork {
  const d = prepareData(examples);
  const W = checkMaxWeight(opts.maxWeight);
  const single = trainData(d, opts);
  const separable = single.converged ? true : single.exhaustive ? false : null;
  const singleNet = (): TrainedNetwork => ({
    kind: 'network', nIn: d.n, layers: [[{ weights: single.weights, theta: single.theta, name: 'y' }]], hidden: 0, structure: 'single',
    accuracy: single.accuracy, errors: single.errors, converged: single.converged, separable, neuron: single, prefer: single.prefer, margin: single.margin,
  });
  if (single.converged) return singleNet();
  const budget = opts.budget ?? 2e7;
  const maxHidden = opts.maxHidden ?? 6;
  let best: TrainedNetwork | undefined, bestGates = Infinity;
  for (const positive of [true, false]) {
    const robust = single.prefer === 'robust';
    const found = coverNetwork(d, positive, W, budget, maxHidden, robust);
    if (!found) continue;
    const { layers, margin } = found;
    const errors = networkErrors(examples, layers);
    const gates = compileNetwork(d.n, layers, { mode: 'direct' }).counts.nand;
    const cand: TrainedNetwork = {
      kind: 'network', nIn: d.n, layers, hidden: layers[0].length, structure: positive ? 'or' : 'nor',
      accuracy: 1 - errors / d.total, errors, converged: errors === 0, separable, neuron: single, prefer: single.prefer, margin,
    };
    // robust: widest hidden margin first; both: then fewest hidden neurons, then fewest gates
    const wider = robust && best ? (margin > best.margin + EPS ? 1 : margin < best.margin - EPS ? -1 : 0) : 0;
    const better = !best || cand.errors < best.errors || (cand.errors === best.errors && (wider > 0 || (wider === 0 && (cand.hidden < best.hidden || (cand.hidden === best.hidden && gates < bestGates)))));
    if (better) { best = cand; bestGates = gates; }
  }
  if (!best || best.errors >= single.errors) return singleNet();
  return best;
}

// ------------------------------------------------------------------ inference & compilation

export function layersOf(model: TrainedModel): NeuronSpec[][] {
  return model.kind === 'neuron' ? [[{ weights: model.weights, theta: model.theta, name: 'y' }]] : model.layers;
}

/** Model output (0/1) for one input vector. */
export function predict(model: TrainedModel, x: ArrayLike<number>): 0 | 1 {
  return evalNetwork(layersOf(model), x)[0] ? 1 : 0;
}

export function accuracyOf(model: TrainedModel, examples: readonly Example[]): number {
  if (examples.length === 0) return 1;
  return 1 - networkErrors(examples, layersOf(model)) / examples.length;
}

export interface CompiledModel {
  netlist: Netlist;
  layers: NeuronSpec[][];
  counts: GateCounts;
  /** NAND gates = transistors consumed by TapeOut. */
  gates: number;
  /** Per-neuron NAND count when compiled stand-alone (layer by layer), for the UI breakdown. */
  neuronGates: number[][];
  verification: {
    ok: boolean;
    /** true: all 2^n inputs were checked; false: only the training examples. */
    exhaustive: boolean;
    cases: number;
    failures: { inputs: number[]; got: number; want: number }[];
  };
}

/**
 * Compile a trained model with the existing neuron/network compiler and verify the netlist (as
 * simulated by the TapeOut reference simulator) against the model on every input when
 * nIn <= exhaustiveLimit (default 16), else on the training examples.
 */
export function compileTrained(
  model: TrainedModel,
  opts: BuildOptions & { strategy?: ThresholdStrategy; examples?: readonly Example[]; exhaustiveLimit?: number } = {},
): CompiledModel {
  const layers = layersOf(model);
  const { examples, exhaustiveLimit = 16, ...build } = opts;
  const netlist = compileNetwork(model.nIn, layers, build);
  const prog = programOf(netlist);
  const exhaustive = model.nIn <= exhaustiveLimit;
  if (!exhaustive && !examples?.length) throw new Error(`nIn=${model.nIn} is too large to verify exhaustively: pass the training examples`);
  const failures: CompiledModel['verification']['failures'] = [];
  let cases = 0, mismatches = 0;
  const check = (x: number[]) => {
    cases++;
    const got = run(prog, [], x).outputs[0];
    const want = evalNetwork(layers, x)[0];
    if (got === want) return;
    mismatches++;
    if (failures.length < 16) failures.push({ inputs: x, got, want }); // keep the first few
  };
  if (exhaustive) for (let k = 0; k < 2 ** model.nIn; k++) check(bitsOf(k, model.nIn));
  else for (const e of examples!) check(e.x);
  const neuronGates = layers.map((l) => l.map((s) => compileNeuron(s, { mode: 'direct' }).counts.nand));
  return { netlist, layers, counts: netlist.counts, gates: netlist.counts.nand, neuronGates, verification: { ok: mismatches === 0, exhaustive, cases, failures } };
}

// ------------------------------------------------------------------ pixel helpers & presets

/**
 * Row-major bits of a pixel grid. Rows are arrays of 0/1/booleans, or strings where '#', 'X', 'x',
 * '1' and '*' are lit and anything else ('.', ' ', '0') is dark. All rows must be the same width.
 */
export function gridToBits(rows: readonly (string | readonly (number | boolean)[])[]): number[] {
  const lit = (c: string) => c === '#' || c === 'X' || c === 'x' || c === '1' || c === '*';
  const norm = rows.map((r) => (typeof r === 'string' ? [...r].map((c) => (lit(c) ? 1 : 0)) : r.map((v) => (v ? 1 : 0))));
  const w = norm[0]?.length ?? 0;
  if (norm.some((r) => r.length !== w)) throw new Error('grid rows must all have the same width');
  return norm.flat();
}

/** Inverse of gridToBits: bits (row-major) to rows of 0/1. */
export function bitsToGrid(bits: readonly number[], cols: number): number[][] {
  if (!Number.isInteger(cols) || cols <= 0 || bits.length % cols) throw new Error(`cannot split ${bits.length} bits into rows of ${cols}`);
  return Array.from({ length: bits.length / cols }, (_, r) => bits.slice(r * cols, r * cols + cols).map((v) => (v ? 1 : 0)));
}

/** Pixel labels r{row}c{col}, matching the catalog's line detector. */
export function pixelLabels(rows: number, cols: number): string[] {
  return Array.from({ length: rows * cols }, (_, i) => `r${Math.floor(i / cols)}c${i % cols}`);
}

export interface TrainingPreset {
  id: string;
  name: string;
  description: string;
  /** Grid shape for pixel presets; absent for plain bit-vector presets. */
  grid?: { rows: number; cols: number };
  inputs: string[];
  examples: Example[];
  /**
   * Novel drawings NOT in `examples` (shifted, gapped, noisy strokes) for the "try it" pad: a
   * robust model should classify them correctly. Empty for full truth tables (nothing is unseen).
   */
  heldOut: Example[];
  /** What the trainer is expected to end up with (for the demo narrative). */
  expect: 'neuron' | 'network';
}

const ex = (y: 0 | 1, ...rows: string[]): Example => ({ x: gridToBits(rows), y });

function truthTablePreset(id: string, name: string, description: string, n: number, f: (x: number[]) => number, expect: 'neuron' | 'network', heldOutRows: number[] = []): TrainingPreset {
  const all = Array.from({ length: 2 ** n }, (_, k) => {
    const x = bitsOf(k, n);
    return { x, y: (f(x) ? 1 : 0) as 0 | 1 };
  });
  const held = new Set(heldOutRows);
  return {
    id, name, description, inputs: Array.from({ length: n }, (_, i) => `x${i}`), expect,
    examples: all.filter((_, k) => !held.has(k)),
    heldOut: all.filter((_, k) => held.has(k)),
  };
}

// Training sets mix clean strokes with partial and noisy ones; held-out sets are strokes the
// trainer never saw. With prefer: 'robust' every preset classifies its held-out set perfectly; the
// gate-minimal models often do not (they lean on one or two pixels).
export const TRAINING_PRESETS: TrainingPreset[] = [
  {
    id: 'corner-vs-center',
    name: 'Center vs Corner',
    description: '3×3: fire when the stroke goes through the center, stay silent for strokes that keep to the corners and edges.',
    grid: { rows: 3, cols: 3 },
    inputs: pixelLabels(3, 3),
    expect: 'neuron',
    examples: [
      ex(1, '...', '.#.', '...'), ex(1, '.#.', '.#.', '...'), ex(1, '...', '##.', '...'), ex(1, '...', '.##', '...'),
      ex(1, '...', '.#.', '.#.'), ex(1, '#..', '.#.', '..#'), ex(1, '..#', '.#.', '#..'), ex(1, '...', '###', '...'),
      ex(1, '.#.', '.#.', '.#.'), ex(1, '.#.', '###', '.#.'), ex(1, '..#', '.#.', '...'), ex(1, '#..', '.##', '...'),
      ex(0, '#..', '...', '...'), ex(0, '..#', '...', '...'), ex(0, '...', '...', '#..'), ex(0, '...', '...', '..#'),
      ex(0, '##.', '...', '...'), ex(0, '...', '..#', '..#'), ex(0, '...', '#..', '#..'), ex(0, '...', '...', '.##'),
      ex(0, '##.', '#..', '...'), ex(0, '...', '..#', '.##'), ex(0, '###', '...', '...'), ex(0, '#..', '#..', '#..'),
    ],
    heldOut: [
      ex(1, '...', '.#.', '.##'), ex(1, '##.', '.#.', '...'), ex(1, '###', '.#.', '...'), ex(1, '...', '###', '.#.'), ex(1, '...', '.#.', '#..'),
      ex(0, '...', '...', '###'), ex(0, '..#', '..#', '..#'), ex(0, '#..', '...', '..#'), ex(0, '.#.', '...', '...'), ex(0, '###', '#.#', '###'),
    ],
  },
  {
    id: 'diagonal',
    name: 'Diagonal Detector',
    description: '3×3: fire on diagonal strokes (full, partial or with a stray pixel), stay silent on rows and columns.',
    grid: { rows: 3, cols: 3 },
    inputs: pixelLabels(3, 3),
    expect: 'neuron',
    examples: [
      ex(1, '#..', '.#.', '..#'), ex(1, '..#', '.#.', '#..'), ex(1, '#..', '.#.', '...'), ex(1, '...', '.#.', '..#'),
      ex(1, '..#', '.#.', '...'), ex(1, '...', '.#.', '#..'), ex(1, '##.', '.#.', '..#'), ex(1, '..#', '.#.', '#.#'),
      ex(0, '###', '...', '...'), ex(0, '...', '###', '...'), ex(0, '...', '...', '###'),
      ex(0, '#..', '#..', '#..'), ex(0, '.#.', '.#.', '.#.'), ex(0, '..#', '..#', '..#'),
      ex(0, '##.', '...', '...'), ex(0, '...', '.##', '...'), ex(0, '...', '...', '.##'), ex(0, '#..', '#..', '...'),
      ex(0, '...', '.#.', '.#.'), ex(0, '...', '..#', '..#'), ex(0, '...', '...', '...'),
    ],
    heldOut: [
      ex(1, '#..', '##.', '..#'), ex(1, '..#', '.##', '#..'), ex(1, '#..', '.#.', '.##'), ex(1, '.##', '.#.', '#..'),
      ex(0, '.##', '...', '...'), ex(0, '...', '##.', '...'), ex(0, '.#.', '.#.', '...'), ex(0, '...', '#..', '#..'), ex(0, '..#', '..#', '...'),
    ],
  },
  {
    id: 'horizontal-vs-vertical',
    name: 'Horizontal vs Vertical',
    description: '3×3: fire on horizontal strokes, stay silent on vertical ones. No single neuron can: every row and column share the same total weight. Two layers can.',
    grid: { rows: 3, cols: 3 },
    inputs: pixelLabels(3, 3),
    expect: 'network',
    examples: [
      ex(1, '###', '...', '...'), ex(1, '...', '###', '...'), ex(1, '...', '...', '###'),
      ex(1, '##.', '...', '...'), ex(1, '.##', '...', '...'), ex(1, '...', '##.', '...'),
      ex(1, '...', '.##', '...'), ex(1, '...', '...', '##.'), ex(1, '...', '...', '.##'),
      ex(0, '#..', '#..', '#..'), ex(0, '.#.', '.#.', '.#.'), ex(0, '..#', '..#', '..#'),
      ex(0, '#..', '#..', '...'), ex(0, '...', '#..', '#..'), ex(0, '.#.', '.#.', '...'),
      ex(0, '...', '.#.', '.#.'), ex(0, '..#', '..#', '...'), ex(0, '...', '..#', '..#'),
    ],
    heldOut: [
      ex(1, '#.#', '...', '...'), ex(1, '...', '#.#', '...'), ex(1, '...', '...', '#.#'), ex(1, '###', '...', '..#'),
      ex(0, '#..', '...', '#..'), ex(0, '.#.', '...', '.#.'), ex(0, '..#', '...', '..#'), ex(0, '#..', '#..', '#.#'),
    ],
  },
  {
    id: 'left-vs-right',
    name: 'Left vs Right',
    description: '4×4: fire when the stroke is in the left half, stay silent when it is in the right half.',
    grid: { rows: 4, cols: 4 },
    inputs: pixelLabels(4, 4),
    expect: 'neuron',
    examples: [
      ex(1, '#...', '#...', '#...', '#...'), ex(1, '.#..', '.#..', '.#..', '.#..'), ex(1, '##..', '##..', '....', '....'),
      ex(1, '....', '....', '##..', '##..'), ex(1, '#...', '.#..', '#...', '.#..'), ex(1, '....', '##..', '##..', '....'),
      ex(1, '#...', '#...', '....', '....'), ex(1, '....', '.#..', '.#..', '.#..'), ex(1, '##..', '....', '....', '....'),
      ex(1, '....', '....', '....', '##..'), ex(1, '.#..', '#...', '....', '....'), ex(1, '#...', '##..', '#...', '...#'),
      ex(0, '..#.', '..#.', '..#.', '..#.'), ex(0, '...#', '...#', '...#', '...#'), ex(0, '..##', '..##', '....', '....'),
      ex(0, '....', '....', '..##', '..##'), ex(0, '...#', '..#.', '...#', '..#.'), ex(0, '....', '..##', '..##', '....'),
      ex(0, '...#', '...#', '....', '....'), ex(0, '....', '..#.', '..#.', '..#.'), ex(0, '..##', '....', '....', '....'),
      ex(0, '....', '....', '....', '..##'), ex(0, '..#.', '...#', '....', '....'), ex(0, '...#', '..##', '#..#', '....'),
    ],
    heldOut: [
      ex(1, '....', '#...', '#...', '#...'), ex(1, '.#..', '.#..', '....', '....'), ex(1, '....', '##..', '....', '....'),
      ex(1, '#...', '....', '#...', '....'), ex(1, '....', '....', '.#..', '#...'), ex(1, '##..', '##..', '##..', '##..'),
      ex(0, '....', '...#', '...#', '...#'), ex(0, '..#.', '..#.', '....', '....'), ex(0, '....', '..##', '....', '....'),
      ex(0, '...#', '....', '...#', '....'), ex(0, '....', '....', '..#.', '...#'), ex(0, '..##', '..##', '..##', '..##'),
    ],
  },
  truthTablePreset('and-3', 'AND-3', 'Fires only when all three inputs are on.', 3, (x) => x[0] & x[1] & x[2], 'neuron'),
  truthTablePreset('majority-3', 'Majority-3', 'Fires when at least two of three inputs are on.', 3, (x) => +(x[0] + x[1] + x[2] >= 2), 'neuron'),
  // half of the table is held out: can the trainer infer "majority" from 16 rows?
  truthTablePreset('majority-5', 'Majority-5 (half seen)', 'Fires when at least three of five inputs are on. Trained on 16 of the 32 rows; the other 16 are held out.', 5,
    (x) => +(x[0] + x[1] + x[2] + x[3] + x[4] >= 3), 'neuron', [1, 2, 7, 8, 11, 12, 13, 14, 17, 18, 19, 20, 22, 25, 28, 30]),
  truthTablePreset('xor', 'XOR', 'The classic: no single neuron can learn it.', 2, (x) => x[0] ^ x[1], 'network'),
  truthTablePreset('parity-3', 'Parity-3', 'Odd number of inputs on. Needs a hidden layer.', 3, (x) => x[0] ^ x[1] ^ x[2], 'network'),
];

export function getPreset(id: string): TrainingPreset {
  const p = TRAINING_PRESETS.find((t) => t.id === id);
  if (!p) throw new Error(`unknown training preset ${id}`);
  return p;
}
