import { Chess } from 'chess.js';
import type { Square, Color } from 'chess.js';
import type { MoveIntent, BoardState, PieceData, GameResult, TimeControl, RoomState, RoomStatus } from '@/types/chess';

export type GameEngineListener = (state: GameEngineState) => void;

export interface GameEngineState {
  board: BoardState;
  room: RoomState;
  premove: MoveIntent | null;
}

export class GameEngine {
  private chess: Chess;
  private listeners: Set<GameEngineListener> = new Set();
  private roomId: string = '';
  private roomStatus: RoomStatus = 'idle';
  private playerColor: Color | null = null;
  private timeControl: TimeControl = { initial: 300, increment: 0, label: '5+0' };
  private result: GameResult | null = null;
  private whiteTime: number = 300;
  private blackTime: number = 300;
  private clockInterval: ReturnType<typeof setInterval> | null = null;
  private lastClockTick: number = 0;
  private selectedSquare: Square | null = null;
  private lastMove: { from: Square; to: Square } | null = null;
  private premove: MoveIntent | null = null;
  private _cachedState: GameEngineState | null = null;

  constructor() {
    this.chess = new Chess();
  }

  subscribe(listener: GameEngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this._cachedState = {
      board: this.getBoardState(),
      room: this.getRoomState(),
      premove: this.premove,
    };
    this.listeners.forEach((l) => l(this._cachedState!));
  }

  getState(): GameEngineState {
    if (!this._cachedState) {
      this._cachedState = {
        board: this.getBoardState(),
        room: this.getRoomState(),
        premove: this.premove,
      };
    }
    return this._cachedState;
  }

  clearSelection() {
    this.selectedSquare = null;
    this.notify();
  }

  setPremove(intent: MoveIntent | null) {
    this.premove = intent;
    this.notify();
  }

  clearPremove() {
    if (this.premove) {
      this.premove = null;
      this.notify();
    }
  }

  private getBoardState(): BoardState {
    const pieces: (PieceData | null)[] = [];

    for (let rank = 7; rank >= 0; rank--) {
      for (let file = 0; file < 8; file++) {
        const sq = (String.fromCharCode(97 + file) + (rank + 1)) as Square;
        const piece = this.chess.get(sq);
        if (piece) {
          pieces.push({ type: piece.type, color: piece.color, square: sq });
        } else {
          pieces.push(null);
        }
      }
    }

    let legalMoves: Square[] = [];
    if (this.selectedSquare) {
      try {
        const moves = this.chess.moves({ square: this.selectedSquare, verbose: true });
        legalMoves = moves.map((m) => m.to);
      } catch {
        legalMoves = [];
      }
    }

    return {
      pieces,
      turn: this.chess.turn(),
      isCheck: this.chess.isCheck(),
      isCheckmate: this.chess.isCheckmate(),
      isStalemate: this.chess.isStalemate(),
      isDraw: this.chess.isDraw(),
      isGameOver: this.chess.isGameOver(),
      lastMove: this.lastMove,
      selectedSquare: this.selectedSquare,
      legalMoves,
      fen: this.chess.fen(),
    };
  }

  private getRoomState(): RoomState {
    return {
      roomId: this.roomId,
      status: this.roomStatus,
      playerColor: this.playerColor,
      timeControl: this.timeControl,
      result: this.result,
      whiteTime: this.whiteTime,
      blackTime: this.blackTime,
    };
  }

  setTimeControl(tc: TimeControl) {
    this.timeControl = tc;
    if (tc.initial === Infinity) {
      this.whiteTime = Infinity;
      this.blackTime = Infinity;
    } else {
      this.whiteTime = tc.initial;
      this.blackTime = tc.initial;
    }
    this.notify();
  }

  createRoom(roomId: string) {
    this.roomId = roomId;
    this.roomStatus = 'waiting';
    this.premove = null;
    this.selectedSquare = null;
    this.chess.reset();
    this.lastMove = null;
    this.result = null;
    this.notify();
  }

  joinRoom(roomId: string, color: Color) {
    this.roomId = roomId;
    this.playerColor = color;
    this.premove = null;
    this.selectedSquare = null;
    this.notify();
  }

  startGame(playerColor: Color) {
    this.chess.reset();
    this.playerColor = playerColor;
    this.roomStatus = 'playing';
    this.result = null;
    this.lastMove = null;
    this.selectedSquare = null;
    this.premove = null;
    if (this.timeControl.initial === Infinity) {
      this.whiteTime = Infinity;
      this.blackTime = Infinity;
    } else {
      this.whiteTime = this.timeControl.initial;
      this.blackTime = this.timeControl.initial;
    }
    this.startClock();
    this.notify();
  }

  selectSquare(square: Square | null): MoveIntent | null {
    if (this.chess.isGameOver()) return null;

    // In idle mode, allow moving both sides for sandbox/demo testing
    const isIdle = this.roomStatus === 'idle';
    const effectiveColor = isIdle ? this.chess.turn() : this.playerColor;

    if (!effectiveColor) return null;

    const isMyTurn = this.chess.turn() === effectiveColor;

    // If not our turn during online play: handle premove selection
    if (!isMyTurn && !isIdle && this.roomStatus === 'playing') {
      if (this.selectedSquare === null) {
        const piece = this.chess.get(square!);
        if (piece && piece.color === this.playerColor) {
          this.selectedSquare = square;
          this.notify();
        }
        return null;
      }

      if (this.selectedSquare === square) {
        this.selectedSquare = null;
        this.notify();
        return null;
      }

      const targetPiece = this.chess.get(square!);
      if (targetPiece && targetPiece.color === this.playerColor) {
        this.selectedSquare = square;
        this.notify();
        return null;
      }

      // Queue premove
      const premoveIntent: MoveIntent = { from: this.selectedSquare, to: square! };
      this.selectedSquare = null;
      this.setPremove(premoveIntent);
      return null;
    }

    // Normal turn:
    if (this.selectedSquare === null) {
      const piece = this.chess.get(square!);
      if (piece && piece.color === effectiveColor) {
        this.selectedSquare = square;
        this.notify();
      }
      return null;
    }

    if (this.selectedSquare === square) {
      this.selectedSquare = null;
      this.notify();
      return null;
    }

    const targetPiece = this.chess.get(square!);
    if (targetPiece && targetPiece.color === effectiveColor) {
      this.selectedSquare = square;
      this.notify();
      return null;
    }

    // Move attempt
    const intent: MoveIntent = { from: this.selectedSquare, to: square! };
    this.selectedSquare = null;
    return intent;
  }

  tryMove(intent: MoveIntent): boolean {
    const piece = this.chess.get(intent.from);
    if (!piece) return false;

    const isIdle = this.roomStatus === 'idle';
    const effectiveColor = isIdle ? this.chess.turn() : this.playerColor;

    if (piece.color !== effectiveColor && !isIdle) return false;
    if (this.chess.turn() !== piece.color) return false;

    const needsPromotion =
      piece.type === 'p' &&
      ((piece.color === 'w' && intent.to[1] === '8') ||
        (piece.color === 'b' && intent.to[1] === '1'));

    const moveObj: { from: Square; to: Square; promotion?: string } = {
      from: intent.from,
      to: intent.to,
    };

    if (needsPromotion) {
      moveObj.promotion = intent.promotion || 'q';
    }

    try {
      const result = this.chess.move(moveObj);
      if (result) {
        this.lastMove = { from: intent.from, to: intent.to };
        this.selectedSquare = null;

        // Apply time increment
        if (
          this.roomStatus === 'playing' &&
          this.timeControl.increment > 0 &&
          this.timeControl.initial !== Infinity
        ) {
          if (result.color === 'w') {
            this.whiteTime += this.timeControl.increment;
          } else {
            this.blackTime += this.timeControl.increment;
          }
        }

        this.checkGameEnd();
        this.notify();
        return true;
      }
    } catch {}

    this.selectedSquare = null;
    this.notify();
    return false;
  }

  applyRemoteMove(
    from: Square,
    to: Square,
    promotion?: 'q' | 'r' | 'b' | 'n',
    clock?: number
  ): MoveIntent | null {
    const moveObj: { from: Square; to: Square; promotion?: string } = { from, to };

    const piece = this.chess.get(from);
    if (piece && piece.type === 'p') {
      const rank = to[1];
      if ((piece.color === 'w' && rank === '8') || (piece.color === 'b' && rank === '1')) {
        moveObj.promotion = promotion || 'q';
      }
    }

    try {
      const result = this.chess.move(moveObj);
      if (result) {
        this.lastMove = { from, to };

        if (clock !== undefined) {
          if (result.color === 'w') {
            this.whiteTime = clock;
          } else {
            this.blackTime = clock;
          }
        }

        this.checkGameEnd();

        // Check if there is a queued premove that is now legal
        let executedPremove: MoveIntent | null = null;
        if (this.premove && !this.chess.isGameOver()) {
          const queued = this.premove;
          this.premove = null;

          const promoNeeded = this.needsPromotion(queued.from, queued.to);
          const premovePayload: MoveIntent = {
            from: queued.from,
            to: queued.to,
            promotion: promoNeeded ? (queued.promotion || 'q') : undefined,
          };

          const premoveSuccess = this.tryMove(premovePayload);
          if (premoveSuccess) {
            executedPremove = premovePayload;
          }
        }

        this.notify();
        return executedPremove;
      }
    } catch {}

    return null;
  }

  private checkGameEnd() {
    if (this.chess.isCheckmate()) {
      const winner = this.chess.turn() === 'w' ? 'b' : 'w';
      this.result = { type: 'checkmate', winner: winner as Color };
      this.roomStatus = 'ended';
      this.stopClock();
    } else if (this.chess.isStalemate()) {
      this.result = { type: 'stalemate' };
      this.roomStatus = 'ended';
      this.stopClock();
    } else if (this.chess.isInsufficientMaterial()) {
      this.result = { type: 'draw', reason: 'insufficient' };
      this.roomStatus = 'ended';
      this.stopClock();
    } else if (this.chess.isThreefoldRepetition()) {
      this.result = { type: 'draw', reason: 'threefold' };
      this.roomStatus = 'ended';
      this.stopClock();
    } else if (this.chess.isDrawByFiftyMoves()) {
      this.result = { type: 'draw', reason: 'fifty-move' };
      this.roomStatus = 'ended';
      this.stopClock();
    }
  }

  private startClock() {
    this.stopClock();
    if (this.timeControl.initial === Infinity) return;
    this.lastClockTick = performance.now();
    this.clockInterval = setInterval(() => {
      const now = performance.now();
      const elapsed = (now - this.lastClockTick) / 1000;
      this.lastClockTick = now;

      if (this.chess.turn() === 'w') {
        this.whiteTime = Math.max(0, this.whiteTime - elapsed);
        if (this.whiteTime <= 0) {
          this.result = { type: 'timeout', winner: 'b' };
          this.roomStatus = 'ended';
          this.stopClock();
        }
      } else {
        this.blackTime = Math.max(0, this.blackTime - elapsed);
        if (this.blackTime <= 0) {
          this.result = { type: 'timeout', winner: 'w' };
          this.roomStatus = 'ended';
          this.stopClock();
        }
      }
      this.notify();
    }, 100);
  }

  private stopClock() {
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
  }

  resign() {
    if (this.roomStatus !== 'playing' || !this.playerColor) return;
    const winner = this.playerColor === 'w' ? 'b' : 'w';
    this.result = { type: 'resignation', winner: winner as Color };
    this.roomStatus = 'ended';
    this.stopClock();
    this.notify();
  }

  resetForRematch() {
    this.chess.reset();
    this.playerColor = this.playerColor === 'w' ? 'b' : 'w';
    this.roomStatus = 'playing';
    this.result = null;
    this.lastMove = null;
    this.selectedSquare = null;
    this.premove = null;
    if (this.timeControl.initial === Infinity) {
      this.whiteTime = Infinity;
      this.blackTime = Infinity;
    } else {
      this.whiteTime = this.timeControl.initial;
      this.blackTime = this.timeControl.initial;
    }
    this.startClock();
    this.notify();
  }

  getFen(): string {
    return this.chess.fen();
  }

  getTurn(): Color {
    return this.chess.turn();
  }

  getPlayerColor(): Color | null {
    return this.playerColor;
  }

  getHistory(): string[] {
    return this.chess.history();
  }

  getPgn(): string {
    return this.chess.pgn();
  }

  getCurrentTime(): { white: number; black: number } {
    return { white: this.whiteTime, black: this.blackTime };
  }

  needsPromotion(from: Square, to: Square): boolean {
    const piece = this.chess.get(from);
    if (!piece || piece.type !== 'p') return false;
    return (
      (piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1')
    );
  }

  isLegalMove(from: Square, to: Square): boolean {
    try {
      const moves = this.chess.moves({ square: from, verbose: true });
      return moves.some((m) => m.to === to);
    } catch {
      return false;
    }
  }

  getLegalMovesFrom(square: Square): Square[] {
    try {
      const moves = this.chess.moves({ square, verbose: true });
      return moves.map((m) => m.to);
    } catch {
      return [];
    }
  }

  destroy() {
    this.stopClock();
    this.listeners.clear();
  }
}
