// Turns repertoire PGN trees into a position graph keyed by EPD, so
// transpositions from different move orders land on the same node.
import { Chess } from 'chess.js';
import type { PgnGame, PgnNode } from '../chess/pgn.ts';

export type Side = 'white' | 'black';

export interface RepertoireMove {
  san: string;
  uci: string;
  /** EPD of the position after the move. */
  to: string;
  nags: number[];
  comment?: string;
  preComment?: string;
}

export interface RepertoirePosition {
  epd: string;
  fen: string;
  /** Distance from the start position along the first path that reached it. */
  ply: number;
  moves: RepertoireMove[];
  /** Engine evaluation (white's point of view), filled by the build script. */
  eval?: { cp?: number; mate?: number; depth: number; best?: string };
}

export interface RepertoireChapter {
  id: string;
  side: Side;
  name: string;
  description?: string;
  intro?: string;
  /** SAN moves from the start to the chapter's first diverging position. */
  entry: string[];
  /**
   * The positions written in this chapter's own tree (EPD), both sides, trunk
   * included: what an opening deck is made of. Chapters share positions, so
   * this cannot be read back from the merged side. Missing in old files.
   */
  own?: string[];
}

export interface CompiledSide {
  side: Side;
  chapters: RepertoireChapter[];
  positions: Record<string, RepertoirePosition>;
}

export interface CompileResult {
  chapter: RepertoireChapter;
  positions: Record<string, RepertoirePosition>;
  errors: string[];
}

/** FEN without the move counters: placement, side to move, castling, en passant. */
export function epdOf(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

export function turnOf(fenOrEpd: string): Side {
  return fenOrEpd.split(' ')[1] === 'w' ? 'white' : 'black';
}

function addMove(
  positions: Record<string, RepertoirePosition>,
  fen: string,
  ply: number,
  move: RepertoireMove,
): void {
  const epd = epdOf(fen);
  const pos = (positions[epd] ??= { epd, fen, ply, moves: [] });
  pos.ply = Math.min(pos.ply, ply);
  const existing = pos.moves.find((m) => m.uci === move.uci);
  if (!existing) {
    pos.moves.push(move);
    return;
  }
  if (move.comment && !existing.comment?.includes(move.comment)) {
    existing.comment = existing.comment ? `${existing.comment} ${move.comment}` : move.comment;
  }
  if (move.preComment && !existing.preComment) existing.preComment = move.preComment;
  for (const nag of move.nags) if (!existing.nags.includes(nag)) existing.nags.push(nag);
}

export function compileChapter(game: PgnGame): CompileResult {
  const errors: string[] = [];
  const side = (game.headers.Side ?? '').toLowerCase();
  const id = game.headers.Id ?? '';
  if (side !== 'white' && side !== 'black') errors.push(`[${id || '?'}] header Side must be "white" or "black"`);
  if (!id) errors.push('missing [Id "..."] header');

  const positions: Record<string, RepertoirePosition> = {};
  const chess = new Chess();
  const walk = (nodes: PgnNode[], path: string[]) => {
    for (const node of nodes) {
      const fenBefore = chess.fen();
      let played;
      try {
        played = chess.move(node.san);
      } catch {
        errors.push(`[${id}] illegal move "${node.san}" after: ${path.join(' ') || '(start)'}`);
        continue;
      }
      addMove(positions, fenBefore, path.length, {
        san: played.san,
        uci: played.lan,
        to: epdOf(played.after),
        nags: [...node.nags],
        comment: node.comment,
        preComment: node.preComment,
      });
      walk(node.children, [...path, played.san]);
      chess.undo();
    }
  };
  walk(game.moves, []);

  // The entry is the shared trunk until the tree first branches.
  const entry: string[] = [];
  let nodes = game.moves;
  while (nodes.length === 1) {
    entry.push(nodes[0]!.san);
    nodes = nodes[0]!.children;
  }

  const chapter: RepertoireChapter = {
    id,
    side: side === 'black' ? 'black' : 'white',
    name: game.headers.Name ?? id,
    description: game.headers.Description,
    intro: game.comment,
    entry,
    own: Object.keys(positions),
  };
  errors.push(...findConflicts(positions, chapter.side, id));
  return { chapter, positions, errors };
}

/** A repertoire answers each of its own positions with exactly one move. */
export function findConflicts(
  positions: Record<string, RepertoirePosition>,
  side: Side,
  label: string,
): string[] {
  const errors: string[] = [];
  for (const pos of Object.values(positions)) {
    if (turnOf(pos.fen) === side && pos.moves.length > 1) {
      errors.push(`[${label}] two answers for ${side} at ${pos.fen}: ${pos.moves.map((m) => m.san).join(' / ')}`);
    }
  }
  return errors;
}

export function mergeSides(results: CompileResult[]): { sides: Record<Side, CompiledSide>; errors: string[] } {
  const sides: Record<Side, CompiledSide> = {
    white: { side: 'white', chapters: [], positions: {} },
    black: { side: 'black', chapters: [], positions: {} },
  };
  const errors: string[] = [];
  for (const r of results) {
    const target = sides[r.chapter.side];
    target.chapters.push(r.chapter);
    for (const pos of Object.values(r.positions)) {
      for (const move of pos.moves) addMove(target.positions, pos.fen, pos.ply, { ...move, nags: [...move.nags] });
    }
  }
  for (const s of Object.values(sides)) errors.push(...findConflicts(s.positions, s.side, `merged ${s.side}`));
  return { sides, errors };
}
