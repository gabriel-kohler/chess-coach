// Essential endgames, each checked with Stockfish 18 (depth 20) before being
// added: the side you play really wins (or really holds) with correct play.
import type { Color } from './types.ts';

export type EndgameGoal = 'mate' | 'promote' | 'win' | 'draw';

export interface EndgameDrill {
  id: string;
  name: string;
  level: 1 | 2 | 3;
  fen: string;
  side: Color;
  goal: EndgameGoal;
  /** Your moves allowed to reach the goal (or to survive, for draws). */
  moves: number;
  /** Let the engine play the first move (for opposition drills). */
  engineFirst?: boolean;
  idea: string;
}

export const ENDGAMES: EndgameDrill[] = [
  {
    id: 'kqk',
    name: 'Mate com dama',
    level: 1,
    fen: '8/8/8/4k3/8/8/8/4K2Q w - - 0 1',
    side: 'white',
    goal: 'mate',
    moves: 15,
    idea: 'Use a dama a um lance de cavalo do rei inimigo para encurralá-lo na borda, depois traga o seu rei. Cuidado com o afogamento: sempre deixe uma casa livre até o mate.',
  },
  {
    id: 'krk',
    name: 'Mate com torre',
    level: 1,
    fen: '8/8/8/4k3/8/8/8/4K2R w - - 0 1',
    side: 'white',
    goal: 'mate',
    moves: 30,
    idea: 'A torre corta o rei inimigo numa fileira; o seu rei vai em oposição e a torre dá xeque para empurrá-lo uma fileira de cada vez. Quando o rei inimigo atacar a torre, afaste-a pela mesma fileira.',
  },
  {
    id: 'kpk-front',
    name: 'Rei na frente do peão',
    level: 1,
    fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1',
    side: 'white',
    goal: 'promote',
    moves: 10,
    idea: 'Com o rei na sexta fileira na frente do peão, a vitória é garantida: ganhe as casas-chave com o rei antes de empurrar o peão.',
  },
  {
    id: 'kpk-opposition',
    name: 'Oposição: ataque',
    level: 2,
    fen: '8/8/8/3k4/8/3K4/3P4/8 b - - 0 1',
    side: 'white',
    goal: 'promote',
    moves: 15,
    engineFirst: true,
    idea: 'O peão fica para trás: primeiro o rei conquista as casas à frente dele. Tome a oposição (reis frente a frente com uma casa entre eles, e o adversário com a vez) e avance o rei pelo lado.',
  },
  {
    id: 'kpk-defend',
    name: 'Oposição: defesa',
    level: 2,
    fen: '8/8/3k4/8/3PK3/8/8/8 b - - 0 1',
    side: 'black',
    goal: 'draw',
    moves: 15,
    idea: 'Fique na frente do peão e responda com a oposição. Quando o peão chegar à sexta com xeque, recue para a casa em frente a ele, nunca para o lado.',
  },
  {
    id: 'rook-behind',
    name: 'Torre atrás do peão passado',
    level: 1,
    fen: '8/8/8/8/8/6k1/P7/R5K1 w - - 0 1',
    side: 'white',
    goal: 'promote',
    moves: 15,
    idea: 'A torre atrás do peão passado ganha força a cada avanço. Empurre o peão; o rei inimigo não chega a tempo.',
  },
  {
    id: 'rvp',
    name: 'Torre contra peão',
    level: 2,
    fen: '8/8/8/8/2k5/8/2p5/5K1R w - - 0 1',
    side: 'white',
    goal: 'win',
    moves: 12,
    idea: 'Traga o rei para perto do peão enquanto a torre controla a casa de promoção. Não se apresse em dar xeques que afastam o rei inimigo na direção certa para ele.',
  },
  {
    id: 'qvp',
    name: 'Dama contra peão na sétima',
    level: 3,
    fen: '7K/8/8/8/8/8/3pk3/6Q1 w - - 0 1',
    side: 'white',
    goal: 'win',
    moves: 25,
    idea: 'Xeques e cravadas até obrigar o rei a ficar na frente do peão. Cada vez que isso acontece, o seu rei ganha um lance para se aproximar.',
  },
  {
    id: 'lucena',
    name: 'Posição de Lucena',
    level: 3,
    fen: '1K6/1P1k4/8/8/8/8/r7/2R5 w - - 0 1',
    side: 'white',
    goal: 'promote',
    moves: 20,
    idea: 'Corte o rei inimigo com a torre, leve-a para a quarta fileira e construa a ponte: quando os xeques acabarem, a torre bloqueia na quarta e o rei sai para o peão coroar.',
  },
  {
    id: 'philidor',
    name: 'Posição de Philidor',
    level: 3,
    fen: '3k4/8/r7/3PK3/8/8/8/7R b - - 0 1',
    side: 'black',
    goal: 'draw',
    moves: 20,
    idea: 'Mantenha a torre na sua terceira fileira e o rei na frente do peão. Assim que o peão avançar, a torre vai para a primeira fileira e dá xeques por trás.',
  },
];

export interface EndgameRecord {
  attempts: number;
  successes: number;
  best?: number; // fewest moves in a success
  lastAt: number;
}
