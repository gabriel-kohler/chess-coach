// Takes chapters of the repertoire past the start of the middle game. From
// each line's end: the opponent plays what people at your level play (Lichess
// explorer), else what masters play, else Stockfish's move; you play the
// masters' move when Stockfish finds it within 5 points of its best, else
// Stockfish's (src/lib/repertoire/extend.ts). The lines go to a PGN of their
// own next to the hand-written ones, which stay untouched.
//
//   node scripts/extend-repertoire.mjs --chapters=black-kid-classical,black-kid-fianchetto --to-move=16
//   flags: --out=black-kid-middlegame.pgn --ratings=1400,1600 --depth=16
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import { parsePgn, writePgn } from '../src/lib/chess/pgn.ts';
import { winDrop } from '../src/lib/repertoire/accept.ts';
import { compileChapter, epdOf, mergeSides, turnOf } from '../src/lib/repertoire/compile.ts';
import { decided, mastersChoice, opponentReplies, ourMove, treeFromLines } from '../src/lib/repertoire/extend.ts';
import { createPool, scoreOf } from './lib/uci-engine.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src', 'data', 'repertoire');
const CACHE_DIR = join(root, '.cache');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const CHAPTERS = String(args.chapters ?? '').split(',').filter(Boolean);
const TO_MOVE = Number(args['to-move'] ?? 16);
const DEPTH = Number(args.depth ?? 16);
const RATINGS = String(args.ratings ?? '1400,1600');
if (!CHAPTERS.length) {
  console.error('usage: node scripts/extend-repertoire.mjs --chapters=id1,id2 [--to-move=16]');
  process.exit(1);
}
const OUT = resolve(SRC, String(args.out ?? `${CHAPTERS[0].split('-').slice(0, 2).join('-')}-middlegame.pgn`));

// The Lichess token stays in this process: read from .env.local, never printed.
const envFile = join(root, '.env.local');
const TOKEN = process.env.LICHESS_TOKEN || (existsSync(envFile) ? /^LICHESS_TOKEN=(.*)$/m.exec(readFileSync(envFile, 'utf8'))?.[1]?.trim() : '') || '';
if (!TOKEN) {
  console.error('LICHESS_TOKEN is not set (.env.local): the explorer needs it.');
  process.exit(1);
}

// ---------------------------------------------------------------- the hand-written repertoire
const results = [];
for (const file of readdirSync(SRC).filter((f) => f.endsWith('.pgn') && !f.endsWith('-middlegame.pgn')).sort()) {
  for (const game of parsePgn(readFileSync(join(SRC, file), 'utf8'))) results.push(compileChapter(game));
}
const { sides } = mergeSides(results);

// ---------------------------------------------------------------- caches
mkdirSync(join(CACHE_DIR, 'engine'), { recursive: true });
mkdirSync(join(CACHE_DIR, 'explorer'), { recursive: true });
const engineFile = join(CACHE_DIR, 'engine', `d${DEPTH}.json`);
const explorerFile = join(CACHE_DIR, 'explorer', 'extend.json');
const engineCache = existsSync(engineFile) ? JSON.parse(readFileSync(engineFile, 'utf8')) : {};
const explorerCache = existsSync(explorerFile) ? JSON.parse(readFileSync(explorerFile, 'utf8')) : {};
const save = (file, data) => {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, file);
};
// Whatever ends the run, a crash or a Ctrl+C included, the answers so far are kept for the next one.
process.on('exit', () => {
  save(engineFile, engineCache);
  save(explorerFile, explorerCache);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130));

const pool = await createPool(1, { hash: 64 });
let searches = 0;
/** The build's cache format: the same key, so its check of these positions is instant. */
async function analyse(fen, multipv) {
  const key = `${epdOf(fen)}|${multipv}`;
  if (engineCache[key]) return engineCache[key];
  const lines = await pool.run((e) => e.analyse(fen, { depth: DEPTH, multipv }));
  engineCache[key] = lines;
  if (++searches % 20 === 0) save(engineFile, engineCache);
  return lines;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let requests = 0;
let lastRequest = 0;
/** One request every 1.5 s (at one a second Lichess asked to wait every 40 or so); a 429 waits a minute. */
async function explorer(kind, fen) {
  const key = `${kind}|${kind === 'lichess' ? RATINGS : ''}|${epdOf(fen)}`;
  if (key in explorerCache) return explorerCache[key];
  const url = kind === 'lichess'
    ? `https://explorer.lichess.ovh/lichess?variant=standard&fen=${encodeURIComponent(fen)}&ratings=${RATINGS}&speeds=blitz,rapid&moves=8&topGames=0&recentGames=0`
    : `https://explorer.lichess.ovh/masters?fen=${encodeURIComponent(fen)}&moves=8&topGames=0`;
  for (let attempt = 0; attempt < 20; attempt++) {
    const wait = lastRequest + 1500 - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    let r;
    let body;
    try {
      // A request that hangs would otherwise wait out Node's 5 minutes; an answer takes well under a second.
      r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
      if (r.ok) body = await r.json();
    } catch (err) {
      // The connection drops now and then over an hour of requests: wait and ask again.
      process.stderr.write(`  explorer: ${err.cause?.code ?? err.name ?? err.message}, trying again in 15 s\n`);
      await sleep(15_000);
      continue;
    }
    requests++;
    if (r.status === 429) {
      process.stderr.write('  Lichess asked to wait: 60 s\n');
      await sleep(60_000);
      continue;
    }
    if (r.status >= 500) {
      process.stderr.write(`  explorer: ${r.status}, trying again in 15 s\n`);
      await sleep(15_000);
      continue;
    }
    if (!r.ok) throw new Error(`explorer ${kind} ${r.status}`);
    // Read by SAN: castling comes out as the king's two squares whatever notation the explorer uses.
    const moves = (body.moves ?? []).flatMap((m) => {
      try {
        const mv = new Chess(fen).move(m.san);
        return [{ uci: mv.lan, san: mv.san, n: m.white + m.draws + m.black }];
      } catch {
        return [];
      }
    });
    explorerCache[key] = moves;
    if (requests % 25 === 0) save(explorerFile, explorerCache);
    return moves;
  }
  throw new Error('explorer: too many waits');
}

// ---------------------------------------------------------------- extending
const plyOf = (fen) => {
  const [, turn, , , , full] = fen.split(' ');
  return (Number(full) - 1) * 2 + (turn === 'b' ? 1 : 0);
};
const play = (fen, uci) => {
  const c = new Chess(fen);
  const mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return { san: mv.san, fen: c.fen(), over: c.isGameOver() };
};

/** SAN path from the start to a position inside one chapter's own tree. */
function pathIn(positions, target) {
  const start = epdOf(new Chess().fen());
  const prev = new Map([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const e = queue.shift();
    if (e === target) break;
    for (const m of positions[e]?.moves ?? []) {
      if (prev.has(m.to)) continue;
      prev.set(m.to, { from: e, san: m.san });
      queue.push(m.to);
    }
  }
  if (!prev.has(target)) return null;
  const path = [];
  for (let e = target; prev.get(e); e = prev.get(e).from) path.unshift(prev.get(e).san);
  return path;
}

/** On your first move past the hand-written line (the chapter's description says the rest). */
const NOTE = 'Começa o meio-jogo: daqui em diante, lances de mestres conferidos pelo Stockfish.';
const stats = { masters: 0, engine: 0, level: 0, mastersReply: 0, engineReply: 0, joined: 0, decided: 0 };
const t0 = Date.now();
const games = [];
const lineEnds = [];
let added = 0;
// Answers already given, per color: the repertoire's, then this run's, across chapters (a transposition joins them).
const answeredBy = {};

for (const id of CHAPTERS) {
  const r = results.find((x) => x.chapter.id === id);
  if (!r) throw new Error(`no chapter ${id}`);
  const side = sides[r.chapter.side];
  const us = r.chapter.side;
  answeredBy[us] ??= new Map(Object.values(side.positions).filter((p) => turnOf(p.fen) === us && p.moves.length).map((p) => [p.epd, p.moves[0].uci]));
  const answered = answeredBy[us];
  const leaves = [];
  for (const pos of Object.values(r.positions)) {
    if (turnOf(pos.fen) !== us || !pos.moves.length) continue;
    const move = pos.moves[0];
    if (side.positions[move.to]?.moves.length) continue;
    const path = pathIn(r.positions, pos.epd);
    if (!path) continue;
    const after = play(pos.fen, move.uci);
    if (Math.floor((plyOf(after.fen) + 1) / 2) + 1 > TO_MOVE || after.over) continue;
    leaves.push({ path: [...path, move.san], fen: after.fen });
  }
  console.log(`${id}: ${leaves.length} line ends before move ${TO_MOVE}`);
  const lines = [];
  for (const [k, leaf] of leaves.entries()) {
    const stack = [{ path: leaf.path, fen: leaf.fen, first: true }];
    while (stack.length) {
      const { path, fen, first } = stack.pop();
      const ourNumber = Math.floor((plyOf(fen) + 1) / 2) + 1;
      if (ourNumber > TO_MOVE) { lines.push({ moves: path }); continue; }
      const level = await explorer('lichess', fen);
      const levelGames = level.reduce((s, m) => s + m.n, 0);
      const masters = levelGames >= 50 ? null : await explorer('masters', fen);
      const engineBest = levelGames >= 50 || (masters ?? []).reduce((s, m) => s + m.n, 0) >= 20 ? null : ((await analyse(fen, 2))[0]?.move ?? null);
      const replies = opponentReplies(level, masters, engineBest);
      let grew = false;
      for (const reply of replies) {
        const opp = play(fen, reply.uci);
        // A line never ends on the opponent's move.
        if (opp.over) continue;
        stats[reply.source === 'level' ? 'level' : reply.source === 'masters' ? 'mastersReply' : 'engineReply']++;
        const epd = epdOf(opp.fen);
        const known = answered.get(epd);
        if (known) {
          // Reached through another move order: the known answer, and the line joins there.
          lines.push({ moves: [...path, opp.san, play(opp.fen, known).san] });
          stats.joined++;
          grew = true;
          continue;
        }
        const top = await analyse(opp.fen, 3);
        const best = top[0];
        if (!best?.move) continue;
        const bestScore = scoreOf(best);
        const mc = mastersChoice(await explorer('masters', opp.fen));
        let loss = null;
        if (mc) {
          const inTop = top.find((l) => l.move === mc.uci);
          if (inTop) loss = winDrop(bestScore, scoreOf(inTop));
          else {
            const child = play(opp.fen, mc.uci);
            loss = child.over ? null : winDrop(bestScore, -scoreOf((await analyse(child.fen, 2))[0]));
          }
        }
        const ours = ourMove(mc, loss, best.move);
        if (!ours) continue;
        stats[ours.source]++;
        answered.set(epd, ours.uci);
        added++;
        const mine = play(opp.fen, ours.uci);
        const next = [...path, opp.san, mine.san];
        const note = first ? { [next.length - 1]: NOTE } : undefined;
        grew = true;
        if (decided(bestScore) || mine.over) {
          stats.decided += decided(bestScore) ? 1 : 0;
          lines.push({ moves: next, ...(note ? { notes: note } : {}) });
        } else {
          stack.push({ path: next, fen: mine.fen, first: false });
          // Only to carry the note: the line goes on from here.
          if (note) lines.push({ moves: next, notes: note, carrier: true });
        }
      }
      if (!grew) lines.push({ moves: path });
    }
    process.stderr.write(`  ${id}: ${k + 1}/${leaves.length} line ends, ${added} new positions of yours, ${requests} explorer requests, ${Math.round((Date.now() - t0) / 1000)} s\r`);
  }
  for (const l of lines) if (!l.carrier) lineEnds.push(Math.ceil(l.moves.length / 2));
  games.push({
    headers: {
      Id: `${id}-mg`,
      Side: us,
      Name: `${r.chapter.name}: meio-jogo`,
      Description: `As linhas de "${r.chapter.name}" até o lance ${TO_MOVE}: os seus lances são os mais jogados por mestres, conferidos pelo Stockfish; os do adversário, os mais jogados no seu nível.`,
    },
    moves: treeFromLines(lines),
  });
}

save(engineFile, engineCache);
save(explorerFile, explorerCache);
pool.close();
writeFileSync(OUT, games.map((g) => writePgn(g)).join('\n'));
const sorted = [...lineEnds].sort((a, b) => a - b);
console.log(`\nwrote ${OUT}`);
console.log(`  ${added} new positions of yours in ${Math.round((Date.now() - t0) / 1000)} s; ${requests} explorer requests, ${searches} engine searches`);
console.log(`  your moves: ${stats.masters} masters', ${stats.engine} Stockfish's; opponent: ${stats.level} at your level, ${stats.mastersReply} masters', ${stats.engineReply} Stockfish's`);
console.log(`  lines end at move: median ${sorted[Math.floor(sorted.length / 2)]}, max ${sorted.at(-1)} (${sorted.length} lines); ${stats.joined} joined the repertoire, ${stats.decided} stopped decided`);
