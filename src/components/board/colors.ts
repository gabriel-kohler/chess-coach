// Colors drawn on the board. The board itself is grey, so these are the only
// hues on it: sky for "where things are" (last move, hints, the engine),
// green for the right move, red for the wrong one.

/** Square tints. */
export const TINT = {
  lastMove: 'rgba(125, 211, 252, 0.42)',
  mark: 'rgba(248, 113, 113, 0.7)',
  moveHint: 'rgba(0, 0, 0, 0.16)',
  hint: 'rgba(125, 211, 252, 0.6)',
  wrong: 'rgba(248, 113, 113, 0.55)',
};

export const ARROW = {
  best: 'rgba(52, 211, 153, 0.9)',
  wrong: 'rgba(248, 113, 113, 0.9)',
  hard: 'rgba(250, 204, 21, 0.9)',
  engine: 'rgba(56, 189, 248, 0.85)',
  /** Right-drag arrows: plain, with Shift, Ctrl/Cmd and Alt. */
  user: 'rgba(251, 146, 60, 0.9)',
  userShift: 'rgba(52, 211, 153, 0.9)',
  userCtrl: 'rgba(248, 113, 113, 0.9)',
  userAlt: 'rgba(56, 189, 248, 0.9)',
};
