// Your repertoire as opening decks, the way you think about it ("my Sicilian",
// "against the London") instead of one pile per color. A deck is a group of
// chapters of the repertoire file; this list is the only place that says which.
// A chapter it does not name goes to its color's deck of rare lines, so a new
// chapter in the file never goes missing.
import type { Color } from '../types.ts';

export interface DeckSpec {
  /** Stable: part of the training sessions' steps. No "|". */
  id: string;
  side: Color;
  name: string;
  /** Chapter ids; one ending in "*" takes every chapter that starts with it. */
  chapters: string[];
  /** Where the chapters nobody names go. One per color. */
  rare?: true;
  /**
   * Its openings as the Lichess puzzle database tags them (a family, or one
   * variation of it), for its opening puzzles in Punir. Checked against the
   * database: a tag it does not have just brings no puzzle.
   */
  lichess?: string[];
}

export const REPERTOIRE_DECKS: DeckSpec[] = [
  // Its "-mg" chapters (scripts/extend-repertoire.mjs) fall under the wildcard.
  { id: 'b-sicilian', side: 'black', name: 'Siciliana', chapters: ['black-sicilian-*'], lichess: ['Sicilian_Defense'] },
  {
    id: 'b-kid',
    side: 'black',
    name: 'Índia do Rei',
    // The "-mg" chapters take its lines into the middle game (scripts/extend-repertoire.mjs).
    chapters: ['black-kid-classical', 'black-kid-samisch-fourpawns', 'black-kid-fianchetto', 'black-kid-classical-mg', 'black-kid-samisch-fourpawns-mg', 'black-kid-fianchetto-mg'],
    lichess: ['Kings_Indian_Defense'],
  },
  { id: 'b-london', side: 'black', name: 'Contra o London', chapters: ['black-kid-london'], lichess: ['London_System', 'Queens_Pawn_Game_London_System', 'Queens_Pawn_Game_Accelerated_London_System', 'Indian_Defense_London_System'] },
  { id: 'b-nf3', side: 'black', name: 'Contra 2.Nf3 (Torre e Colle)', chapters: ['black-kid-nf3-systems'], lichess: ['Queens_Pawn_Game_Colle_System', 'Queens_Pawn_Game_Torre_Attack', 'Queens_Pawn_Game_Zukertort_Variation', 'Indian_Defense_Knights_Variation'] },
  { id: 'b-nc3', side: 'black', name: 'Contra 2.Nc3 (Veresov)', chapters: ['black-kid-pirc'], lichess: ['Richter-Veresov_Attack', 'Queens_Pawn_Game_Chigorin_Variation', 'Indian_Defense_Pawn_Push_Variation'] },
  { id: 'b-tromp', side: 'black', name: 'Trompowsky e segundos lances raros', chapters: ['black-kid-tromp-rare'], lichess: ['Trompowsky_Attack'] },
  { id: 'b-reti-english', side: 'black', name: 'Contra 1.Nf3 e 1.c4 (Réti e Inglesa)', chapters: ['black-kid-reti-english'], lichess: ['English_Opening', 'Reti_Opening', 'Zukertort_Opening'] },
  {
    id: 'b-rare',
    side: 'black',
    name: 'Primeiros lances raros (1.e3, 1.b3, 1.f4...)',
    chapters: ['black-kid-other-first-moves'],
    rare: true,
    lichess: ['Vant_Kruijs_Opening', 'Nimzo-Larsen_Attack', 'Bird_Opening', 'Polish_Opening', 'Hungarian_Opening', 'Grob_Opening', 'Saragossa_Opening', 'Mieses_Opening', 'Van_Geet_Opening'],
  },

  {
    id: 'w-italian',
    side: 'white',
    name: 'Italiana',
    chapters: ['white-e4-e5-italian-bc5', 'white-e4-e5-two-knights', 'white-e4-e5-italian-sidelines', 'white-e4-e5-italian-bc5-mg', 'white-e4-e5-two-knights-mg', 'white-e4-e5-italian-sidelines-mg'],
    lichess: ['Italian_Game'],
  },
  { id: 'w-philidor', side: 'white', name: 'Contra a Philidor', chapters: ['white-e4-e5-philidor'], lichess: ['Philidor_Defense'] },
  { id: 'w-petrov', side: 'white', name: 'Contra a Petrov', chapters: ['white-e4-e5-petrov'], lichess: ['Russian_Game'] },
  { id: 'w-e5-rare', side: 'white', name: '1.e4 e5 2.Nf3: segundos lances raros', chapters: ['white-e4-e5-rare'], lichess: ['Elephant_Gambit', 'Latvian_Gambit'] },
  { id: 'w-sicilian', side: 'white', name: 'Contra a Siciliana (Alapin)', chapters: ['white-e4-other-alapin-*'], lichess: ['Sicilian_Defense_Alapin_Variation', 'Sicilian_Defense_Delayed_Alapin_Variation'] },
  { id: 'w-caro', side: 'white', name: 'Contra a Caro-Kann', chapters: ['white-e4-other-caro-c4'], lichess: ['Caro-Kann_Defense'] },
  { id: 'w-scandinavian', side: 'white', name: 'Contra a Escandinava', chapters: ['white-e4-other-escandinava'], lichess: ['Scandinavian_Defense'] },
  { id: 'w-french', side: 'white', name: 'Contra a Francesa', chapters: ['white-e4-other-francesa'], lichess: ['French_Defense'] },
  { id: 'w-pirc', side: 'white', name: 'Contra a Pirc e a Moderna', chapters: ['white-e4-other-pirc-moderna'], lichess: ['Pirc_Defense', 'Modern_Defense'] },
  { id: 'w-alekhine', side: 'white', name: 'Contra a Alekhine', chapters: ['white-e4-other-alekhine'], lichess: ['Alekhine_Defense'] },
  { id: 'w-rare', side: 'white', name: 'Respostas raras a 1.e4', chapters: ['white-e4-other-owen', 'white-e4-other-nimzowitsch', 'white-e4-other-raras'], rare: true, lichess: ['Owen_Defense', 'Nimzowitsch_Defense', 'St_George_Defense', 'Borg_Defense'] },
];

/** A catalog opening's name as the Lichess database tags it: "Van't Kruijs Opening" is Vant_Kruijs_Opening. */
export function lichessTag(name: string): string {
  return name.replace(/['’]/g, '').replace(/[:,]/g, '').trim().replace(/\s+/g, '_');
}

/** The deck a chapter of the file belongs to: named in the list, else its color's rare deck. */
export function specFor(chapterId: string, side: Color, specs: DeckSpec[] = REPERTOIRE_DECKS): DeckSpec | null {
  const mine = specs.filter((s) => s.side === side);
  const named = mine.find((s) => s.chapters.some((c) => (c.endsWith('*') ? chapterId.startsWith(c.slice(0, -1)) : c === chapterId)));
  return named ?? mine.find((s) => s.rare) ?? null;
}
