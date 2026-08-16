import type { Square, PieceSymbol, Color } from 'chess.js';

export type { Square, PieceSymbol, Color };

export interface PieceData {
  type: PieceSymbol;
  color: Color;
  square: Square;
}

export interface BoardState {
  pieces: (PieceData | null)[];
  turn: Color;
  isCheck: boolean;
  isCheckmate: boolean;
  isStalemate: boolean;
  isDraw: boolean;
  isGameOver: boolean;
  lastMove: { from: Square; to: Square } | null;
  selectedSquare: Square | null;
  legalMoves: Square[];
  fen: string;
}

export interface MoveIntent {
  from: Square;
  to: Square;
  promotion?: 'q' | 'r' | 'b' | 'n';
}

export type TimeControl = {
  initial: number; // seconds
  increment: number; // seconds
  label: string;
};

export const TIME_CONTROLS: TimeControl[] = [
  { initial: Infinity, increment: 0, label: '∞' },
  { initial: 180, increment: 0, label: '3+0' },
  { initial: 180, increment: 2, label: '3+2' },
  { initial: 300, increment: 0, label: '5+0' },
  { initial: 600, increment: 0, label: '10+0' },
];

export type GameResult = 
  | { type: 'checkmate'; winner: Color }
  | { type: 'stalemate' }
  | { type: 'draw'; reason: 'insufficient' | 'threefold' | 'fifty-move' | 'agreement' }
  | { type: 'resignation'; winner: Color }
  | { type: 'timeout'; winner: Color };

export type RoomStatus = 'idle' | 'waiting' | 'playing' | 'ended';

export interface RoomState {
  roomId: string;
  status: RoomStatus;
  playerColor: Color | null;
  timeControl: TimeControl;
  result: GameResult | null;
  whiteTime: number;
  blackTime: number;
}
