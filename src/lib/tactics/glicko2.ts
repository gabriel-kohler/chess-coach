// Glicko-2 for one game at a time (player vs puzzle), as Lichess does for
// puzzles. Reference: Glickman, "Example of the Glicko-2 system" (2013).
import type { Glicko } from '../types.ts';

const SCALE = 173.7178;
const TAU = 0.75;
export const MIN_RD = 45;
export const MAX_RD = 350;
const PUZZLE_RD = 80;

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));

export function expectedScore(player: number, opponent: number, opponentRd = PUZZLE_RD): number {
  const mu = (player - 1500) / SCALE;
  const muj = (opponent - 1500) / SCALE;
  return 1 / (1 + Math.exp(-g(opponentRd / SCALE) * (mu - muj)));
}

/** RD grows while the player is inactive, so the first results after a break move the rating more. */
export function decay(p: Glicko, days: number): Glicko {
  if (days <= 0) return p;
  const phi = p.rd / SCALE;
  const grown = Math.sqrt(phi * phi + p.vol * p.vol * days) * SCALE;
  return { ...p, rd: Math.min(MAX_RD, grown) };
}

export function update(p: Glicko, opponentRating: number, score: 0 | 0.5 | 1, opponentRd = PUZZLE_RD): Glicko {
  const mu = (p.rating - 1500) / SCALE;
  const phi = p.rd / SCALE;
  const muj = (opponentRating - 1500) / SCALE;
  const gj = g(opponentRd / SCALE);
  const E = 1 / (1 + Math.exp(-gj * (mu - muj)));
  const v = 1 / (gj * gj * E * (1 - E));
  const delta = v * gj * (score - E);

  // New volatility (Illinois algorithm).
  const a = Math.log(p.vol * p.vol);
  const f = (x: number) => {
    const ex = Math.exp(x);
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * (phi * phi + v + ex) ** 2) - (x - a) / (TAU * TAU);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > 1e-6; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else fA /= 2;
    B = C;
    fB = fC;
  }
  const vol = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + vol * vol);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * gj * (score - E);
  return {
    rating: muNew * SCALE + 1500,
    rd: Math.max(MIN_RD, Math.min(MAX_RD, phiNew * SCALE)),
    vol: Math.min(0.1, vol),
  };
}
