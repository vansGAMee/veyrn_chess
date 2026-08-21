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

interface Arrow {
  from: Square;
  to: Square;
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
  grabOffsetX: number;
  grabOffsetY: number;
  isDragging: boolean;
  rafId: number;
  latestX: number;
  latestY: number;
}

interface RightDragState {
  startSquare: Square;
  currentSquare: Square | null;
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
  const rightDragRef = useRef<RightDragState | null>(null);

  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [hoveredSquare, setHoveredSquare] = useState<Square | null>(null);
  const [moveEcho, setMoveEcho] = useState<{ square: Square; type: PieceSymbol; color: Color } | null>(null);
  const [railMovePulse, setRailMovePulse] = useState(false);

  // Planning tools: Right-click Arrows & Square Markers
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [markers, setMarkers] = useState<Square[]>([]);
  const [liveArrow, setLiveArrow] = useState<Arrow | null>(null);

  const isFlipped = flipped ?? playerColor === 'b';

  // Watch for lastMove changes to clear planning arrows and trigger Move Echo
  const prevLastMoveRef = useRef(board.lastMove);
  useEffect(() => {
    if (board.lastMove && board.lastMove !== prevLastMoveRef.current) {
      prevLastMoveRef.current = board.lastMove;

      const lastMove = board.lastMove;
      const destIdx = indexFromSquare(lastMove.to);
      const piece = board.pieces[destIdx];

      const animTimer = setTimeout(() => {
        setArrows([]);
        setMarkers([]);

        if (piece) {
          setMoveEcho({ square: lastMove.from, type: piece.type, color: piece.color });
          setTimeout(() => setMoveEcho(null), 200);
        } else {
          setRailMovePulse(true);
          setTimeout(() => setRailMovePulse(false), 200);
        }
      }, 0);

      return () => clearTimeout(animTimer);
    }
  }, [board.lastMove, board.pieces]);

  // Robust coordinate mapping using freshly measured bounding client rect
  const getSquareFromPointer = useCallback((clientX: number, clientY: number): Square | null => {
    const el = boardRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const cellWidth = rect.width / 8;
    const cellHeight = rect.height / 8;
    let file = Math.floor((clientX - rect.left) / cellWidth);
    let rank = Math.floor((clientY - rect.top) / cellHeight);

    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;

    if (isFlipped) {
      file = 7 - file;
      rank = 7 - rank;
    }
    return (FILES[file] + RANKS[rank]) as Square;
  }, [isFlipped]);

  // Drag rAF loop: 1:1 hardware translation with zero drift
  const updateDragPositionRef = useRef<() => void>(() => {});
  const updateDragPosition = useCallback(() => {
    const drag = dragRef.current;
    if (!drag || !drag.isDragging) return;

    const dx = drag.latestX - drag.startX + drag.grabOffsetX;
    const dy = drag.latestY - drag.startY + drag.grabOffsetY;

    drag.pieceEl.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    drag.rafId = requestAnimationFrame(() => updateDragPositionRef.current());
  }, []);

  useEffect(() => {
    updateDragPositionRef.current = updateDragPosition;
  }, [updateDragPosition]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const square = getSquareFromPointer(e.clientX, e.clientY);
    if (!square) return;

    // ── RIGHT CLICK: Start drawing arrow / marker ────────
    if (e.button === 2) {
      rightDragRef.current = {
        startSquare: square,
        currentSquare: square,
      };
      return;
    }

    // ── LEFT CLICK: Clear arrows & handle moves ──────────
    if (e.button === 0) {
      if (arrows.length > 0 || markers.length > 0) {
        setArrows([]);
        setMarkers([]);
      }

      const piece = board.pieces[indexFromSquare(square)];
      const isMyTurn = board.turn === playerColor;

      // Click on destination when a square is already selected
      if (board.selectedSquare && square !== board.selectedSquare) {
        const isOwnPiece = piece && piece.color === playerColor;
        if (!isOwnPiece) {
          const from = board.selectedSquare;
          const to = square;

          // Check promotion requirement
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

      // Cancel premove if clicking destination
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

        const pieceRect = pieceEl.getBoundingClientRect();
        const grabOffsetX = e.clientX - (pieceRect.left + pieceRect.width / 2);
        const grabOffsetY = e.clientY - (pieceRect.top + pieceRect.height / 2);

        pieceEl.setPointerCapture(e.pointerId);
        pieceEl.classList.add('dragging');

        dragRef.current = {
          pieceEl,
          square,
          startX: e.clientX,
          startY: e.clientY,
          grabOffsetX,
          grabOffsetY,
          isDragging: false,
          rafId: 0,
          latestX: e.clientX,
          latestY: e.clientY,
        };
      } else {
        onSelect(null);
      }
    }
  }, [board, playerColor, interactive, premove, arrows.length, markers.length, getSquareFromPointer, onSelect, onMove, onPremove]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const sq = getSquareFromPointer(e.clientX, e.clientY);
    setHoveredSquare(sq);

    // Right drag arrow tracking
    if (rightDragRef.current && sq) {
      rightDragRef.current.currentSquare = sq;
      if (sq !== rightDragRef.current.startSquare) {
        setLiveArrow({ from: rightDragRef.current.startSquare, to: sq });
      } else {
        setLiveArrow(null);
      }
    }

    // Left drag piece tracking
    const drag = dragRef.current;
    if (!drag) return;

    const dx = Math.abs(e.clientX - drag.startX);
    const dy = Math.abs(e.clientY - drag.startY);

    if (!drag.isDragging && (dx > 2 || dy > 2)) {
      drag.isDragging = true;
      drag.rafId = requestAnimationFrame(updateDragPosition);
    }

    drag.latestX = e.clientX;
    drag.latestY = e.clientY;
  }, [getSquareFromPointer, updateDragPosition]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // ── RIGHT CLICK RELEASE: Commit arrow or toggle marker ──
    if (e.button === 2 && rightDragRef.current) {
      const from = rightDragRef.current.startSquare;
      const to = getSquareFromPointer(e.clientX, e.clientY) || rightDragRef.current.currentSquare;

      setLiveArrow(null);
      rightDragRef.current = null;

      if (to && from !== to) {
        // Toggle arrow
        setArrows((prev) => {
          const exists = prev.some((a) => a.from === from && a.to === to);
          if (exists) {
            return prev.filter((a) => !(a.from === from && a.to === to));
          }
          return [...prev, { from, to }];
        });
      } else if (from) {
        // Toggle square marker
        setMarkers((prev) => {
          if (prev.includes(from)) {
            return prev.filter((s) => s !== from);
          }
          return [...prev, from];
        });
      }
      return;
    }

    // ── LEFT CLICK RELEASE: Complete piece drop ─────────────
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

  // Cancel selection/drag/arrows on Escape
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
        setArrows([]);
        setMarkers([]);
        setLiveArrow(null);
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

  const hoveredFile = hoveredSquare ? hoveredSquare[0] : null;
  const hoveredRank = hoveredSquare ? hoveredSquare[1] : null;

  // Helper to get SVG center coords (0-800) for a square
  const getSquareCenter = useCallback((sq: Square) => {
    let file = sq.charCodeAt(0) - 97;
    let rank = 8 - parseInt(sq[1], 10);
    if (isFlipped) {
      file = 7 - file;
      rank = 7 - rank;
    }
    return {
      x: file * 100 + 50,
      y: rank * 100 + 50,
    };
  }, [isFlipped]);

  // Render the 64 squares of the manufactured plane
  const squares = [];
  for (let i = 0; i < 64; i++) {
    const visualIdx = isFlipped ? 63 - i : i;
    const sq = squareFromIndex(visualIdx);
    const light = isLightSquare(visualIdx);
    const piece = board.pieces[visualIdx];

    const isSelected = board.selectedSquare === sq;
    const isLastMoveFrom = board.lastMove && board.lastMove.from === sq;
    const isLastMoveTo = board.lastMove && board.lastMove.to === sq;
    const isLegal = board.legalMoves.includes(sq);
    const isCheck = board.isCheck && piece && piece.type === 'k' && piece.color === board.turn;
    const hasPiece = piece !== null;
    const isMarked = markers.includes(sq);

    // Ghost premove checking
    const isPremoveDest = premove && premove.to === sq;
    const isPremoveOrigin = premove && premove.from === sq;

    const squareClasses = [
      'square',
      light ? 'light' : 'dark',
      isSelected ? 'selected' : '',
      isLastMoveFrom ? 'last-move-from' : '',
      isLastMoveTo ? 'last-move-to' : '',
      isLegal ? 'legal' : '',
      isCheck ? 'check' : '',
      isMarked ? 'marked' : '',
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
        {/* Engraved Living Coordinates */}
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

        {/* Actual Piece (z-index 4: sits on top of planning arrows) */}
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
    if (board.isCheck) return 'check';
    if (railMovePulse) return 'move';
    if (isLowTime) return 'low';
    if (board.turn === 'w') return 'white';
    if (board.turn === 'b') return 'black';
    return 'idle';
  };

  // Compile active arrows list (saved + currently dragging)
  const allArrows = liveArrow ? [...arrows, liveArrow] : arrows;

  return (
    <div
      ref={boardRef}
      className="board-container"
      data-rail={getRailState()}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => {
        setHoveredSquare(null);
        if (rightDragRef.current) {
          setLiveArrow(null);
          rightDragRef.current = null;
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
      role="application"
      aria-label="Obsidian Chess Instrument"
    >
      <div className="board">{squares}</div>

      {/* Planning Arrows SVG Overlay (z-index: 3, behind pieces at z-index: 4) */}
      {allArrows.length > 0 && (
        <svg
          className="board-arrows-overlay"
          viewBox="0 0 800 800"
          aria-hidden="true"
        >
          {allArrows.map((arrow, idx) => {
            const start = getSquareCenter(arrow.from);
            const end = getSquareCenter(arrow.to);

            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 2) return null;

            const ux = dx / dist;
            const uy = dy / dist;
            const nx = -uy;
            const ny = ux;

            // Compact, calibrated arrowhead geometry
            const headLen = Math.min(22, dist * 0.28);
            const headWidth = headLen * 0.95;

            // Shaft starts slightly away from source center
            const shaftStartX = start.x + ux * 16;
            const shaftStartY = start.y + uy * 16;

            // Arrowhead tip stops before target center to avoid punch-through
            const tipX = end.x - ux * 10;
            const tipY = end.y - uy * 10;

            const baseX = tipX - ux * headLen;
            const baseY = tipY - uy * headLen;

            const leftX = baseX + nx * (headWidth / 2);
            const leftY = baseY + ny * (headWidth / 2);

            const rightX = baseX - nx * (headWidth / 2);
            const rightY = baseY - ny * (headWidth / 2);

            return (
              <g key={`${arrow.from}-${arrow.to}-${idx}`} className="arrow-group">
                <line
                  x1={shaftStartX}
                  y1={shaftStartY}
                  x2={baseX}
                  y2={baseY}
                  stroke="var(--accent-arrow)"
                  strokeWidth="7"
                  strokeLinecap="round"
                />
                <polygon
                  points={`${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY}`}
                  fill="var(--accent-arrow)"
                />
              </g>
            );
          })}
        </svg>
      )}

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
