// Builds the local tactics bank from the Lichess puzzle database (CC0).
//
//   npm run build:puzzles
//
// Downloads https://database.lichess.org/lichess_db_puzzle.csv.zst into .cache
// (if missing), keeps only well-calibrated, popular puzzles, and writes one
// JSON file per 50-point rating bucket to public/puzzles/. Selection is
// stratified by motif so every bucket has enough forks, pins, mates, etc.
// The opening puzzles (an opponent's mistake in the opening, punished) also
// go to public/puzzles/openings/<Family>.json with their opening tag, for
// Aberturas > Punir. Each bucket also keeps its best puzzles from titled
// players' games with three or more moves to find, for Tática > Cálculo:
// the motif strata favour short puzzles, and these would be scarce otherwise.
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(root, '.cache', 'lichess_db_puzzle.csv.zst');
const OUT = join(root, 'public', 'puzzles');
const URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';

const MIN_RATING = 500;
const MAX_RATING = 2800;
const BUCKET = 50;
const MAX_RD = 90;
const MIN_POPULARITY = 80;
const MIN_PLAYS = 300;
const PER_THEME = 140; // best puzzles kept per (bucket, motif)
const FILL = 1200; // extra random puzzles per bucket, for untagged variety

// Tags that describe length/source/evaluation rather than a tactical idea.
const META = new Set(['short', 'long', 'veryLong', 'oneMove', 'master', 'masterVsMaster', 'superGM', 'crushing', 'advantage', 'equality', 'middlegame', 'opening', 'endgame', 'mate']);

// Opening puzzles: the best 25 per (opening variation, color that solves, 100-point band), 700 to 2299.
const OPENING_MIN = 700;
const OPENING_MAX = 2300;
const OPENING_BAND = 100;
const PER_VARIATION = 25;

// Cálculo: games with a titled player, three moves or more of yours (Lichess: long = 3, veryLong = 4+).
const CALC_SOURCES = new Set(['master', 'masterVsMaster', 'superGM']);
const CALC_LENGTH = new Set(['long', 'veryLong']);
const CALC_PER_BUCKET = 600;
const isCalc = (themes) => themes.some((t) => CALC_SOURCES.has(t)) && themes.some((t) => CALC_LENGTH.has(t));

if (!existsSync(CACHE)) {
  mkdirSync(dirname(CACHE), { recursive: true });
  console.log(`downloading ${URL} ...`);
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(CACHE));
}

// Keeps the best N items by score.
class TopN {
  constructor(n) { this.n = n; this.items = []; this.min = -Infinity; }
  push(score, item) {
    if (this.items.length >= this.n && score <= this.min) return;
    this.items.push([score, item]);
    if (this.items.length > this.n * 2) this.compact();
  }
  compact() {
    this.items.sort((a, b) => b[0] - a[0]);
    this.items.length = Math.min(this.items.length, this.n);
    this.min = this.items.length >= this.n ? this.items[this.items.length - 1][0] : -Infinity;
  }
  values() { this.compact(); return this.items.map((x) => x[1]); }
}

const buckets = new Map(); // bucket -> { byTheme: Map<theme, TopN>, calc: TopN, fill: reservoir[] , seen }
const openings = new Map(); // `${variation}|${solver}|${band}` -> { family, variation, top: TopN }
const themeCount = new Map();
let total = 0;
let kept = 0;

function bucketOf(rating) { return Math.floor(rating / BUCKET) * BUCKET; }

const zstd = spawn('zstd', ['-dc', CACHE], { stdio: ['ignore', 'pipe', 'inherit'] });
const rl = createInterface({ input: zstd.stdout, crlfDelay: Infinity });
let header = true;
for await (const line of rl) {
  if (header) { header = false; continue; }
  total++;
  const f = line.split(',');
  const rating = Number(f[3]);
  const rd = Number(f[4]);
  const popularity = Number(f[5]);
  const plays = Number(f[6]);
  if (rating < MIN_RATING || rating >= MAX_RATING || rd > MAX_RD || popularity < MIN_POPULARITY || plays < MIN_PLAYS) continue;
  const themes = f[7].split(' ').filter(Boolean);
  const moves = f[2];
  if (moves.split(' ').length < 2) continue;
  kept++;
  const b = bucketOf(rating);
  let entry = buckets.get(b);
  if (!entry) { entry = { byTheme: new Map(), calc: new TopN(CALC_PER_BUCKET), fill: [], seen: 0 }; buckets.set(b, entry); }
  const puzzle = { id: f[0], fen: f[1], moves, rating, popularity, plays, themes };
  const score = popularity + 8 * Math.log10(plays);
  // An opening puzzle with its opening: the family tag, then the variation's (Sicilian_Defense, Sicilian_Defense_Alapin_Variation).
  const tags = (f[9] ?? '').split(' ').filter(Boolean);
  if (themes.includes('opening') && tags.length && rating >= OPENING_MIN && rating < OPENING_MAX) {
    const family = tags[0];
    const variation = tags[1] ?? family;
    // The setup move is played by the side to move in the FEN: the other one solves.
    const solver = f[1].split(' ')[1] === 'w' ? 'b' : 'w';
    const key = `${variation}|${solver}|${Math.floor(rating / OPENING_BAND)}`;
    let o = openings.get(key);
    if (!o) { o = { family, variation, top: new TopN(PER_VARIATION) }; openings.set(key, o); }
    o.top.push(score, puzzle);
  }
  if (isCalc(themes)) entry.calc.push(score, puzzle);
  for (const t of themes) {
    if (META.has(t)) continue;
    let top = entry.byTheme.get(t);
    if (!top) { top = new TopN(PER_THEME); entry.byTheme.set(t, top); }
    top.push(score, puzzle);
  }
  // Reservoir sample for variety beyond the per-theme leaders.
  entry.seen++;
  if (entry.fill.length < FILL) entry.fill.push(puzzle);
  else {
    const j = Math.floor(Math.random() * entry.seen);
    if (j < FILL) entry.fill[j] = puzzle;
  }
  if (total % 500000 === 0) process.stderr.write(`  read ${total} puzzles, ${kept} pass the filter\r`);
}
console.log(`\nread ${total}, passed filter ${kept}`);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const themeIndex = new Map();
const themeId = (t) => {
  if (!themeIndex.has(t)) themeIndex.set(t, themeIndex.size);
  return themeIndex.get(t);
};

const index = { source: 'Lichess puzzle database (CC0)', builtAt: new Date().toISOString(), bucketSize: BUCKET, themes: [], buckets: [] };
let written = 0;
for (const b of [...buckets.keys()].sort((x, y) => x - y)) {
  const entry = buckets.get(b);
  const chosen = new Map();
  for (const top of entry.byTheme.values()) for (const p of top.values()) chosen.set(p.id, p);
  for (const p of entry.calc.values()) chosen.set(p.id, p);
  for (const p of entry.fill) chosen.set(p.id, p);
  const calc = [...chosen.values()].filter((p) => isCalc(p.themes)).length;
  const rows = [...chosen.values()]
    .sort((x, y) => x.rating - y.rating)
    .map((p) => [p.id, p.fen, p.moves, p.rating, p.popularity, p.plays, p.themes.map(themeId)]);
  const perTheme = {};
  for (const r of rows) for (const t of r[6]) perTheme[t] = (perTheme[t] ?? 0) + 1;
  for (const r of rows) for (const t of r[6]) themeCount.set(t, (themeCount.get(t) ?? 0) + 1);
  writeFileSync(join(OUT, `r${b}.json`), JSON.stringify(rows));
  index.buckets.push({ rating: b, file: `r${b}.json`, count: rows.length, calc, themes: perTheme });
  written += rows.length;
}
// The opening puzzles, one file per opening family: [id, fen, moves, rating, variation, themes].
mkdirSync(join(OUT, 'openings'), { recursive: true });
const byFamily = new Map();
for (const o of openings.values()) {
  const rows = byFamily.get(o.family) ?? [];
  for (const p of o.top.values()) rows.push([p.id, p.fen, p.moves, p.rating, o.variation, p.themes.map(themeId)]);
  byFamily.set(o.family, rows);
}
index.openings = {};
let openingCount = 0;
for (const [family, rows] of [...byFamily].sort((a, b) => a[0].localeCompare(b[0]))) {
  const file = `openings/${family}.json`;
  writeFileSync(join(OUT, file), JSON.stringify(rows.sort((x, y) => x[3] - y[3])));
  index.openings[family] = { file, count: rows.length };
  openingCount += rows.length;
}
index.themes = [...themeIndex.keys()];
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index));
console.log(`wrote ${written} puzzles in ${index.buckets.length} buckets to public/puzzles (${index.buckets.reduce((s, b) => s + b.calc, 0)} for Cálculo)`);
console.log(`wrote ${openingCount} opening puzzles in ${byFamily.size} openings to public/puzzles/openings`);
