// Tactical facts computed with chess.js, never guessed: every motif here is a
// concrete geometric or material condition on the board.
import { Chess, type Move, type Square } from 'chess.js';

export const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
export const PIECE_NAME: Record<string, string> = { p: 'peão', n: 'cavalo', b: 'bispo', r: 'torre', q: 'dama', k: 'rei' };
const ARTICLE: Record<string, string> = { p: 'o', n: 'o', b: 'o', r: 'a', q: 'a', k: 'o' };
const FILES = 'abcdefgh';
const ROOK_DIRS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS: Array<[number, number]> = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

export interface Motif {
  theme: string;
  /** Plain-language detail, e.g. "o cavalo em f6 fica cravado na dama em d8". */
  text: string;
}

const named = (type: string, square: string) => `${ARTICLE[type]} ${PIECE_NAME[type]} em ${square}`;
const xy = (s: string): [number, number] => [FILES.indexOf(s[0]!), Number(s[1]) - 1];
const at = (f: number, r: number) => (f >= 0 && f < 8 && r >= 0 && r < 8 ? `${FILES[f]}${r + 1}` : null);

function dirsOf(type: string): Array<[number, number]> {
  if (type === 'r') return ROOK_DIRS;
  if (type === 'b') return BISHOP_DIRS;
  if (type === 'q') return [...ROOK_DIRS, ...BISHOP_DIRS];
  return [];
}

/** First two pieces met walking from `from` in a direction. */
function ray(chess: Chess, from: string, [df, dr]: [number, number]) {
  const [f0, r0] = xy(from);
  const hits: Array<{ square: string; type: string; color: 'w' | 'b' }> = [];
  for (let k = 1; k < 8 && hits.length < 2; k++) {
    const s = at(f0 + df * k, r0 + dr * k);
    if (!s) break;
    const p = chess.get(s as Square);
    if (p) hits.push({ square: s, type: p.type, color: p.color });
  }
  return hits;
}

/**
 * Static exchange evaluation: material the side to move nets by starting a
 * capture sequence on `square`, each side always recapturing with its least
 * valuable piece and free to stop. 0 means capturing there does not pay.
 */
export function see(chess: Chess, square: string): number {
  const target = chess.get(square as Square);
  if (!target) return 0;
  const captures = chess.moves({ verbose: true }).filter((m) => m.to === square && m.captured);
  if (!captures.length) return 0;
  captures.sort((a, b) => VALUE[a.piece]! - VALUE[b.piece]!);
  const m = captures[0]!;
  chess.move({ from: m.from, to: m.to, promotion: m.promotion });
  const net = VALUE[target.type]! - see(chess, square);
  chess.undo();
  return Math.max(0, net);
}

/** Pieces (knight or bigger) of `color` that the side to move can win by SEE. */
export function enPrise(fen: string, color: 'w' | 'b'): Array<{ square: string; type: string; loss: number }> {
  const chess = new Chess(fen);
  if (chess.turn() === color) return [];
  const out: Array<{ square: string; type: string; loss: number }> = [];
  for (const row of chess.board()) {
    for (const p of row) {
      if (!p || p.color !== color || p.type === 'p' || p.type === 'k') continue;
      const loss = see(chess, p.square);
      if (loss >= 2) out.push({ square: p.square, type: p.type, loss });
    }
  }
  return out;
}

/** Motifs created by the first move of a line (usually the engine's best move). */
export function motifsOf(fen: string, uci: string, mate?: number): Motif[] {
  const out: Motif[] = [];
  const chess = new Chess(fen);
  let move: Move;
  try {
    move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return out;
  }
  const us = move.color;
  const them = us === 'w' ? 'b' : 'w';

  if (mate !== undefined && mate !== 0) {
    const n = Math.abs(mate);
    out.push({ theme: n <= 1 ? 'mateIn1' : n === 2 ? 'mateIn2' : n === 3 ? 'mateIn3' : 'mateIn4', text: n <= 1 ? 'dá mate' : `força mate em ${n}` });
    const lastRank = us === 'w' ? '8' : '1';
    if (n <= 2 && (move.piece === 'r' || move.piece === 'q') && move.to[1] === lastRank) out.push({ theme: 'backRankMate', text: 'mate na última fileira' });
  }

  if (move.captured) {
    const before = new Chess(fen);
    const gain = see(before, move.to);
    const recapture = chess.moves({ verbose: true }).some((m) => m.to === move.to && m.captured);
    if (VALUE[move.captured]! >= 3 && !recapture) out.push({ theme: 'hangingPiece', text: `captura ${named(move.captured, move.to)}, que estava sem defesa` });
    else if (gain >= 2) out.push({ theme: 'winsMaterial', text: `ganha material na troca em ${move.to}` });
  }

  // Fork: the moved piece attacks two targets worth attacking.
  const attacked = targetsOf(chess, move.to)
    .map((s) => ({ s, p: chess.get(s as Square) }))
    .filter((x) => x.p && x.p.color === them && (x.p.type === 'k' || VALUE[x.p.type]! > VALUE[move.piece]! || see(flipTurn(chess), x.s) > 0));
  if (attacked.length >= 2) {
    out.push({ theme: 'fork', text: `garfo: ${named(move.piece, move.to)} ataca ${attacked.slice(0, 2).map((x) => named(x.p!.type, x.s)).join(' e ')}` });
  }

  // Pin and skewer along the moved piece's lines. A relative pin only counts
  // when moving away would really lose what is behind: worth more than the
  // pinning piece, or undefended. A pawn pinned to anything but the king is
  // almost never the point of a move.
  for (const d of dirsOf(move.piece)) {
    const [a, b] = ray(chess, move.to, d);
    if (!a || !b || a.color !== them || b.color !== them) continue;
    const pinWins = b.type === 'k' || (a.type !== 'p' && VALUE[b.type]! > VALUE[a.type]! && (VALUE[b.type]! > VALUE[move.piece]! || !chess.attackers(b.square as Square, them).length));
    if (a.type !== 'k' && pinWins) {
      out.push({ theme: 'pin', text: `cravada: ${named(a.type, a.square)} fica preso ${b.type === 'k' ? 'ao rei' : `${ARTICLE[b.type] === 'a' ? 'à' : 'ao'} ${PIECE_NAME[b.type]}`} em ${b.square}` });
    } else if ((a.type === 'k' || VALUE[a.type]! > VALUE[b.type]!) && VALUE[b.type]! >= 3) {
      out.push({ theme: 'skewer', text: `espeto: ${named(a.type, a.square)} precisa sair e ${named(b.type, b.square)} fica exposto` });
    }
  }

  // Discovered attack: a line piece behind the origin square now sees a target.
  let discoveredCheck = false;
  for (const row of chess.board()) {
    for (const p of row) {
      if (!p || p.color !== us || p.square === move.to || !'rbq'.includes(p.type)) continue;
      const [pf, pr] = xy(p.square);
      const [of, or] = xy(move.from);
      const df = Math.sign(of - pf);
      const dr = Math.sign(or - pr);
      const aligned = (df === 0 || dr === 0 || Math.abs(of - pf) === Math.abs(or - pr)) && (df !== 0 || dr !== 0);
      if (!aligned || !dirsOf(p.type).some(([x, y]) => x === df && y === dr)) continue;
      const [first] = ray(chess, p.square, [df, dr]);
      if (!first || first.color !== them) continue;
      // The origin square must lie between the line piece and the target.
      const [tf, tr] = xy(first.square);
      const between = Math.abs(of - pf) <= Math.abs(tf - pf) && Math.abs(or - pr) <= Math.abs(tr - pr);
      if (!between) continue;
      if (first.type === 'k') discoveredCheck = true;
      else if (!targetsOf(chess, p.square).includes(first.square)) continue;
      if (first.type === 'k' || VALUE[first.type]! >= 3) {
        out.push({ theme: 'discoveredAttack', text: `ataque descoberto: ao sair de ${move.from}, ${named(p.type, p.square)} passa a atacar ${named(first.type, first.square)}` });
      }
    }
  }
  if (discoveredCheck && move.san.includes('+') && chess.attackers(kingSquare(chess, them) as Square, us).length >= 2) {
    out.push({ theme: 'doubleCheck', text: 'xeque duplo: o rei é obrigado a se mexer' });
  }
  if (move.san.includes('+') && !out.length) out.push({ theme: 'exposedKing', text: 'xeque que expõe o rei' });
  return out;
}

function kingSquare(chess: Chess, color: 'w' | 'b'): string {
  for (const row of chess.board()) for (const p of row) if (p && p.type === 'k' && p.color === color) return p.square;
  return 'a1';
}

/** A copy of the position with the other side to move (en passant cleared). */
function flipTurn(chess: Chess): Chess {
  const parts = chess.fen().split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  return new Chess(parts.join(' '), { skipValidation: true });
}

/**
 * Enemy pieces the piece on `square` can really win next move. Captures come
 * from legal move generation (so a pinned piece attacks nothing it cannot
 * take); a check on the king comes from attackers(), because a pinned piece
 * still gives check.
 */
function targetsOf(chess: Chess, square: string): string[] {
  const p = chess.get(square as Square);
  if (!p) return [];
  const them = p.color === 'w' ? 'b' : 'w';
  const mover = chess.turn() === p.color ? chess : flipTurn(chess);
  const out = new Set(mover.moves({ square: square as Square, verbose: true }).filter((m) => m.captured && m.captured !== 'k').map((m) => m.to as string));
  const king = kingSquare(chess, them);
  if (chess.attackers(king as Square, p.color).includes(square as Square)) out.add(king);
  return [...out];
}

/** Theme keys only, for the training weights. */
export function motifThemes(fen: string, uci: string, mate?: number): string[] {
  return motifsOf(fen, uci, mate).map((m) => m.theme);
}
