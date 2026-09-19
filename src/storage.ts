import type { Round, TournamentState } from './types';

const STORAGE_KEY = 'swiss-pairing-tournament-v1';

/**
 * 升级本地旧数据：旧版本的 Round 没有 absentIds 字段，视为空名单（全员出席）。
 * 不改动任何历史赛果与积分，只补齐字段形态。
 */
function migrate(state: TournamentState): TournamentState {
  const migrateRound = (r: Round): Round => ({
    ...r,
    absentIds: Array.isArray(r.absentIds) ? r.absentIds.filter((id) => typeof id === 'string') : [],
  });
  return { ...state, rounds: state.rounds.map(migrateRound) };
}

export function loadState(): TournamentState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TournamentState;
    if (!Array.isArray(parsed.players) || !Array.isArray(parsed.rounds)) return null;
    return migrate(parsed);
  } catch {
    return null;
  }
}

export function saveState(state: TournamentState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时静默降级（内存中仍可用）
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
