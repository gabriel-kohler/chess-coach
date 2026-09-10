// Quick engine lookup while authoring repertoire lines.
//
//   node scripts/eval.mjs "e4 e5 Nf3 Nc6 Bc4" --depth=18 --multipv=4
//   node scripts/eval.mjs --fen="<fen>" --multipv=3
//
// Prints the top moves in SAN with scores from White's point of view.
import { Chess } from 'chess.js';
import { UciEngine } from './lib/uci-engine.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const moves = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ').trim();
const depth = Number(args.depth ?? 18);
const multipv = Number(args.multipv ?? 4);

const chess = typeof args.fen === 'string' ? new Chess(args.fen) : new Chess();
for (const san of moves.split(/\s+/).filter(Boolean).map((m) => m.replace(/^\d+\.+/, '')).filter(Boolean)) {
  try {
    chess.move(san);
  } catch {
    console.error(`illegal move: ${san}`);
    process.exit(1);
  }
}

const engine = new UciEngine();
await engine.init({ hash: 64 });
const lines = await engine.analyse(chess.fen(), { depth, multipv });
engine.quit();

const sign = chess.turn() === 'w' ? 1 : -1;
console.log(`FEN ${chess.fen()}  (${chess.turn() === 'w' ? 'white' : 'black'} to move, depth ${depth})`);
for (const l of lines) {
  const c = new Chess(chess.fen());
  const san = [];
  for (const uci of l.pv.slice(0, 10)) {
    try {
      san.push(c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san);
    } catch {
      break;
    }
  }
  const score = l.mate !== undefined ? `#${sign * l.mate}` : ((sign * (l.cp ?? 0)) / 100).toFixed(2);
  console.log(`${score.padStart(7)}  ${san.join(' ')}`);
}
