// chess.com Published-Data API (read-only, no auth, CORS enabled).
// Requests are serial: the API rate-limits parallel access with HTTP 429.

const BASE = 'https://api.chess.com/pub';

export interface CCProfile {
  username: string;
  name?: string;
  avatar?: string;
  country?: string;
  joined?: number;
  last_online?: number;
  url?: string;
}

interface CCRatingBlock {
  last?: { rating: number; date: number; rd: number };
  best?: { rating: number; date: number; game: string };
  record?: { win: number; loss: number; draw: number };
}

export interface CCStats {
  chess_rapid?: CCRatingBlock;
  chess_blitz?: CCRatingBlock;
  chess_bullet?: CCRatingBlock;
  chess_daily?: CCRatingBlock;
  tactics?: { highest?: { rating: number; date: number }; lowest?: { rating: number; date: number } };
  puzzle_rush?: { best?: { total_attempts: number; score: number } };
}

export interface CCPlayer {
  username: string;
  rating: number;
  result: string;
  uuid?: string;
}

export interface CCGame {
  url: string;
  pgn?: string;
  time_control: string;
  end_time: number;
  rated: boolean;
  accuracies?: { white: number; black: number };
  uuid: string;
  initial_setup?: string;
  fen?: string;
  time_class: string;
  rules: string;
  white: CCPlayer;
  black: CCPlayer;
  eco?: string;
}

async function getJson<T>(url: string, attempt = 0): Promise<T> {
  const res = await fetch(url);
  if (res.status === 429 && attempt < 4) {
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    return getJson<T>(url, attempt + 1);
  }
  if (res.status === 404) throw new Error('Usuário não encontrado no chess.com.');
  if (!res.ok) throw new Error(`chess.com respondeu ${res.status}`);
  return (await res.json()) as T;
}

const enc = (u: string) => encodeURIComponent(u.trim().toLowerCase());

export const getProfile = (username: string) => getJson<CCProfile>(`${BASE}/player/${enc(username)}`);
export const getStats = (username: string) => getJson<CCStats>(`${BASE}/player/${enc(username)}/stats`);
export const getArchives = async (username: string) =>
  (await getJson<{ archives: string[] }>(`${BASE}/player/${enc(username)}/games/archives`)).archives;
export const getArchive = async (url: string) => (await getJson<{ games: CCGame[] }>(url)).games;
