'use client';

import React from 'react';
import type { Color } from '@/types/chess';
import { getPieceComponent } from './Pieces';

interface PromotionDialogProps {
  color: Color;
  onSelect: (piece: 'q' | 'r' | 'b' | 'n') => void;
  onCancel: () => void;
}

const PROMOTION_PIECES: ('q' | 'r' | 'b' | 'n')[] = ['q', 'r', 'b', 'n'];

export function PromotionDialog({ color, onSelect, onCancel }: PromotionDialogProps) {
  return (
    <div className="promotion-overlay" onClick={onCancel} role="dialog" aria-label="Choose promotion piece">
      <div className="promotion-choices" onClick={(e) => e.stopPropagation()}>
        {PROMOTION_PIECES.map((piece) => {
          const PieceComp = getPieceComponent(color, piece);
          return (
            <button
              key={piece}
              className="promotion-choice"
              onClick={() => onSelect(piece)}
              aria-label={`Promote to ${piece === 'q' ? 'queen' : piece === 'r' ? 'rook' : piece === 'b' ? 'bishop' : 'knight'}`}
            >
              {PieceComp && <PieceComp />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
