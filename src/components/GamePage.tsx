'use client';

import React, { useState, useCallback, useRef, useEffect, useSyncExternalStore } from 'react';
import { GameEngine } from '@/engine/GameEngine';
import {
  P2PGameTransport,
  type TransportStatus,
  type TransportStats,
} from '@/transport/GameTransport';
import type { TimeControl, MoveIntent } from '@/types/chess';
import type { Color, Square } from '@/types/chess';
import { TIME_CONTROLS } from '@/types/chess';
import type { GameMessagePayload } from '@/types/protocol';
import { Chessboard } from '@/components/Chessboard';
import { Clock } from '@/components/Clock';
import {
  SetupControls,
  WaitingBar,
  GameEndBar,
  ConnectionBar,
} from '@/components/GameControls';
import {
  playMoveSound,
  playCaptureSound,
  playCheckSound,
  playGameStartSound,
  playGameEndSound,
  playPeerJoinedSound,
  initAudioOnGesture,
} from '@/engine/SoundEngine';

function generateRoomId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

interface GamePageProps {
  roomId?: string;
  isJoining?: boolean;
}

export default function GamePage({ roomId: initialRoomId, isJoining }: GamePageProps) {
  const [engine] = useState(() => new GameEngine());
  const transportRef = useRef<P2PGameTransport | null>(null);

  // Stable subscription with useSyncExternalStore
  const getSnapshot = useCallback(() => engine.getState(), [engine]);
  const subscribe = useCallback(
    (cb: () => void) => {
      return engine.subscribe(() => cb());
    },
    [engine]
  );

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const [selectedTC, setSelectedTC] = useState<TimeControl>(TIME_CONTROLS[3]); // 5+0 default
  const [transportStatus, setTransportStatus] = useState<TransportStatus>('idle');
  const [transportStats, setTransportStats] = useState<TransportStats | null>(null);
  const [activeRoomId, setActiveRoomId] = useState<string>(initialRoomId || '');
  const [isHostRole, setIsHostRole] = useState<boolean>(!isJoining);
  const [isZen, setIsZen] = useState(false);
  const zenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoJoinInitiatedRef = useRef(false);

  // Auto Zen: after first move, quiet secondary controls during focus
  const handleActivity = useCallback(() => {
    setIsZen(false);
    if (zenTimeoutRef.current) clearTimeout(zenTimeoutRef.current);

    if (state.room.status === 'playing') {
      zenTimeoutRef.current = setTimeout(() => {
        setIsZen(true);
      }, 4000);
    }
  }, [state.room.status]);

  useEffect(() => {
    window.addEventListener('pointermove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    return () => {
      window.removeEventListener('pointermove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      if (zenTimeoutRef.current) clearTimeout(zenTimeoutRef.current);
    };
  }, [handleActivity]);

  const setupTransport = useCallback(
    (roomId: string, isHost: boolean) => {
      if (transportRef.current) {
        transportRef.current.disconnect();
      }

      const transport = new P2PGameTransport();
      transportRef.current = transport;

      transport.onStatus((status, stats) => {
        setTransportStatus(status);
        if (stats) setTransportStats(stats);
      });

      transport.subscribe((payload: GameMessagePayload) => {
        switch (payload.type) {
          case 'hello': {
            // Guest announced presence to Host
            if (isHost) {
              const hostColor: Color = Math.random() > 0.5 ? 'w' : 'b';
              const guestColor: Color = hostColor === 'w' ? 'b' : 'w';

              transport.send({
                type: 'ready',
                color: guestColor,
              });

              engine.startGame(hostColor);
              playPeerJoinedSound();
              setTimeout(() => playGameStartSound(), 280);
            }
            break;
          }

          case 'ready': {
            // Guest receives allocated color from Host
            const readyPayload = payload as { type: 'ready'; color: Color };
            engine.startGame(readyPayload.color);
            playPeerJoinedSound();
            setTimeout(() => playGameStartSound(), 280);
            break;
          }

          case 'move': {
            const movePayload = payload as {
              type: 'move';
              from: Square;
              to: Square;
              promotion?: 'q' | 'r' | 'b' | 'n';
              clock: number;
            };
            const beforeState = engine.getState().board;
            const toIdx =
              movePayload.to.charCodeAt(0) -
              97 +
              (8 - parseInt(movePayload.to[1], 10)) * 8;
            const wasCapture = beforeState.pieces[toIdx] !== null;

            // Apply remote move & check if local queued premove executes
            const executedPremove = engine.applyRemoteMove(
              movePayload.from,
              movePayload.to,
              movePayload.promotion,
              movePayload.clock
            );

            const afterState = engine.getState().board;
            if (afterState.isCheck) {
              playCheckSound();
            } else if (wasCapture) {
              playCaptureSound(movePayload.to);
            } else {
              playMoveSound(movePayload.to);
            }

            if (afterState.isGameOver) {
              setTimeout(() => playGameEndSound(), 220);
            }

            // If premove was automatically executed, send it across the wire
            if (executedPremove && transportRef.current) {
              const times = engine.getCurrentTime();
              const myColor = engine.getPlayerColor();
              const myClock = myColor === 'w' ? times.white : times.black;

              transportRef.current.send({
                type: 'move',
                from: executedPremove.from,
                to: executedPremove.to,
                promotion: executedPremove.promotion,
                clock: myClock,
              });
              playMoveSound(executedPremove.to);
            }
            break;
          }

          case 'rematch-offer': {
            // Reciprocal rematch acceptance
            transport.send({ type: 'rematch-response', accepted: true });
            engine.resetForRematch();
            playGameStartSound();
            break;
          }

          case 'rematch-response': {
            const rematchPayload = payload as { type: 'rematch-response'; accepted: boolean };
            if (rematchPayload.accepted) {
              engine.resetForRematch();
              playGameStartSound();
            }
            break;
          }

          case 'resign': {
            engine.resign();
            playGameEndSound();
            break;
          }

          case 'ping': {
            const pingPayload = payload as { type: 'ping'; sent: number };
            transport.send({ type: 'pong', sent: pingPayload.sent, received: Date.now() });
            break;
          }
        }
      });

      return transport;
    },
    [engine]
  );

  const handleCreateRoom = useCallback(() => {
    initAudioOnGesture();
    const roomId = generateRoomId();
    setActiveRoomId(roomId);
    setIsHostRole(true);

    engine.setTimeControl(selectedTC);
    engine.createRoom(roomId);

    const transport = setupTransport(roomId, true);
    transport.connect(roomId, true).catch((err) => {
      console.warn('Host connection notice:', err);
    });

    window.history.pushState({}, '', `/room/${roomId}`);
  }, [engine, selectedTC, setupTransport]);

  const handleJoinRoom = useCallback(
    (roomId: string) => {
      initAudioOnGesture();
      setActiveRoomId(roomId);
      setIsHostRole(false);

      engine.setTimeControl(selectedTC);
      engine.joinRoom(roomId, 'b');

      const transport = setupTransport(roomId, false);
      transport
        .connect(roomId, false)
        .then(() => {
          transport.send({ type: 'hello' });
        })
        .catch((err) => {
          console.warn('Guest connection notice:', err);
        });
    },
    [engine, selectedTC, setupTransport]
  );

  const handleRetryConnection = useCallback(() => {
    if (!activeRoomId) return;
    if (isHostRole) {
      handleCreateRoom();
    } else {
      handleJoinRoom(activeRoomId);
    }
  }, [activeRoomId, isHostRole, handleCreateRoom, handleJoinRoom]);

  // Auto-join from URL parameter
  useEffect(() => {
    if (isJoining && initialRoomId && !autoJoinInitiatedRef.current) {
      autoJoinInitiatedRef.current = true;
      handleJoinRoom(initialRoomId);
    }
  }, [isJoining, initialRoomId, handleJoinRoom]);

  const handleMove = useCallback((intent: MoveIntent): boolean => {
    const beforeState = engine.getState().board;
    const toIdx =
      intent.to.charCodeAt(0) - 97 + (8 - parseInt(intent.to[1], 10)) * 8;
    const isCapture = beforeState.pieces[toIdx] !== null;

    const success = engine.tryMove(intent);
    if (success) {
      const newState = engine.getState();
      if (newState.board.isCheck) {
        playCheckSound();
      } else if (isCapture) {
        playCaptureSound(intent.to);
      } else {
        playMoveSound(intent.to);
      }

      if (newState.board.isGameOver) {
        setTimeout(() => playGameEndSound(), 220);
      }

      if (transportRef.current && transportRef.current.isConnected()) {
        const times = engine.getCurrentTime();
        const myColor = engine.getPlayerColor();
        const myClock = myColor === 'w' ? times.white : times.black;

        transportRef.current.send({
          type: 'move',
          from: intent.from,
          to: intent.to,
          promotion: intent.promotion,
          clock: myClock,
        });
      }
    }
    return success;
  }, [engine]);

  const handleSelect = useCallback(
    (square: Square | null) => {
      if (square === null) {
        engine.clearSelection();
        return;
      }

      const moveIntent = engine.selectSquare(square);
      if (moveIntent) {
        handleMove(moveIntent);
      }
    },
    [engine, handleMove]
  );

  const handlePremove = useCallback((intent: MoveIntent | null) => {
    engine.setPremove(intent);
  }, [engine]);

  const handleRematch = useCallback(() => {
    if (transportRef.current) {
      transportRef.current.send({ type: 'rematch-offer' });
    }
    engine.resetForRematch();
    playGameStartSound();
  }, [engine]);

  const handleResign = useCallback(() => {
    if (transportRef.current) {
      transportRef.current.send({ type: 'resign' });
    }
    engine.resign();
    playGameEndSound();
  }, [engine]);

  const handleNewRoom = useCallback(() => {
    if (transportRef.current) {
      transportRef.current.disconnect();
      transportRef.current = null;
    }
    setTransportStatus('idle');
    setTransportStats(null);
    setActiveRoomId('');
    window.history.pushState({}, '', '/');
    engine.createRoom('');
  }, [engine]);

  const handleSelectTC = useCallback(
    (tc: TimeControl) => {
      setSelectedTC(tc);
      engine.setTimeControl(tc);
    },
    [engine]
  );

  // Dynamic viewport-proportional board size
  useEffect(() => {
    const computeBoardSize = () => {
      const vh = window.innerHeight;
      const vw = window.innerWidth;

      const verticalReserved = 100;
      const maxFromHeight = Math.floor(vh - verticalReserved);
      const maxFromWidth = vw - 32;

      const size = Math.min(maxFromHeight, maxFromWidth);
      const clamped = Math.max(280, Math.min(size, 860));

      document.documentElement.style.setProperty('--board-size', `${clamped}px`);
    };

    computeBoardSize();
    window.addEventListener('resize', computeBoardSize);
    return () => window.removeEventListener('resize', computeBoardSize);
  }, []);

  // Teardown
  useEffect(() => {
    return () => {
      transportRef.current?.disconnect();
      engine.destroy();
    };
  }, [engine]);

  const { board, room, premove } = state;
  const isPlaying = room.status === 'playing';
  const isEnded = room.status === 'ended';
  const isWaiting = room.status === 'waiting' && transportStatus === 'waiting';
  const isIdle = room.status === 'idle';

  // In idle mode, player is White by default but can move both sides
  const playerColor: Color = room.playerColor || (isIdle ? 'w' : 'w');

  const topColor: Color = playerColor === 'w' ? 'b' : 'w';
  const bottomColor: Color = playerColor;
  const topTime = topColor === 'w' ? room.whiteTime : room.blackTime;
  const bottomTime = bottomColor === 'w' ? room.whiteTime : room.blackTime;

  const topActive = (isPlaying || isIdle) && board.turn === topColor;
  const bottomActive = (isPlaying || isIdle) && board.turn === bottomColor;

  const isLowTime =
    isPlaying &&
    ((board.turn === 'w' && room.whiteTime < 20) ||
      (board.turn === 'b' && room.blackTime < 20));

  return (
    <div className={`app ${isZen && isPlaying ? 'zen-mode' : ''}`}>
      {/* Top Player Row */}
      <div className="player-row">
        <span className={`player-name ${topActive ? 'active' : ''}`}>
          {topColor === 'w' ? 'White' : 'Black'}
        </span>
        <Clock time={topTime} active={topActive} />
      </div>

      {/* Obsidian Chess Instrument Board */}
      <Chessboard
        board={board}
        playerColor={playerColor}
        onMove={handleMove}
        onSelect={handleSelect}
        onPremove={handlePremove}
        premove={premove}
        interactive={!isEnded}
        isLowTime={isLowTime}
      />

      {/* Bottom Player Row */}
      <div className="player-row">
        <span className={`player-name ${bottomActive ? 'active' : ''}`}>
          {bottomColor === 'w' ? 'White' : 'Black'}
          {isPlaying && (
            <button
              onClick={handleResign}
              className="resign-btn"
              title="Resign game"
              aria-label="Resign game"
            >
              Resign
            </button>
          )}
        </span>
        <Clock time={bottomTime} active={bottomActive} />
      </div>

      {/* Primary Action Controls */}
      <div className="controls-zone">
        {isIdle && (
          <SetupControls
            selectedTC={selectedTC}
            onSelectTC={handleSelectTC}
            onCreateRoom={handleCreateRoom}
          />
        )}

        {isWaiting && <WaitingBar roomId={room.roomId} />}

        {!isIdle && !isWaiting && !isEnded && (
          <ConnectionBar
            status={transportStatus}
            stats={transportStats}
            onRetry={handleRetryConnection}
            onNewGame={handleNewRoom}
          />
        )}

        {isEnded && room.result && (
          <GameEndBar
            result={room.result}
            onRematch={handleRematch}
            onNewRoom={handleNewRoom}
            pgn={engine.getPgn()}
          />
        )}
      </div>
    </div>
  );
}
