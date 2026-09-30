// Where the training sessions live. No imports on purpose: the sync (account
// switch) and the Settings reset clear them without pulling the training code in.
export const TRAINING_KEYS = {
  daily: 'training:daily',
  warmup: 'training:warmup',
  settings: 'training:settings',
} as const;

/** The sessions point at the account's cards: another account starts without them. */
export const TRAINING_SESSION_KEYS: string[] = [TRAINING_KEYS.daily, TRAINING_KEYS.warmup];
