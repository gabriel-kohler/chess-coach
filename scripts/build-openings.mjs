// Builds src/data/openings.json from lichess-org/chess-openings (CC0).
// Maps the EPD of every position along every named line to [eco, name]
// (0 for positions that are only a prefix of a named line). Used to name
// openings and to mark "book" moves in game reviews.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'src', 'data', 'openings.json');
const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master';

const epdOf = (fen) => fen.split(' ').slice(0, 4).join(' ');
const positions = {};
let lines = 0;

for (const letter of ['a', 'b', 'c', 'd', 'e']) {
  const res = await fetch(`${BASE}/${letter}.tsv`);
  if (!res.ok) throw new Error(`${letter}.tsv: ${res.status}`);
  const rows = (await res.text()).trim().split('\n').slice(1);
  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t');
    const chess = new Chess();
    const sans = pgn.replace(/\d+\.+/g, ' ').trim().split(/\s+/);
    for (const san of sans) {
      chess.move(san);
      const epd = epdOf(chess.fen());
      if (!(epd in positions)) positions[epd] = 0;
    }
    positions[epdOf(chess.fen())] = [eco, name];
    lines++;
  }
}

writeFileSync(OUT, JSON.stringify(positions));
console.log(`wrote ${OUT}: ${lines} lines, ${Object.keys(positions).length} positions`);
