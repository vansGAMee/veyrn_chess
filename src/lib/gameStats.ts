import { Chess } from 'chess.js';
import type { Color, GameResult, TimeControl } from '@/types/chess';

export interface GameRecord {
  id: string;
  completedAt: string;
  playerColor: Color;
  outcome: 'win' | 'loss' | 'draw';
  resultLabel: string;
  timeControl: string;
  durationMs: number;
  totalPlies: number;
  localMoves: number;
  captures: number;
  checks: number;
  castles: number;
  promotions: number;
  pawnMoves: number;
  queenMoves: number;
  avgThinkMs: number;
  fastestThinkMs: number;
  slowestThinkMs: number;
  phaseThinkMs: [number, number, number];
  opening: string;
  networkLatencyMs: number | null;
  relay: boolean;
  remainingTime: number | null;
  opponentRemainingTime: number | null;
  country: string | null;
  opponentCountry: string | null;
  thinkTimesMs: number[];
  pgn: string;
}

export interface RecordGameInput {
  pgn: string;
  playerColor: Color;
  result: GameResult;
  timeControl: TimeControl;
  durationMs: number;
  thinkTimesMs: number[];
  networkLatencyMs?: number;
  relay?: boolean;
  whiteTime: number;
  blackTime: number;
  country?: string;
  opponentCountry?: string;
}

export interface GameMetrics {
  decisionSamples: number;
  wins: number;
  losses: number;
  draws: number;
  phase: [number, number, number];
  openings: [string, number][];
  winRate: number;
  moves: number;
  captures: number;
  checks: number;
  castles: number;
  avgThink: number;
  medianThink: number;
  fastest: number;
  slowest: number;
  medianLatency: number;
  avgDuration: number;
  reserve: number;
  consistency: number;
  instantRate: number;
  deepThinkRate: number;
}

const STORAGE_KEY = 'veyrn:game-ledger:v1';

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeGameRecords(records: GameRecord[]): GameMetrics {
  const wins = records.filter((record) => record.outcome === 'win').length;
  const losses = records.filter((record) => record.outcome === 'loss').length;
  const draws = records.length - wins - losses;
  const samples = records.flatMap((record) => record.thinkTimesMs?.length
    ? record.thinkTimesMs
    : record.avgThinkMs > 0 ? [record.avgThinkMs] : []);
  const avgThink = average(samples);
  const deviation = samples.length
    ? Math.sqrt(average(samples.map((value) => (value - avgThink) ** 2)))
    : 0;
  const phase = [0, 1, 2].map((index) => average(
    records.map((record) => record.phaseThinkMs[index]).filter((value) => value > 0)
  )) as [number, number, number];
  const openings = Object.entries(records.reduce<Record<string, number>>((map, record) => {
    map[record.opening] = (map[record.opening] || 0) + 1;
    return map;
  }, {})).sort((a, b) => b[1] - a[1]) as [string, number][];
  const latencies = records
    .map((record) => record.networkLatencyMs)
    .filter((value): value is number => typeof value === 'number' && value >= 0);
  const reserves = records
    .map((record) => record.remainingTime)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  return {
    decisionSamples: samples.length,
    wins,
    losses,
    draws,
    phase,
    openings,
    winRate: records.length ? (wins / records.length) * 100 : 0,
    moves: records.reduce((sum, record) => sum + record.localMoves, 0),
    captures: records.reduce((sum, record) => sum + record.captures, 0),
    checks: records.reduce((sum, record) => sum + record.checks, 0),
    castles: records.reduce((sum, record) => sum + record.castles, 0),
    avgThink,
    medianThink: median(samples),
    fastest: samples.length ? Math.min(...samples) : 0,
    slowest: samples.length ? Math.max(...samples) : 0,
    medianLatency: median(latencies),
    avgDuration: average(records.map((record) => record.durationMs)),
    reserve: average(reserves),
    consistency: samples.length >= 3 && avgThink > 0
      ? Math.max(0, Math.min(100, 100 - (deviation / avgThink) * 100))
      : 0,
    instantRate: samples.length ? (samples.filter((value) => value < 2000).length / samples.length) * 100 : 0,
    deepThinkRate: samples.length ? (samples.filter((value) => value >= 15000).length / samples.length) * 100 : 0,
  };
}

function resultForPlayer(result: GameResult, color: Color): GameRecord['outcome'] {
  if ('winner' in result) return result.winner === color ? 'win' : 'loss';
  return 'draw';
}

function resultLabel(result: GameResult): string {
  if (result.type === 'checkmate') return 'Checkmate';
  if (result.type === 'resignation') return 'Resignation';
  if (result.type === 'timeout') return 'Timeout';
  if (result.type === 'stalemate') return 'Stalemate';
  return `Draw · ${result.reason}`;
}

function openingName(san: string[]): string {
  const key = san.slice(0, 4).join(' ');
  if (key.startsWith('e4 e5 Nf3 Nc6')) return 'Open Game';
  if (key.startsWith('e4 c5')) return 'Sicilian Structure';
  if (key.startsWith('e4 e6')) return 'French Structure';
  if (key.startsWith('e4 c6')) return 'Caro–Kann Structure';
  if (key.startsWith('d4 d5 c4')) return "Queen's Gambit";
  if (key.startsWith('d4 Nf6 c4 g6')) return "King's Indian Structure";
  if (key.startsWith('d4 Nf6 c4 e6')) return 'Indian Game';
  if (key.startsWith('Nf3')) return 'Réti Setup';
  if (key.startsWith('c4')) return 'English Opening';
  if (key.startsWith('e4')) return "King's Pawn";
  if (key.startsWith('d4')) return "Queen's Pawn";
  return san[0] ? `Uncatalogued · ${san[0]}` : 'No opening data';
}

export function createGameRecord(input: RecordGameInput): GameRecord {
  const chess = new Chess();
  if (input.pgn.trim()) chess.loadPgn(input.pgn);
  const history = chess.history({ verbose: true });
  const local = history.filter((move) => move.color === input.playerColor);
  const phases = [
    input.thinkTimesMs.slice(0, 10),
    input.thinkTimesMs.slice(10, 25),
    input.thinkTimesMs.slice(25),
  ] as const;
  const myTime = input.playerColor === 'w' ? input.whiteTime : input.blackTime;
  const opponentTime = input.playerColor === 'w' ? input.blackTime : input.whiteTime;

  return {
    id: crypto.randomUUID(),
    completedAt: new Date().toISOString(),
    playerColor: input.playerColor,
    outcome: resultForPlayer(input.result, input.playerColor),
    resultLabel: resultLabel(input.result),
    timeControl: input.timeControl.label,
    durationMs: input.durationMs,
    totalPlies: history.length,
    localMoves: local.length,
    captures: local.filter((move) => Boolean(move.captured)).length,
    checks: local.filter((move) => move.san.includes('+') || move.san.includes('#')).length,
    castles: local.filter((move) => move.san.startsWith('O-O')).length,
    promotions: local.filter((move) => Boolean(move.promotion)).length,
    pawnMoves: local.filter((move) => move.piece === 'p').length,
    queenMoves: local.filter((move) => move.piece === 'q').length,
    avgThinkMs: average(input.thinkTimesMs),
    fastestThinkMs: input.thinkTimesMs.length ? Math.min(...input.thinkTimesMs) : 0,
    slowestThinkMs: input.thinkTimesMs.length ? Math.max(...input.thinkTimesMs) : 0,
    phaseThinkMs: [average(phases[0]), average(phases[1]), average(phases[2])],
    opening: openingName(history.map((move) => move.san)),
    networkLatencyMs: input.networkLatencyMs ?? null,
    relay: Boolean(input.relay),
    remainingTime: Number.isFinite(myTime) ? Math.max(0, myTime) : null,
    opponentRemainingTime: Number.isFinite(opponentTime) ? Math.max(0, opponentTime) : null,
    country: input.country || null,
    opponentCountry: input.opponentCountry || null,
    thinkTimesMs: input.thinkTimesMs.map((value) => Math.max(0, Math.round(value))),
    pgn: input.pgn,
  };
}

export function readGameRecords(): GameRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as GameRecord[];
    if (!Array.isArray(data)) return [];
    return data.map((record) => ({
      ...record,
      country: record.country || null,
      opponentCountry: record.opponentCountry || null,
      thinkTimesMs: Array.isArray(record.thinkTimesMs) ? record.thinkTimesMs : [],
    }));
  } catch {
    return [];
  }
}

export function saveGameRecord(record: GameRecord): void {
  if (typeof window === 'undefined') return;
  const records = [record, ...readGameRecords()].slice(0, 200);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export function clearGameRecords(): void {
  if (typeof window !== 'undefined') localStorage.removeItem(STORAGE_KEY);
}
