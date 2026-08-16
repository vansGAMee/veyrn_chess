'use client';

import React, { useState, useCallback } from 'react';
import type { TimeControl, GameResult } from '@/types/chess';
import { TIME_CONTROLS } from '@/types/chess';
import type { TransportStatus, TransportStats } from '@/transport/GameTransport';

interface SetupControlsProps {
  selectedTC: TimeControl;
  onSelectTC: (tc: TimeControl) => void;
  onCreateRoom: () => void;
  statusText?: string;
}

export function SetupControls({
  selectedTC,
  onSelectTC,
  onCreateRoom,
  statusText = 'P2P DIRECT',
}: SetupControlsProps) {
  return (
    <div className="control-strip" role="group" aria-label="Instrument control strip">
      {/* Presets segment */}
      <div className="control-segment-tc">
        {TIME_CONTROLS.map((tc) => (
          <button
            key={tc.label}
            className={`tc-item ${selectedTC.label === tc.label ? 'active' : ''}`}
            onClick={() => onSelectTC(tc)}
            aria-pressed={selectedTC.label === tc.label}
            aria-label={`Time control ${tc.label}`}
          >
            {tc.label}
          </button>
        ))}
      </div>

      {/* Primary Action */}
      <button
        className="control-action-create"
        onClick={onCreateRoom}
        aria-label="Create room"
      >
        Create room
      </button>

      {/* Utility Status indicator */}
      <div className="control-status" title="WebRTC Direct Mesh Ready">
        <span className="status-dot" />
        <span className="status-label">{statusText}</span>
      </div>
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
    <div className="control-strip waiting-strip waiting-bar">
      <div className="waiting-info">
        <span className="status-dot waiting" />
        <span className="waiting-text">Awaiting Opponent</span>
      </div>
      <button
        className={`control-action-copy ${copied ? 'copied' : ''}`}
        onClick={handleCopy}
        aria-label="Copy room link"
      >
        {copied ? 'Link Copied' : 'Copy Room Link'}
      </button>
    </div>
  );
}

interface ConnectionBarProps {
  status: TransportStatus;
  stats?: TransportStats | null;
  onRetry?: () => void;
  onNewGame?: () => void;
}

export function ConnectionBar({
  status,
  stats,
  onRetry,
  onNewGame,
}: ConnectionBarProps) {
  let label = 'Connecting to opponent…';
  let dotClass = 'status-dot waiting';
  let canRetry = false;

  if (status === 'timeout') {
    label = 'Connection timed out';
    dotClass = 'status-dot danger';
    canRetry = true;
  } else if (status === 'failed') {
    label = 'Connection failed';
    dotClass = 'status-dot danger';
    canRetry = true;
  } else if (status === 'peer-disconnected') {
    label = 'Opponent disconnected';
    dotClass = 'status-dot warning';
  } else if (status === 'disconnected') {
    label = 'Disconnected';
    dotClass = 'status-dot danger';
    canRetry = true;
  } else if (status === 'connected') {
    const relayMode = stats?.isRelay ? 'TURN Relay' : 'P2P Direct';
    label = `Connected (${relayMode})`;
    dotClass = stats?.isRelay ? 'status-dot relay' : 'status-dot';
  }

  return (
    <div className="control-strip waiting-strip waiting-bar">
      <div className="waiting-info">
        <span className={dotClass} />
        <span className="waiting-text">{label}</span>
      </div>
      <div className="end-actions">
        {canRetry && onRetry && (
          <button
            className="control-action-rematch"
            onClick={onRetry}
            aria-label="Retry connection"
          >
            Retry
          </button>
        )}
        {onNewGame && (
          <button
            className="control-action-new"
            onClick={onNewGame}
            aria-label="New game"
          >
            New Game
          </button>
        )}
      </div>
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
        detail: `${result.winner === 'w' ? 'White' : 'Black'} won`,
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
        detail: `${result.winner === 'w' ? 'White' : 'Black'} won`,
      };
    case 'timeout':
      return {
        main: 'Time out',
        detail: `${result.winner === 'w' ? 'White' : 'Black'} won`,
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
    <div className="control-strip end-strip">
      <div className="game-end-summary">
        <span className="end-main">{main}</span>
        <span className="end-divider">/</span>
        <span className="end-detail">{detail}</span>
      </div>
      <div className="end-actions">
        <button className="control-action-rematch" onClick={onRematch}>
          Rematch
        </button>
        {pgn && (
          <button className="control-action-pgn" onClick={handleCopyPgn}>
            {copiedPgn ? 'PGN Copied' : 'Copy PGN'}
          </button>
        )}
        <button className="control-action-new" onClick={onNewRoom}>
          New Game
        </button>
      </div>
    </div>
  );
}
