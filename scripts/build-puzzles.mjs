// Builds the local tactics bank from the Lichess puzzle database (CC0).
//
//   npm run build:puzzles
//
// Downloads https://database.lichess.org/lichess_db_puzzle.csv.zst into .cache
// (if missing), keeps only well-calibrated, popular puzzles, and writes one
// JSON file per 50-point rating bucket to public/puzzles/. Selection is
// stratified by motif so every bucket has enough forks, pins, mates, etc.
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

const buckets = new Map(); // bucket -> { byTheme: Map<theme, TopN>, fill: reservoir[] , seen }
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
  if (!entry) { entry = { byTheme: new Map(), fill: [], seen: 0 }; buckets.set(b, entry); }
  const puzzle = { id: f[0], fen: f[1], moves, rating, popularity, plays, themes };
  const score = popularity + 8 * Math.log10(plays);
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
  for (const p of entry.fill) chosen.set(p.id, p);
  const rows = [...chosen.values()]
    .sort((x, y) => x.rating - y.rating)
    .map((p) => [p.id, p.fen, p.moves, p.rating, p.popularity, p.plays, p.themes.map(themeId)]);
  const perTheme = {};
  for (const r of rows) for (const t of r[6]) perTheme[t] = (perTheme[t] ?? 0) + 1;
  for (const r of rows) for (const t of r[6]) themeCount.set(t, (themeCount.get(t) ?? 0) + 1);
  writeFileSync(join(OUT, `r${b}.json`), JSON.stringify(rows));
  index.buckets.push({ rating: b, file: `r${b}.json`, count: rows.length, themes: perTheme });
  written += rows.length;
}
index.themes = [...themeIndex.keys()];
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index));
console.log(`wrote ${written} puzzles in ${index.buckets.length} buckets to public/puzzles`);
