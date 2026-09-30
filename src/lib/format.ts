/** "1 partida", "0 partidas", "3 partidas". `many` defaults to `one` + "s". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** When a card comes back: "em 10 min", "em 3 h", "amanhã", "em 4 dias", "em 2 meses". */
export function dueLabel(due: number, now = Date.now()): string {
  const min = Math.max(1, Math.round((due - now) / 60_000));
  if (min < 60) return `em ${min} min`;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const days = Math.floor((due - start.getTime()) / 86_400_000);
  if (days < 1) return `em ${Math.round(min / 60)} h`;
  if (days === 1) return 'amanhã';
  if (days < 45) return `em ${days} dias`;
  return `em ${plural(Math.round(days / 30), 'mês', 'meses')}`;
}
