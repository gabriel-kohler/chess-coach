// chess.com's "Neo" pieces and default sounds, loaded from their CDN for
// personal use. Lichess cburnett pieces are the fallback when it fails.
export type PieceCode = `${'w' | 'b'}${'p' | 'n' | 'b' | 'r' | 'q' | 'k'}`;

// chess.com serves Neo only as PNG (100/150/200/300 px, no SVG). 300 px keeps
// the pieces sharp on Retina screens at large board sizes (~3 KB each).
const NEO = 'https://images.chesscomfiles.com/chess-themes/pieces/neo/300';
const CBURNETT = 'https://lichess1.org/assets/piece/cburnett';

export function pieceUrl(code: PieceCode, fallback = false): string {
  if (fallback) return `${CBURNETT}/${code[0]}${code[1]!.toUpperCase()}.svg`;
  return `${NEO}/${code}.png`;
}

export const ALL_PIECES: PieceCode[] = ['wp', 'wn', 'wb', 'wr', 'wq', 'wk', 'bp', 'bn', 'bb', 'br', 'bq', 'bk'];

let preloaded = false;
export function preloadPieces() {
  if (preloaded) return;
  preloaded = true;
  for (const code of ALL_PIECES) {
    const img = new Image();
    img.src = pieceUrl(code);
  }
}

export type SoundKind = 'move' | 'capture' | 'check' | 'castle' | 'promote' | 'end' | 'illegal' | 'notify';

const SOUND_FILE: Record<SoundKind, string> = {
  move: 'move-self',
  capture: 'capture',
  check: 'move-check',
  castle: 'castle',
  promote: 'promote',
  end: 'game-end',
  illegal: 'illegal',
  notify: 'notify',
};
const SOUND_BASE = 'https://images.chesscomfiles.com/chess-themes/sounds/_MP3_/default';
const audioCache = new Map<SoundKind, HTMLAudioElement>();

let soundOn = true;
export function setSoundEnabled(on: boolean) {
  soundOn = on;
}

export function playSound(kind: SoundKind) {
  if (!soundOn || typeof Audio === 'undefined') return;
  let audio = audioCache.get(kind);
  if (!audio) {
    audio = new Audio(`${SOUND_BASE}/${SOUND_FILE[kind]}.mp3`);
    audio.volume = 0.6;
    audioCache.set(kind, audio);
  }
  audio.currentTime = 0;
  void audio.play().catch(() => undefined);
}

/** Picks the chess.com sound for a SAN move. */
export function soundForSan(san: string, captured = san.includes('x')): SoundKind {
  if (san.includes('#')) return 'end';
  if (san.includes('+')) return 'check';
  if (san.startsWith('O-O')) return 'castle';
  if (san.includes('=')) return 'promote';
  return captured ? 'capture' : 'move';
}
