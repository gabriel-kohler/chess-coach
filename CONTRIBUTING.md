# Contributing

Issues and pull requests are welcome. Chess Coach started as a personal
trainer, so the interface is in Brazilian Portuguese; code, comments and
commit messages are in English.

## Setup

```bash
npm install            # also copies Stockfish (WASM) into public/stockfish
npm run build:puzzles  # downloads the Lichess puzzle database (~300 MB)
npm run setup:maia     # optional: Maia-2 model for "people at your level"
cp .env.example .env.local
npm run dev            # http://localhost:5180
```

Node 22 or newer.

## Before opening a pull request

```bash
npm run typecheck
npm test
```

- Keep changes focused; one feature or fix per pull request.
- New logic in `src/lib` comes with tests next to it (`*.test.ts`).
- Anything that grades moves or schedules reviews states its constants in one
  place (`ACCURACY`, `TRAINER`, the configs under `src/lib/*/config.ts`), so
  explain in the pull request what data a new value was fitted on.
- Assets must be under a license compatible with GPL-3.0. Add them to
  `public/ASSETS.md`.

## License

By contributing you agree that your work is released under the
[GPL-3.0](LICENSE).
