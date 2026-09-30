# Architecture

Chess Coach is a single-page React app. Everything that matters runs in the
browser: games, analyses and progress live in IndexedDB, and the engines run
in Web Workers. A small set of Vite server plugins covers the few things that
need a token or threads.

```
chess.com API ──► sync ──► IndexedDB (Dexie) ◄──► pages (React + TanStack Query)
                              ▲      │
             Stockfish workers│      ▼
                   analyze ───┘   renewal pipeline ──► position cards, level review,
                                                       automatic analysis, repertoire gaps
```

## Layout

| Path | What lives there |
|---|---|
| `src/pages/` | One file per screen (Home, Games, Review, Stats, Openings, Tactics, Positions, Endgames, Training, Level, Settings). |
| `src/components/` | UI by area: `board/` (board, arrows, colors, sounds), `review/`, `openings/`, `positions/`, `tactics/`, `training/`, `decks/`, `charts/`. |
| `src/lib/chesscom/` | chess.com Published-Data API client, import and incremental sync. |
| `src/lib/db.ts` | The Dexie schema and its migrations. |
| `src/lib/data/` | TanStack Query cache fed by IndexedDB change events (`live.ts`), so screens refetch only when the data they show changes. |
| `src/lib/engine/` | Stockfish 18 (lite, single-threaded WASM) in Web Workers. Scores are always from White's point of view. |
| `src/lib/review/` | Game analysis, move classification, accuracy (`scoring.ts`), the coach and the background analysis queue. |
| `src/lib/explain/` | Engine-verified facts and motifs behind the coach's text, plus the optional LLM narration client. |
| `src/lib/tactics/` | Puzzle bank, curriculum, Glicko-2 ratings and the session trainer. |
| `src/lib/positions/` | Positions from your own games where your move lost 5+ win-chance points, graded and scheduled. |
| `src/lib/srs/` | FSRS scheduling shared by every mode: cards, the day's queue, retention and the optimizer client. |
| `src/lib/repertoire/`, `src/lib/decks/`, `src/lib/openings/`, `src/lib/punish/` | Repertoire compilation and drills, opening decks, the Lichess explorer and the "punish" decks. |
| `src/lib/maia/` | Maia-2 in a worker (ONNX Runtime Web): what people at a given rating play. |
| `src/lib/renewal/` | What runs by itself after each sync. |
| `src/lib/training/` | The daily "Train" and "Warm-up" sessions, composed from all of the above. |
| `server/` | Vite plugins: `narrate.ts` (LLM narration), `explorer.ts` (Lichess explorer proxy with the token), `fsrs.ts` (FSRS optimizer). |
| `scripts/` | Build-time data: puzzles, openings, repertoire, engine and Maia setup. |

## Data flow

1. **Sync.** `chesscom/sync.ts` downloads the monthly archives, converts each
   game (`import.ts`) and stores it. Later syncs fetch only new months.
2. **Analysis.** `review/queue.ts` runs one game at a time: requests from the
   user first, the automatic analysis behind them at a fixed depth, paused
   while the user trains. Each finished game becomes position cards.
3. **Scoring.** Stored analyses keep the raw Stockfish lines, so a change to
   classification or accuracy recomputes them on launch without the engine.
4. **Training.** Tactics, positions, openings and endgames each schedule their
   items with FSRS on one shared table of cards and one review log.

## Conventions

- Code and comments in English; the interface is in Brazilian Portuguese.
- Tunable constants sit in one object per area (`ACCURACY`, `TRAINER`,
  `src/lib/*/config.ts`) with the data they were fitted on in a comment.
- Colors come from the tokens in `src/index.css`; the board's own colors from
  `src/components/board/colors.ts`.
- Tests sit next to the code (`*.test.ts`), run with Vitest and
  `fake-indexeddb`.
