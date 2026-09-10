/** "1 partida", "0 partidas", "3 partidas". `many` defaults to `one` + "s". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
