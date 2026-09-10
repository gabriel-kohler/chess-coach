// SAN with figurines, like chess.com's move list.
import { lineLabels } from '@/lib/chess/replay';

const FIGURINE: Record<string, string> = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞' };

export function San({ san, className }: { san: string; className?: string }) {
  const first = san[0]!;
  const fig = FIGURINE[first];
  if (!fig) return <span className={className}>{san}</span>;
  return (
    <span className={className}>
      <span className="mr-[1px] inline-block translate-y-[1px] text-[1.12em] leading-none">{fig}</span>
      {san.slice(1)}
    </span>
  );
}

/**
 * A line of moves with move numbers ("24. ♛c4 ♛a5+ 25. ♚f1"): the figurines
 * look the same for both colors, so the numbers say who is moving.
 */
export function SanLine({ fen, san }: { fen: string; san: string[] }) {
  const labels = lineLabels(fen, san.length);
  return (
    <>
      {san.map((s, i) => (
        <span key={i} className="mr-1.5 whitespace-nowrap">
          {labels[i] && <span className="mr-0.5 text-ink-4">{labels[i]}</span>}
          <San san={s} />
        </span>
      ))}
    </>
  );
}

const SAN_TOKEN = /\b(?:\.\.\.)?([KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|[a-h]x[a-h][1-8](?:=[QRBN])?[+#]?|[a-h][1-8](?:=[QRBN])?[+#]?|O-O(?:-O)?[+#]?)/g;

/** Renders free text with SAN tokens turned into figurine notation. */
export function RichText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(SAN_TOKEN)) {
    const token = m[1]!;
    const start = m.index! + m[0].length - token.length;
    // Plain squares like "e4" inside prose stay as they are unless they look like moves.
    if (start > last) parts.push(text.slice(last, start));
    parts.push(<San key={start} san={token} className="font-bold text-ink" />);
    last = start + token.length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}
