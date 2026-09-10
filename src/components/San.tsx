// SAN with figurines, like chess.com's move list.
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
