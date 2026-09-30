// FSRS optimizer on the local Vite server, with the official Rust engine
// (@open-spaced-repetition/binding, MIT). It runs here and not
// in the browser because its WASM build needs threads, and threads need
// cross-origin isolation headers, which the app does not set.
//
//   GET  /api/fsrs/status            -> { available }
//   POST /api/fsrs/optimize          { histories, enableShortTerm } -> { params }
//   POST /api/fsrs/evaluate-splits   { histories, enableShortTerm } -> { logLoss, rmseBins }
//   POST /api/fsrs/evaluate          { histories, params }          -> { logLoss, rmseBins }
//
// A history is one card's reviews in order: [{ rating: 1-4, at: epoch ms }].
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

type Binding = typeof import('@open-spaced-repetition/binding');
type History = Array<{ rating: number; at: number }>;
interface Body {
  histories: History[];
  enableShortTerm?: boolean;
  params?: number[];
}

let binding: Promise<Binding | null> | null = null;
const load = () =>
  (binding ??= import('@open-spaced-repetition/binding')
    .then((m) => ((m as unknown as { default?: Binding }).default ?? m) as Binding)
    .catch(() => null));

/**
 * One item per review after the first, holding the card's history up to it:
 * the optimizer predicts that review from the ones before.
 */
function itemsOf(b: Binding, histories: History[]) {
  const items: InstanceType<Binding['FSRSBindingItem']>[] = [];
  for (const h of histories) {
    const sorted = [...h].sort((x, y) => x.at - y.at);
    for (let i = 1; i < sorted.length; i++) {
      const reviews = sorted.slice(0, i + 1).map((r, k) => new b.FSRSBindingReview(r.rating, k === 0 ? 0 : Math.max(0, Math.floor((r.at - sorted[k - 1]!.at) / 86_400_000))));
      items.push(new b.FSRSBindingItem(reviews));
    }
  }
  return items;
}

async function readJson(req: IncomingMessage): Promise<Body> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Body;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function fsrsPlugin(): Plugin {
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url ?? '';
    if (!url.startsWith('/api/fsrs/')) return next();
    const b = await load();
    if (url.startsWith('/api/fsrs/status')) return send(res, 200, { available: !!b });
    if (req.method !== 'POST') return next();
    if (!b) return send(res, 503, { error: 'Otimizador indisponível: rode o app com npm run dev.' });
    try {
      const body = await readJson(req);
      if (!Array.isArray(body.histories)) return send(res, 400, { error: 'histories is required' });
      const items = itemsOf(b, body.histories);
      if (!items.length) return send(res, 400, { error: 'no card has two reviews yet' });
      const opts = { enableShortTerm: body.enableShortTerm ?? true, timeout: 20_000 };
      if (url.startsWith('/api/fsrs/optimize')) return send(res, 200, { params: await b.computeParameters(items, opts), items: items.length });
      if (url.startsWith('/api/fsrs/evaluate-splits')) return send(res, 200, { ...(await b.evaluateWithTimeSeriesSplits(items, opts)), items: items.length });
      if (url.startsWith('/api/fsrs/evaluate')) return send(res, 200, { ...new b.FSRSBinding(body.params).evaluate(items), items: items.length });
      next();
    } catch (e) {
      send(res, 500, { error: (e as Error).message });
    }
  };
  return {
    name: 'chess-coach-fsrs',
    configureServer(server) {
      server.middlewares.use((req, res, next) => void handler(req, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void handler(req, res, next));
    },
  };
}
