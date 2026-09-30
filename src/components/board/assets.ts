// Board pieces and sounds, served from public/. Pieces: cburnett by Colin M.L.
// Burnett (GPLv2+). Sounds: the "sfx" set by Enigmahack (AGPLv3+). Both taken
// from lichess-org/lila; see public/ASSETS.md.
export type PieceCode = `${'w' | 'b'}${'p' | 'n' | 'b' | 'r' | 'q' | 'k'}`;

const PIECES = '/pieces/cburnett';

export function pieceUrl(code: PieceCode): string {
  return `${PIECES}/${code[0]}${code[1]!.toUpperCase()}.svg`;
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

// The sfx set has no castle, promotion, mate or illegal-move sounds of its own
// (Lichess plays Move and Check for those), so they share files.
const SOUND_FILE: Record<SoundKind, string> = {
  move: 'Move',
  capture: 'Capture',
  check: 'Check',
  castle: 'Move',
  promote: 'Move',
  end: 'Check',
  illegal: 'LowTime',
  notify: 'GenericNotify',
};
const SOUND_BASE = '/sounds/sfx';
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

/** Picks the sound for a SAN move. */
export function soundForSan(san: string, captured = san.includes('x')): SoundKind {
  if (san.includes('#')) return 'end';
  if (san.includes('+')) return 'check';
  if (san.startsWith('O-O')) return 'castle';
  if (san.includes('=')) return 'promote';
  return captured ? 'capture' : 'move';
}
