// Minimal PGN reader that keeps variations (RAV) and comments. It only builds
// the move tree; SAN legality is checked later, when the tree is replayed.

export interface PgnNode {
  san: string;
  nags: number[];
  comment?: string;
  /** Comment written right before this move, e.g. at the start of a variation. */
  preComment?: string;
  children: PgnNode[];
}

export interface PgnGame {
  headers: Record<string, string>;
  /** Comment before the first move. */
  comment?: string;
  moves: PgnNode[];
}

const SUFFIX_NAGS: Record<string, number> = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 };
const RESULT = /^(1-0|0-1|1\/2-1\/2|\*)$/;
const MOVE_NUMBER = /^\d+\.+$/;
const GLUED = /^\d+\.+([A-Za-z].*)$/;

type Token =
  | { kind: 'comment'; text: string }
  | { kind: 'open' }
  | { kind: 'close' }
  | { kind: 'nag'; value: number }
  | { kind: 'move'; san: string; nags: number[] };

function tokenize(movetext: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < movetext.length) {
    const ch = movetext[i]!;
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '{') {
      const end = movetext.indexOf('}', i + 1);
      const stop = end === -1 ? movetext.length : end;
      tokens.push({ kind: 'comment', text: movetext.slice(i + 1, stop).replace(/\s+/g, ' ').trim() });
      i = stop + 1;
      continue;
    }
    if (ch === ';') {
      const end = movetext.indexOf('\n', i + 1);
      const stop = end === -1 ? movetext.length : end;
      tokens.push({ kind: 'comment', text: movetext.slice(i + 1, stop).trim() });
      i = stop + 1;
      continue;
    }
    if (ch === '(') { tokens.push({ kind: 'open' }); i++; continue; }
    if (ch === ')') { tokens.push({ kind: 'close' }); i++; continue; }
    if (ch === '$') {
      const m = /^\$(\d+)/.exec(movetext.slice(i));
      if (m) { tokens.push({ kind: 'nag', value: Number(m[1]) }); i += m[0].length; continue; }
    }
    const m = /^[^\s{}();]+/.exec(movetext.slice(i));
    if (!m) { i++; continue; }
    i += m[0].length;
    let word = m[0];
    if (MOVE_NUMBER.test(word) || RESULT.test(word)) continue;
    // "12.e4" or "12...e5" glued together
    const glued = GLUED.exec(word);
    if (glued) word = glued[1]!;
    const suffix = /[!?]+$/.exec(word);
    const nags: number[] = [];
    if (suffix) {
      const nag = SUFFIX_NAGS[suffix[0]];
      if (nag) nags.push(nag);
      word = word.slice(0, -suffix[0].length);
    }
    if (word) tokens.push({ kind: 'move', san: word, nags });
  }
  return tokens;
}

function parseMovetext(movetext: string): { comment?: string; moves: PgnNode[] } {
  const root: PgnNode = { san: '', nags: [], children: [] };
  const parent = new Map<PgnNode, PgnNode>();
  // `current` is the node after which the next move is played; `last` is the
  // most recent move in this line (the one a variation is an alternative to).
  let current = root;
  let last: PgnNode | null = null;
  let pending: string | undefined;
  const stack: Array<{ current: PgnNode; last: PgnNode | null }> = [];

  for (const token of tokenize(movetext)) {
    switch (token.kind) {
      case 'move': {
        const node: PgnNode = { san: token.san, nags: token.nags, children: [] };
        if (pending) { node.preComment = pending; pending = undefined; }
        current.children.push(node);
        parent.set(node, current);
        last = node;
        current = node;
        break;
      }
      case 'nag':
        if (last) last.nags.push(token.value);
        break;
      case 'comment':
        if (!token.text) break;
        if (last) last.comment = last.comment ? `${last.comment} ${token.text}` : token.text;
        else if (current === root && root.children.length === 0 && stack.length === 0) root.comment = token.text;
        else pending = pending ? `${pending} ${token.text}` : token.text;
        break;
      case 'open': {
        stack.push({ current, last });
        const branchFrom = last ? parent.get(last) : undefined;
        if (!branchFrom) throw new Error('PGN: variation without a preceding move');
        current = branchFrom;
        last = null;
        break;
      }
      case 'close': {
        const frame = stack.pop();
        if (!frame) throw new Error('PGN: unbalanced ")"');
        current = frame.current;
        last = frame.last;
        pending = undefined;
        break;
      }
    }
  }
  if (stack.length) throw new Error('PGN: unbalanced "("');
  return { comment: root.comment, moves: root.children };
}

/** Parses one or more games. */
export function parsePgn(text: string): PgnGame[] {
  const games: PgnGame[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let headers: Record<string, string> = {};
  let movetext: string[] = [];
  let inMoves = false;

  const flush = () => {
    const body = movetext.join('\n').trim();
    if (body || Object.keys(headers).length) {
      const parsed = parseMovetext(body);
      games.push({ headers, comment: parsed.comment, moves: parsed.moves });
    }
    headers = {};
    movetext = [];
    inMoves = false;
  };

  for (const line of lines) {
    const header = /^\s*\[(\w+)\s+"(.*)"\]\s*$/.exec(line);
    if (header) {
      if (inMoves) flush();
      headers[header[1]!] = header[2]!.replace(/\\"/g, '"');
      continue;
    }
    if (line.trim() === '' && !inMoves) continue;
    inMoves = true;
    movetext.push(line);
  }
  flush();
  return games;
}

const brace = (text: string) => `{${text.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()}}`;

/**
 * Writes a game back as PGN: headers, the comment before the first move, and
 * the moves with their variations (an alternative right after the move it
 * replaces), move numbers where a reader needs them. parsePgn reads it back
 * to the same tree.
 */
export function writePgn(game: PgnGame, width = 100): string {
  const out: string[] = [];
  const move = (node: PgnNode, ply: number, numbered: boolean) => {
    if (node.preComment) out.push(brace(node.preComment));
    const n = Math.floor(ply / 2) + 1;
    if (ply % 2 === 0) out.push(`${n}.`);
    else if (numbered || node.preComment) out.push(`${n}...`);
    out.push(node.san + node.nags.map((g) => ` $${g}`).join(''));
    if (node.comment) out.push(brace(node.comment));
  };
  const line = (nodes: PgnNode[], ply: number, numbered: boolean) => {
    let here = nodes;
    let p = ply;
    let num = numbered;
    while (here.length) {
      const [main, ...alternatives] = here as [PgnNode, ...PgnNode[]];
      move(main, p, num);
      num = !!main.comment;
      for (const alt of alternatives) {
        out.push('(');
        move(alt, p, true);
        line(alt.children, p + 1, !!alt.comment);
        out.push(')');
        num = true;
      }
      here = main.children;
      p++;
    }
  };
  if (game.comment) out.push(brace(game.comment));
  line(game.moves, 0, true);
  // Wrap at `width`, never inside a token.
  const rows: string[] = [];
  let row = '';
  for (const token of out) {
    const glue = row === '' || row.endsWith('(') || token === ')' ? '' : ' ';
    if (row && row.length + glue.length + token.length > width) {
      rows.push(row);
      row = token;
    } else row += glue + token;
  }
  if (row) rows.push(row);
  const headers = Object.entries(game.headers).map(([k, v]) => `[${k} "${v.replace(/"/g, "'")}"]`);
  return `${headers.join('\n')}\n\n${rows.join('\n')}\n`;
}

/** Main line SAN moves of a game (first child at every step). */
export function mainLine(game: PgnGame): string[] {
  const out: string[] = [];
  let node = game.moves[0];
  while (node) {
    out.push(node.san);
    node = node.children[0];
  }
  return out;
}

export interface ClockedMoves {
  moves: string[];
  /** Seconds left on the mover's clock after each ply, when present. */
  clocks: Array<number | null>;
}

/**
 * Fast path for chess.com game PGNs: a single main line with `[%clk h:mm:ss.s]`
 * comments. Avoids building a tree for thousands of imported games.
 */
export function parseClockedMainLine(pgn: string): ClockedMoves {
  const split = pgn.replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  const body = split.length > 1 ? split.slice(1).join(' ') : pgn;
  const moves: string[] = [];
  const clocks: Array<number | null> = [];
  const re = /\{([^}]*)\}|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m[1] !== undefined) {
      const clk = /\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/.exec(m[1]);
      if (clk && clocks.length) {
        clocks[clocks.length - 1] = Number(clk[1]) * 3600 + Number(clk[2]) * 60 + Number(clk[3]);
      }
      continue;
    }
    let word = m[2]!;
    if (MOVE_NUMBER.test(word) || RESULT.test(word) || word.startsWith('$')) continue;
    const glued = GLUED.exec(word);
    if (glued) word = glued[1]!;
    word = word.replace(/[!?]+$/, '');
    if (!word) continue;
    moves.push(word);
    clocks.push(null);
  }
  return { moves, clocks };
}
