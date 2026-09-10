// Tactical motifs (Lichess theme keys), their Portuguese names, and how much
// each one matters at each rating range. The weights encode a curriculum:
// below ~1400 most points are lost to hanging pieces, forks and short mates;
// deflection, intermezzo and quiet moves pay off later.

export const THEME_LABEL: Record<string, string> = {
  hangingPiece: 'Peça pendurada',
  fork: 'Garfo',
  pin: 'Cravada',
  skewer: 'Espeto',
  discoveredAttack: 'Ataque descoberto',
  doubleCheck: 'Xeque duplo',
  mateIn1: 'Mate em 1',
  mateIn2: 'Mate em 2',
  mateIn3: 'Mate em 3',
  mateIn4: 'Mate em 4',
  mateIn5: 'Mate em 5+',
  backRankMate: 'Mate no corredor',
  smotheredMate: 'Mate sufocado',
  trappedPiece: 'Peça presa',
  capturingDefender: 'Eliminar o defensor',
  deflection: 'Desvio',
  attraction: 'Atração',
  interference: 'Interferência',
  clearance: 'Liberação de casa',
  intermezzo: 'Lance intermediário',
  quietMove: 'Lance calmo',
  defensiveMove: 'Defesa',
  xRayAttack: 'Raio X',
  zugzwang: 'Zugzwang',
  sacrifice: 'Sacrifício',
  exposedKing: 'Rei exposto',
  kingsideAttack: 'Ataque ao roque',
  queensideAttack: 'Ataque na ala da dama',
  attackingF2F7: 'Ataque em f2/f7',
  advancedPawn: 'Peão avançado',
  promotion: 'Promoção',
  underPromotion: 'Subpromoção',
  enPassant: 'En passant',
  castling: 'Roque',
  rookEndgame: 'Final de torres',
  pawnEndgame: 'Final de peões',
  bishopEndgame: 'Final de bispos',
  knightEndgame: 'Final de cavalos',
  queenEndgame: 'Final de damas',
  queenRookEndgame: 'Final de dama e torre',
  anastasiaMate: 'Mate de Anastasia',
  arabianMate: 'Mate árabe',
  bodenMate: 'Mate de Boden',
  doubleBishopMate: 'Mate dos dois bispos',
  dovetailMate: 'Mate da cauda de andorinha',
  hookMate: 'Mate do gancho',
  killBoxMate: 'Mate da caixa',
  vukovicMate: 'Mate de Vukovic',
  epauletteMate: 'Mate das dragonas',
  opening: 'Abertura',
  middlegame: 'Meio-jogo',
  endgame: 'Final',
  crushing: 'Esmagador',
  advantage: 'Vantagem',
  equality: 'Igualdade',
  mate: 'Mate',
  short: 'Curto',
  long: 'Longo',
  veryLong: 'Muito longo',
  oneMove: 'Um lance',
};

export const themeLabel = (t: string) => THEME_LABEL[t] ?? t;

/** Base weight of each motif at four anchor ratings (Lichess puzzle scale). */
const ANCHORS = [1200, 1600, 2000, 2400] as const;
const CURRICULUM: Record<string, [number, number, number, number]> = {
  hangingPiece: [3.0, 1.5, 0.8, 0.5],
  fork: [3.0, 2.4, 1.6, 1.2],
  mateIn1: [2.5, 1.0, 0.4, 0.2],
  mateIn2: [2.2, 2.0, 1.4, 1.0],
  mateIn3: [0.8, 1.5, 1.6, 1.4],
  mateIn4: [0.2, 0.6, 1.0, 1.2],
  pin: [2.2, 2.0, 1.5, 1.2],
  backRankMate: [2.0, 1.5, 1.0, 0.7],
  skewer: [1.6, 1.6, 1.2, 1.0],
  discoveredAttack: [1.6, 2.0, 1.6, 1.3],
  doubleCheck: [1.0, 1.2, 1.0, 0.8],
  trappedPiece: [1.5, 1.5, 1.2, 1.0],
  capturingDefender: [1.2, 1.8, 1.6, 1.3],
  deflection: [1.0, 2.0, 2.0, 1.8],
  attraction: [1.0, 1.8, 2.0, 1.8],
  sacrifice: [1.0, 1.5, 1.8, 1.8],
  exposedKing: [1.0, 1.2, 1.2, 1.0],
  kingsideAttack: [1.0, 1.2, 1.2, 1.0],
  attackingF2F7: [1.2, 1.0, 0.6, 0.4],
  advancedPawn: [1.0, 1.0, 1.0, 1.0],
  promotion: [1.0, 1.0, 0.8, 0.8],
  defensiveMove: [0.8, 1.4, 2.0, 2.2],
  intermezzo: [0.5, 1.5, 2.0, 2.0],
  quietMove: [0.5, 1.2, 2.0, 2.2],
  xRayAttack: [0.5, 1.2, 1.5, 1.4],
  clearance: [0.4, 1.0, 1.5, 1.6],
  interference: [0.4, 1.0, 1.5, 1.6],
  zugzwang: [0.3, 0.8, 1.2, 1.5],
  smotheredMate: [0.8, 0.8, 0.6, 0.4],
  rookEndgame: [0.6, 1.0, 1.4, 1.6],
  pawnEndgame: [0.6, 1.0, 1.3, 1.4],
  knightEndgame: [0.3, 0.6, 0.8, 1.0],
  bishopEndgame: [0.3, 0.6, 0.8, 1.0],
  queenEndgame: [0.3, 0.5, 0.8, 1.0],
  underPromotion: [0.1, 0.3, 0.5, 0.6],
};

export const MOTIFS = Object.keys(CURRICULUM);

/** Curriculum weight of a motif at a given rating (linear between anchors). */
export function importance(theme: string, rating: number): number {
  const w = CURRICULUM[theme];
  if (!w) return 0;
  if (rating <= ANCHORS[0]) return w[0];
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const lo = ANCHORS[i]!;
    const hi = ANCHORS[i + 1]!;
    if (rating <= hi) {
      const t = (rating - lo) / (hi - lo);
      return w[i]! + t * (w[i + 1]! - w[i]!);
    }
  }
  return w[3];
}

/** Motifs that define each 100-point level, used for the level-up checklist. */
export function coreThemes(rating: number, count = 6): string[] {
  return [...MOTIFS].sort((a, b) => importance(b, rating) - importance(a, rating)).slice(0, count);
}
