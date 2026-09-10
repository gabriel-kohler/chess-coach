// Guards the LLM narration: every move written in the text must be one of the
// engine-provided moves. Squares mentioned as places ("a casa e5") are fine.

const MOVE_TOKEN = /(?<![A-Za-z0-9])(O-O-O|O-O|[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|[a-h]x[a-h][1-8](?:=[QRBN])?|[a-h][1-8](?:=[QRBN])?)[+#]?[!?]*(?![A-Za-z0-9])/g;
const SQUARE_CONTEXT = /(casa|casas|em|na|no|para|de|da|do|até|pela|pelo|sobre)\s+$/i;

export const normalizeSan = (san: string) => san.replace(/[+#!?]+$/g, '');

/** Move tokens in a text, skipping bare squares used as places. */
export function extractMoves(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(MOVE_TOKEN)) {
    const token = m[1]!;
    const bareSquare = /^[a-h][1-8]$/.test(token);
    if (bareSquare && SQUARE_CONTEXT.test(text.slice(Math.max(0, m.index! - 12), m.index!))) continue;
    out.push(normalizeSan(token));
  }
  return out;
}

/** Moves in the text that are not in the allowed list (empty = the text is safe). */
export function unknownMoves(text: string, allowed: Iterable<string>): string[] {
  const ok = new Set([...allowed].map(normalizeSan));
  return [...new Set(extractMoves(text).filter((m) => !ok.has(m)))];
}
