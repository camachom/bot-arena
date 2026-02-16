import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { RoundReport } from '@bot-arena/types';

export interface ArenaState {
  currentFightNumber: number;
  reports: RoundReport[];
}

const DEFAULT_STATE: ArenaState = {
  currentFightNumber: 0,
  reports: [],
};

export function loadState(path: string): ArenaState {
  if (!existsSync(path)) {
    return { ...DEFAULT_STATE };
  }

  try {
    const data = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(data);
    return {
      currentFightNumber: parsed.currentFightNumber ?? 0,
      reports: parsed.reports ?? [],
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveState(path: string, state: ArenaState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

export function getNextFightNumber(state: ArenaState): number {
  return state.currentFightNumber + 1;
}

export function formatFightRound(fightNumber: number, roundNumber: number): string {
  return `F${fightNumber}-R${roundNumber}`;
}

export function formatReportFilename(fightNumber: number, roundNumber: number): string {
  const fightPad = String(fightNumber).padStart(3, '0');
  const roundPad = String(roundNumber).padStart(3, '0');
  return `round-F${fightPad}-R${roundPad}.html`;
}
