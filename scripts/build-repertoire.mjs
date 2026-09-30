// Compiles src/data/repertoire/*.pgn into public/repertoire.json and checks
// every repertoire move with Stockfish.
//
//   node scripts/build-repertoire.mjs                 # all files, writes JSON
//   node scripts/build-repertoire.mjs --only=white-e4 # check one file, no JSON
//   flags: --depth=16 --engines=2 --no-engine --max-ply=40
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import { parsePgn } from '../src/lib/chess/pgn.ts';
import { INACCURACY, MISTAKE, winDrop, winPct } from '../src/lib/repertoire/accept.ts';
import { compileChapter, epdOf, mergeSides, turnOf } from '../src/lib/repertoire/compile.ts';
import { createPool, scoreOf } from './lib/uci-engine.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src', 'data', 'repertoire');
const OUT = join(root, 'public', 'repertoire.json');
const CACHE_DIR = join(root, '.cache', 'engine');

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const DEPTH = Number(args.depth ?? 16);
const ENGINES = Number(args.engines ?? 2);
const MAX_PLY = Number(args['max-ply'] ?? 40);
const only = typeof args.only === 'string' ? args.only : null;


// ---------------------------------------------------------------- compile
const files = readdirSync(SRC).filter((f) => f.endsWith('.pgn') && (!only || f.includes(only))).sort();
if (!files.length) {
  console.error(`no PGN files in ${SRC}${only ? ` matching "${only}"` : ''}`);
  process.exit(1);
}

const results = [];
const errors = [];
for (const file of files) {
  let games;
  try {
    games = parsePgn(readFileSync(join(SRC, file), 'utf8'));
  } catch (e) {
    errors.push(`${file}: ${e.message}`);
    continue;
  }
  for (const game of games) {
    const r = compileChapter(game);
    r.file = file;
    results.push(r);
    errors.push(...r.errors.map((e) => `${file}: ${e}`));
  }
}

const { sides, errors: mergeErrors } = mergeSides(results);
for (const e of mergeErrors) if (!errors.some((x) => x.endsWith(e.slice(e.indexOf(" two answers"))))) errors.push(e);

// SAN path to every position, for readable reports.
function pathsFor(positions) {
  const paths = new Map([[epdOf(new Chess().fen()), []]]);
  const queue = [epdOf(new Chess().fen())];
  while (queue.length) {
    const epd = queue.shift();
    const pos = positions[epd];
    if (!pos) continue;
    for (const m of pos.moves) {
      if (!paths.has(m.to)) {
        paths.set(m.to, [...paths.get(epd), m.san]);
        queue.push(m.to);
      }
    }
  }
  return paths;
}

function fmtPath(path) {
  return path.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}.${san}` : san)).join(' ');
}

// Lines must end with our move: a line ending on the opponent's move leaves the
// student without an answer.
for (const side of Object.values(sides)) {
  const paths = pathsFor(side.positions);
  for (const pos of Object.values(side.positions)) {
    for (const m of pos.moves) {
      const next = side.positions[m.to];
      const endsHere = !next || next.moves.length === 0;
      if (endsHere && turnOf(m.to) === side.side) {
        errors.push(`[${side.side}] line ends on the opponent's move, add our answer: ${fmtPath([...(paths.get(pos.epd) ?? ['?']), m.san])}`);
      }
    }
  }
}

let chapterCount = 0;
for (const s of Object.values(sides)) {
  const ours = Object.values(s.positions).filter((p) => turnOf(p.fen) === s.side).length;
  chapterCount += s.chapters.length;
  if (s.chapters.length) console.log(`${s.side}: ${s.chapters.length} chapters, ${Object.keys(s.positions).length} positions, ${ours} with our move`);
}

if (errors.length) {
  console.log(`\nERRORS (${errors.length}):`);
  for (const e of errors) console.log(`  - ${e}`);
  if (!args['no-engine']) {
    console.log('\nFix the errors above before the engine check.');
    process.exit(1);
  }
}

// ---------------------------------------------------------------- engine
async function engineCheck() {
  mkdirSync(CACHE_DIR, { recursive: true });
  // One cache for every file: entries are keyed by position, so a check of one
  // file and the full build reuse each other's work.
  const cacheFile = join(CACHE_DIR, `d${DEPTH}.json`);
  const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
  // Checks of different files can run at once: write to a temp file and
  // rename, so a reader never sees half a JSON.
  const saveCache = () => {
    const tmp = `${cacheFile}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(cache));
    renameSync(tmp, cacheFile);
  };
  const pool = await createPool(ENGINES, { hash: 64 });
  const warnings = [];
  const problems = [];
  const holes = [];
  let done = 0;

  const analyse = (fen, multipv) => {
    const key = `${epdOf(fen)}|${multipv}`;
    if (cache[key]) return Promise.resolve(cache[key]);
    return pool.run(async (e) => {
      const lines = await e.analyse(fen, { depth: DEPTH, multipv });
      cache[key] = lines;
      if (++done % 25 === 0) {
        process.stderr.write(`  analysed ${done} positions\r`);
        saveCache();
      }
      return lines;
    });
  };

  for (const s of Object.values(sides)) {
    const paths = pathsFor(s.positions);
    const all = Object.values(s.positions).filter((p) => p.ply <= MAX_PLY);
    // Positions reached by our moves (opponent to move) also give us our move's
    // score when it is not among the top lines of the parent.
    const childFens = new Map();
    for (const p of all) for (const m of p.moves) {
      if (turnOf(p.fen) !== s.side) continue;
      const c = new Chess(p.fen);
      c.move(m.san);
      childFens.set(m.to, c.fen());
    }

    await Promise.all(all.map(async (pos) => {
      const ourTurn = turnOf(pos.fen) === s.side;
      const lines = await analyse(pos.fen, ourTurn ? 3 : 2);
      const best = lines[0];
      const sign = turnOf(pos.fen) === 'white' ? 1 : -1;
      pos.eval = best?.mate !== undefined
        ? { mate: sign * best.mate, depth: DEPTH, best: best.move }
        : { cp: sign * (best?.cp ?? 0), depth: DEPTH, best: best?.move };
      const where = fmtPath(paths.get(pos.epd) ?? ['?']) || '(start)';

      if (ourTurn) {
        const move = pos.moves[0];
        if (!move) return;
        let ours = lines.find((l) => l.move === move.uci);
        let ourScore;
        if (ours) ourScore = scoreOf(ours);
        else {
          const childLines = await analyse(childFens.get(move.to), 2);
          ourScore = -scoreOf(childLines[0]);
        }
        const bestScore = scoreOf(best);
        // The same rule the app uses for gap suggestions (src/lib/repertoire/accept.ts).
        const drop = winDrop(bestScore, ourScore);
        if (drop >= INACCURACY) {
          const c = new Chess(pos.fen);
          const bestSan = best ? c.move({ from: best.move.slice(0, 2), to: best.move.slice(2, 4), promotion: best.move[4] }).san : '?';
          const msg = `${where} ... ${move.san}: engine prefers ${bestSan} (${(bestScore / 100).toFixed(2)} vs ${(ourScore / 100).toFixed(2)}, -${drop.toFixed(1)} win%)`;
          (drop >= MISTAKE ? problems : warnings).push(msg);
        }
      } else if (pos.ply <= 20 && pos.moves.length > 0) {
        const covered = new Set(pos.moves.map((m) => m.uci));
        for (const l of lines) {
          if (covered.has(l.move)) continue;
          // Only replies that keep the opponent close to the best line matter.
          if (winPct(scoreOf(best)) - winPct(scoreOf(l)) > 8) continue;
          const c = new Chess(pos.fen);
          const san = c.move({ from: l.move.slice(0, 2), to: l.move.slice(2, 4), promotion: l.move[4] }).san;
          // A reply that transposes into another line has its answer there.
          if (s.positions[epdOf(c.fen())]?.moves.length) continue;
          holes.push(`${where}: opponent reply ${san} (${(-scoreOf(l) / 100).toFixed(2)} for us) is not covered`);
        }
      }
    }));
  }
  saveCache();
  pool.close();

  console.log(`\nENGINE CHECK depth ${DEPTH}`);
  console.log(`  mistakes (>=10 win%): ${problems.length}`);
  for (const p of problems) console.log(`    ! ${p}`);
  console.log(`  inaccuracies (5-10 win%): ${warnings.length}`);
  for (const w of warnings) console.log(`    ? ${w}`);
  console.log(`  uncovered strong replies (ply <= 20): ${holes.length}`);
  for (const h of holes) console.log(`    o ${h}`);
  return problems.length;
}

const problemCount = args['no-engine'] ? 0 : await engineCheck();

if (!only && !errors.length) {
  writeFileSync(OUT, JSON.stringify({ builtAt: new Date().toISOString(), depth: DEPTH, sides }));
  console.log(`\nwrote ${OUT} (${chapterCount} chapters)`);
}
process.exit(problemCount ? 2 : 0);
