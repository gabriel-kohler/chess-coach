// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { OpeningPuzzle } from '../tactics/bank';
import { lichessTag } from '../decks/catalog';
import { deckTags, familyFor, pickOpeningPuzzles } from './lichess';

// The side to move plays the setup mistake: "w" to move means Black solves.
const p = (id: string, variation: string, rating: number, toMove: 'w' | 'b', family = 'Sicilian_Defense'): OpeningPuzzle => ({ id, source: 'lichess', fen: `8/8/8/8/8/8/8/8 ${toMove} - - 0 1`, moves: ['a1a2', 'a2a3'], rating, themes: [], family, variation });

describe('Lichess opening puzzles for a deck', () => {
  it('its openings as Lichess tags them', () => {
    expect(lichessTag("Van't Kruijs Opening")).toBe('Vant_Kruijs_Opening');
    expect(lichessTag("Queen's Pawn Game: London System")).toBe('Queens_Pawn_Game_London_System');
    expect(deckTags({ id: 'w-sicilian', kind: 'repertoire', name: '' })).toContain('Sicilian_Defense_Alapin_Variation');
    expect(deckTags({ id: 's-1', kind: 'study', name: "Van't Kruijs Opening" })).toEqual(['Vant_Kruijs_Opening']);
    expect(deckTags({ id: 's-2', kind: 'study', name: 'Sicilian Defense: Najdorf Variation, English Attack' })).toEqual(['Sicilian_Defense_Najdorf_Variation', 'Sicilian_Defense']);
    expect(familyFor('Sicilian_Defense_Alapin_Variation', ['Sicilian_Defense', 'Italian_Game'])).toBe('Sicilian_Defense');
    expect(familyFor('Italian_Game', ['Sicilian_Defense', 'Italian_Game'])).toBe('Italian_Game');
    expect(familyFor('Nope', ['Sicilian_Defense'])).toBeNull();
  });

  it('your color solving, near your rating, not tried, the deck\'s variation before its family', () => {
    const pool = [
      p('a', 'Sicilian_Defense_Alapin_Variation', 1410, 'b'),
      p('b', 'Sicilian_Defense_Old_Sicilian', 1400, 'b'),
      p('c', 'Sicilian_Defense_Alapin_Variation', 1700, 'b'),
      p('d', 'Sicilian_Defense_Alapin_Variation', 1400, 'w'),
      p('e', 'Sicilian_Defense_Alapin_Variation', 1390, 'b'),
    ];
    // White solves the puzzles with Black to move (the mistake is Black's).
    const white = pickOpeningPuzzles(pool, ['Sicilian_Defense_Alapin_Variation'], 'white', 1400, new Set(['e']), 10);
    expect(white.map((x) => x.id)).toEqual(['a']);
    expect(white[0]!.note).toBe('Sicilian Defense Alapin Variation');
    const family = pickOpeningPuzzles(pool, ['Sicilian_Defense_Alapin_Variation', 'Sicilian_Defense'], 'white', 1400, new Set(), 10);
    // a and e are 10 points away each: by id. Then the family's.
    expect(family.map((x) => x.id)).toEqual(['a', 'e', 'b']);
    expect(pickOpeningPuzzles(pool, ['Sicilian_Defense_Alapin_Variation'], 'black', 1400, new Set(), 10).map((x) => x.id)).toEqual(['d']);
  });
});
