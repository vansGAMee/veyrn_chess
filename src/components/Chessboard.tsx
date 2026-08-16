'use client';

import React, { useRef, useCallback, useEffect, useState } from 'react';
import type { Square, Color, PieceSymbol } from '@/types/chess';
import type { BoardState, MoveIntent } from '@/types/chess';
import { getPieceComponent } from './Pieces';
import { PromotionDialog } from './PromotionDialog';

interface ChessboardProps {
  board: BoardState;
  playerColor: Color;
  flipped?: boolean;
  onMove: (intent: MoveIntent) => boolean;
  onSelect: (square: Square | null) => void;
  onPremove?: (intent: MoveIntent | null) => void;
  premove?: MoveIntent | null;
  interactive: boolean;
  isLowTime?: boolean;
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

function squareFromIndex(index: number): Square {
  const file = index % 8;
  const rank = Math.floor(index / 8);
  return (FILES[file] + RANKS[rank]) as Square;
}

function indexFromSquare(sq: Square): number {
  const file = sq.charCodeAt(0) - 97;
  const rank = 8 - parseInt(sq[1], 10);
  return rank * 8 + file;
}

function isLightSquare(index: number): boolean {
  const file = index % 8;
  const rank = Math.floor(index / 8);
  return (file + rank) % 2 === 0;
}

interface DragState {
  pieceEl: HTMLElement;
  square: Square;
  startX: number;
  startY: number;
  isDragging: boolean;
  rafId: number;
  latestX: number;
  latestY: number;
}

export function Chessboard({
  board,
  playerColor,
  flipped,
  onMove,
  onSelect,
  onPremove,
  premove,
  interactive,
  isLowTime,
}: ChessboardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [hoveredSquare, setHoveredSquare] = useState<Square | null>(null);
  const [moveEcho, setMoveEcho] = useState<{ square: Square; type: PieceSymbol; color: Color } | null>(null);
  const [railMovePulse, setRailMovePulse] = useState(false);

  const isFlipped = flipped ?? playerColor === 'b';

  // Watch for lastMove changes to trigger Move Echo & Signal Rail pulse
  const prevLastMoveRef = useRef(board.lastMove);
  useEffect(() => {
    if (board.lastMove && board.lastMove !== prevLastMoveRef.current) {
      prevLastMoveRef.current = board.lastMove;
      
      // Find destination piece info for the echo afterimage at origin
      const destIdx = indexFromSquare(board.lastMove.to);
      const piece = board.pieces[destIdx];
      if (piece) {
        setMoveEcho({ square: board.lastMove.from, type: piece.type, color: piece.color });
        const timer = setTimeout(() => setMoveEcho(null), 220);
        return () => clearTimeout(timer);
      }

      // Signal Rail move pulse
      setRailMovePulse(true);
      const pulseTimer = setTimeout(() => setRailMovePulse(false), 200);
      return () => clearTimeout(pulseTimer);
    }
  }, [board.lastMove, board.pieces]);

  const getSquareFromPointer = useCallback((clientX: number, clientY: number): Square | null => {
    const el = boardRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const cellSize = rect.width / 8;
    let file = Math.floor((clientX - rect.left) / cellSize);
    let rank = Math.floor((clientY - rect.top) / cellSize);
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
    if (isFlipped) {
      file = 7 - file;
      rank = 7 - rank;
    }
    return (FILES[file] + RANKS[rank]) as Square;
  }, [isFlipped]);

  // Drag rAF loop: direct 1:1 translate3d transformation, bypasses React render tree
  const updateDragPosition = useCallback(() => {
    const drag = dragRef.current;
    if (!drag || !drag.isDragging) return;
    const dx = drag.latestX - drag.startX;
    const dy = drag.latestY - drag.startY;
    drag.pieceEl.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.035)`;
    drag.rafId = requestAnimationFrame(updateDragPosition);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;

    const square = getSquareFromPointer(e.clientX, e.clientY);
    if (!square) return;

    const piece = board.pieces[indexFromSquare(square)];
    const isMyTurn = board.turn === playerColor;

    // Click on destination when a square is already selected
    if (board.selectedSquare && square !== board.selectedSquare) {
      const isOwnPiece = piece && piece.color === playerColor;
      if (!isOwnPiece) {
        const from = board.selectedSquare;
        const to = square;

        // Check if move needs promotion
        const sourcePiece = board.pieces[indexFromSquare(from)];
        if (sourcePiece && sourcePiece.type === 'p') {
          const isPromoRank =
            (sourcePiece.color === 'w' && to[1] === '8') ||
            (sourcePiece.color === 'b' && to[1] === '1');
          if (isPromoRank && (board.legalMoves.includes(to) || !interactive)) {
            setPromotion({ from, to });
            return;
          }
        }

        if (isMyTurn || !interactive) {
          onMove({ from, to });
        } else if (onPremove) {
          onPremove({ from, to });
        }
        return;
      }
    }

    // Cancel existing premove if clicking destination/ghost
    if (premove && square === premove.to) {
      if (onPremove) onPremove(null);
      return;
    }

    // Select piece and initiate direct drag
    if (piece) {
      const isOwn = piece.color === playerColor;
      if (isOwn || !interactive) {
        onSelect(square);
      }

      const boardEl = boardRef.current;
      if (!boardEl) return;

      const pieceEl = boardEl.querySelector(`[data-square="${square}"]`) as HTMLElement | null;
      if (!pieceEl) return;

      pieceEl.setPointerCapture(e.pointerId);
      pieceEl.classList.add('dragging');

      dragRef.current = {
        pieceEl,
        square,
        startX: e.clientX,
        startY: e.clientY,
        isDragging: false,
        rafId: 0,
        latestX: e.clientX,
        latestY: e.clientY,
      };
    } else {
      onSelect(null);
    }
  }, [board, playerColor, interactive, premove, getSquareFromPointer, onSelect, onMove, onPremove]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Track hovered square for Living Coordinates
    const sq = getSquareFromPointer(e.clientX, e.clientY);
    setHoveredSquare(sq);

    const drag = dragRef.current;
    if (!drag) return;

    const dx = Math.abs(e.clientX - drag.startX);
    const dy = Math.abs(e.clientY - drag.startY);

    if (!drag.isDragging && (dx > 3 || dy > 3)) {
      drag.isDragging = true;
      drag.rafId = requestAnimationFrame(updateDragPosition);
    }

    drag.latestX = e.clientX;
    drag.latestY = e.clientY;
  }, [getSquareFromPointer, updateDragPosition]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;

    cancelAnimationFrame(drag.rafId);
    drag.pieceEl.classList.remove('dragging');
    drag.pieceEl.style.transform = '';

    try {
      drag.pieceEl.releasePointerCapture(e.pointerId);
    } catch {}

    if (drag.isDragging) {
      const targetSquare = getSquareFromPointer(e.clientX, e.clientY);
      if (targetSquare && targetSquare !== drag.square) {
        const sourcePiece = board.pieces[indexFromSquare(drag.square)];
        const isMyTurn = board.turn === playerColor;

        if (sourcePiece && sourcePiece.type === 'p') {
          const isPromoRank =
            (sourcePiece.color === 'w' && targetSquare[1] === '8') ||
            (sourcePiece.color === 'b' && targetSquare[1] === '1');
          if (isPromoRank) {
            setPromotion({ from: drag.square, to: targetSquare });
            dragRef.current = null;
            return;
          }
        }

        if (isMyTurn || !interactive) {
          onMove({ from: drag.square, to: targetSquare });
        } else if (onPremove && sourcePiece && sourcePiece.color === playerColor) {
          onPremove({ from: drag.square, to: targetSquare });
        }
      }
    }

    dragRef.current = null;
  }, [getSquareFromPointer, onMove, onPremove, board.pieces, board.turn, playerColor, interactive]);

  // Cancel selection/drag/premove on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const drag = dragRef.current;
        if (drag) {
          cancelAnimationFrame(drag.rafId);
          drag.pieceEl.classList.remove('dragging');
          drag.pieceEl.style.transform = '';
          dragRef.current = null;
        }
        onSelect(null);
        if (onPremove) onPremove(null);
        setPromotion(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSelect, onPremove]);

  // Prevent browser touch scroll during board interactions
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const preventScroll = (e: TouchEvent) => {
      if (dragRef.current?.isDragging) {
        e.preventDefault();
      }
    };
    el.addEventListener('touchmove', preventScroll, { passive: false });
    return () => el.removeEventListener('touchmove', preventScroll);
  }, []);

  const handlePromotion = useCallback((piece: 'q' | 'r' | 'b' | 'n') => {
    if (!promotion) return;
    if (board.turn === playerColor || !interactive) {
      onMove({ from: promotion.from, to: promotion.to, promotion: piece });
    } else if (onPremove) {
      onPremove({ from: promotion.from, to: promotion.to, promotion: piece });
    }
    setPromotion(null);
  }, [promotion, board.turn, playerColor, interactive, onMove, onPremove]);

  // Determine current hovered file & rank for Living Coordinates
  const hoveredFile = hoveredSquare ? hoveredSquare[0] : null;
  const hoveredRank = hoveredSquare ? hoveredSquare[1] : null;

  // Render the 64 squares of the manufactured plane
  const squares = [];
  for (let i = 0; i < 64; i++) {
    const visualIdx = isFlipped ? 63 - i : i;
    const sq = squareFromIndex(visualIdx);
    const light = isLightSquare(visualIdx);
    const piece = board.pieces[visualIdx];

    const isSelected = board.selectedSquare === sq;
    const isLastMove = board.lastMove && (board.lastMove.from === sq || board.lastMove.to === sq);
    const isLegal = board.legalMoves.includes(sq);
    const isCheck = board.isCheck && piece && piece.type === 'k' && piece.color === board.turn;
    const hasPiece = piece !== null;

    // Ghost premove checking
    const isPremoveDest = premove && premove.to === sq;
    const isPremoveOrigin = premove && premove.from === sq;

    const squareClasses = [
      'square',
      light ? 'light' : 'dark',
      isSelected ? 'selected' : '',
      isLastMove ? 'last-move' : '',
      isLegal ? 'legal' : '',
      isCheck ? 'check' : '',
      hasPiece && isLegal ? 'has-piece' : '',
      isPremoveDest ? 'premove-dest' : '',
    ].filter(Boolean).join(' ');

    // Coordinates: bottom row (files) & left column (ranks)
    const showFile = i >= 56;
    const showRank = i % 8 === 0;
    const displayFile = isFlipped ? FILES[7 - (i % 8)] : FILES[i % 8];
    const displayRank = isFlipped ? RANKS[7 - Math.floor(i / 8)] : RANKS[Math.floor(i / 8)];

    const fileActive = hoveredFile === displayFile;
    const rankActive = hoveredRank === displayRank;

    // Ghost premove piece definition
    let ghostPieceComp: React.FC<{ className?: string }> | null = null;
    if (isPremoveDest && premove) {
      const sourcePiece = board.pieces[indexFromSquare(premove.from)];
      if (sourcePiece) {
        ghostPieceComp = getPieceComponent(sourcePiece.color, sourcePiece.type);
      }
    }

    squares.push(
      <div key={sq} className={squareClasses} data-sq={sq}>
        {showFile && (
          <span className={`coord coord-file ${fileActive ? 'coord-active' : ''}`}>
            {displayFile}
          </span>
        )}
        {showRank && (
          <span className={`coord coord-rank ${rankActive ? 'coord-active' : ''}`}>
            {displayRank}
          </span>
        )}

        {/* Move Echo Afterimage */}
        {moveEcho && moveEcho.square === sq && (
          <div className="piece echo" data-type={moveEcho.type}>
            {(() => {
              const EchoComp = getPieceComponent(moveEcho.color, moveEcho.type);
              return EchoComp ? <EchoComp /> : null;
            })()}
          </div>
        )}

        {/* Ghost Premove */}
        {isPremoveDest && ghostPieceComp && (
          <div className="piece ghost">
            {React.createElement(ghostPieceComp)}
          </div>
        )}

        {/* Actual Piece */}
        {piece && (
          <div
            className={`piece ${isPremoveOrigin ? 'premove-origin' : ''}`}
            data-square={sq}
            data-type={piece.type}
            data-color={piece.color}
          >
            {(() => {
              const PieceComp = getPieceComponent(piece.color, piece.type);
              return PieceComp ? <PieceComp /> : null;
            })()}
          </div>
        )}
      </div>
    );
  }

  // Signal Rail state computation
  const getRailState = () => {
    if (railMovePulse) return 'move';
    if (isLowTime) return 'low';
    if (board.turn === 'w') return 'white';
    if (board.turn === 'b') return 'black';
    return 'idle';
  };

  return (
    <div
      ref={boardRef}
      className="board-container"
      data-rail={getRailState()}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => setHoveredSquare(null)}
      role="application"
      aria-label="Obsidian Chess Instrument"
    >
      <div className="board">{squares}</div>

      {promotion && (
        <PromotionDialog
          color={playerColor}
          onSelect={handlePromotion}
          onCancel={() => setPromotion(null)}
        />
      )}
    </div>
  );
}
