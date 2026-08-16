'use client';

import React, { useState, useCallback } from 'react';
import type { TimeControl, RoomStatus, GameResult } from '@/types/chess';
import { TIME_CONTROLS } from '@/types/chess';

interface SetupControlsProps {
  selectedTC: TimeControl;
  onSelectTC: (tc: TimeControl) => void;
  onCreateRoom: () => void;
}

export function SetupControls({ selectedTC, onSelectTC, onCreateRoom }: SetupControlsProps) {
  return (
    <div className="setup-controls" role="group" aria-label="Game setup">
      {TIME_CONTROLS.map((tc) => (
        <button
          key={tc.label}
          className={`tc-button ${selectedTC.label === tc.label ? 'active' : ''}`}
          onClick={() => onSelectTC(tc)}
          aria-pressed={selectedTC.label === tc.label}
          aria-label={`Time control ${tc.label}`}
        >
          {tc.label}
        </button>
      ))}
      <button
        className="create-button"
        onClick={onCreateRoom}
        aria-label="Create room"
      >
        Create room
      </button>
    </div>
  );
}

interface WaitingBarProps {
  roomId: string;
}

export function WaitingBar({ roomId }: WaitingBarProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const url = `${window.location.origin}/room/${roomId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [roomId]);

  return (
    <div className="waiting-bar">
      <span className="waiting-text">Waiting for opponent</span>
      <button
        className={`copy-button ${copied ? 'copied' : ''}`}
        onClick={handleCopy}
        aria-label="Copy room link"
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  );
}

interface GameEndBarProps {
  result: GameResult;
  onRematch: () => void;
  onNewRoom: () => void;
  pgn?: string;
}

function resultText(result: GameResult): { main: string; detail: string } {
  switch (result.type) {
    case 'checkmate':
      return {
        main: 'Checkmate',
        detail: `${result.winner === 'w' ? 'White' : 'Black'} wins`,
      };
    case 'stalemate':
      return { main: 'Stalemate', detail: 'Draw' };
    case 'draw':
      const reasons: Record<string, string> = {
        insufficient: 'Insufficient material',
        threefold: 'Threefold repetition',
        'fifty-move': 'Fifty-move rule',
        agreement: 'By agreement',
      };
      return { main: 'Draw', detail: reasons[result.reason] || 'Draw' };
    case 'resignation':
      return {
        main: 'Resignation',
        detail: `${result.winner === 'w' ? 'White' : 'Black'} wins`,
      };
    case 'timeout':
      return {
        main: 'Time out',
        detail: `${result.winner === 'w' ? 'White' : 'Black'} wins`,
      };
  }
}

export function GameEndBar({ result, onRematch, onNewRoom, pgn }: GameEndBarProps) {
  const { main, detail } = resultText(result);
  const [copiedPgn, setCopiedPgn] = useState(false);

  const handleCopyPgn = useCallback(async () => {
    if (!pgn) return;
    try {
      await navigator.clipboard.writeText(pgn);
      setCopiedPgn(true);
      setTimeout(() => setCopiedPgn(false), 2000);
    } catch {}
  }, [pgn]);

  return (
    <div className="game-end">
      <div className="game-end-result">{main}</div>
      <div className="game-end-detail">{detail}</div>
      <div className="game-end-actions">
        <button className="primary" onClick={onRematch}>Rematch</button>
        {pgn && (
          <button onClick={handleCopyPgn}>
            {copiedPgn ? 'Copied' : 'Copy PGN'}
          </button>
        )}
        <button onClick={onNewRoom}>New room</button>
      </div>
    </div>
  );
}
