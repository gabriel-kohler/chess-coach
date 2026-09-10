// Optional LLM narration, served by the Vite dev/preview server so the API key
// never reaches the browser. The model only turns engine-verified facts into
// coaching prose; every move it writes is checked against the facts and the
// answer is regenerated (twice at most) or dropped if it cites anything else.
import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { Plugin } from 'vite';
import { unknownMoves } from '../src/lib/explain/sanCheck.ts';

export type NarrationModel = 'claude-sonnet-5' | 'claude-opus-5';

export interface NarrateRequest {
  model: NarrationModel;
  rating: number;
  facts: Record<string, unknown>;
  /** Every move the text may mention (SAN). */
  allowed: string[];
}

export interface NarrateResponse {
  text: string | null;
  model: string;
  attempts: number;
  rejected?: string[];
  error?: string;
}

const SYSTEM = `Você é um treinador de xadrez explicando um lance para um jogador de clube.
Você recebe FATOS em JSON, calculados pelo Stockfish e por código. Eles são a única fonte de verdade.

Regras:
- Cite somente lances que aparecem nos fatos. Nunca invente lances, variantes ou planos com lances que não estejam lá.
- Não invente avaliações nem números: use apenas os que estão nos fatos.
- Escreva lances em notação algébrica (Nf3, exd5, O-O). Para falar de uma casa, escreva "a casa e5".
- Português do Brasil, tom de treinador, 2 a 4 frases, sem listas e sem travessão.
- Comece pelo que o jogador deveria ter visto. Se os fatos não bastam para explicar a ideia, diga o que eles mostram e pare.`;

function credentialsAvailable(env: Record<string, string>): boolean {
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return true;
  // `ant auth login` stores a profile the SDK picks up on its own.
  return existsSync(join(homedir(), '.config', 'anthropic'));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function narrate(client: Anthropic, body: NarrateRequest): Promise<NarrateResponse> {
  const model = body.model === 'claude-opus-5' ? 'claude-opus-5' : 'claude-sonnet-5';
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: 'user',
      content: `Rating do aluno: ${body.rating}.\nFatos:\n${JSON.stringify(body.facts, null, 1)}\n\nLances que você pode citar: ${body.allowed.join(', ')}.\nExplique o lance jogado.`,
    },
  ];
  let rejected: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      system: SYSTEM,
      messages,
      // Short, fact-bound narration: low effort on Sonnet; strategic moves
      // (routed to Opus) get more room to connect several lines into a plan.
      output_config: { effort: model === 'claude-opus-5' ? 'medium' : 'low' },
      ...(model === 'claude-opus-5' ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    });
    if (response.stop_reason === 'refusal') return { text: null, model: response.model, attempts: attempt, error: 'refusal' };
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    rejected = unknownMoves(text, body.allowed);
    if (text && rejected.length === 0) return { text, model: response.model, attempts: attempt };
    messages.push({ role: 'assistant', content: response.content });
    messages.push({
      role: 'user',
      content: `Sua resposta citou ${rejected.join(', ') || 'nada útil'}, que não está nos fatos. Reescreva usando só os lances permitidos: ${body.allowed.join(', ')}.`,
    });
  }
  return { text: null, model, attempts: 3, rejected };
}

/** Adds POST /api/narrate and GET /api/narrate/status to the dev and preview servers. */
export function narratePlugin(env: Record<string, string>): Plugin {
  let client: Anthropic | null = null;
  const getClient = () => (client ??= new Anthropic(env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : {}));

  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url ?? '';
    if (url.startsWith('/api/narrate/status')) return send(res, 200, { available: credentialsAvailable(env) });
    if (!url.startsWith('/api/narrate') || req.method !== 'POST') return next();
    try {
      const body = (await readJson(req)) as NarrateRequest;
      if (!Array.isArray(body.allowed) || !body.facts) return send(res, 400, { error: 'facts and allowed moves are required' });
      send(res, 200, await narrate(getClient(), body));
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) return send(res, 401, { error: 'Chave da API inválida ou ausente.' });
      if (e instanceof Anthropic.RateLimitError) return send(res, 429, { error: 'Limite de uso da API atingido. Tente em instantes.' });
      if (e instanceof Anthropic.APIError) return send(res, 502, { error: `API ${e.status}: ${e.message}` });
      send(res, 500, { error: (e as Error).message });
    }
  };

  return {
    name: 'chess-coach-narrate',
    configureServer(server) {
      server.middlewares.use((req, res, next) => void handler(req, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void handler(req, res, next));
    },
  };
}
