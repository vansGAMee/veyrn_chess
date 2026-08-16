'use client';

import React, { useState, useCallback, useRef, useEffect, useSyncExternalStore } from 'react';
import { GameEngine } from '@/engine/GameEngine';
import { P2PGameTransport } from '@/transport/GameTransport';
import type { TimeControl, MoveIntent, GameResult } from '@/types/chess';
import type { Color, Square } from '@/types/chess';
import { TIME_CONTROLS } from '@/types/chess';
import type { GameMessagePayload } from '@/types/protocol';
import { Chessboard } from '@/components/Chessboard';
import { Clock } from '@/components/Clock';
import { SetupControls, WaitingBar, GameEndBar } from '@/components/GameControls';
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
  const engineRef = useRef<GameEngine | null>(null);
  const transportRef = useRef<P2PGameTransport | null>(null);

  if (!engineRef.current) {
    engineRef.current = new GameEngine();
  }

  const engine = engineRef.current;

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
  const [connectionStatus, setConnectionStatus] = useState<
    'disconnected' | 'connecting' | 'connected'
  >('disconnected');
  const [isZen, setIsZen] = useState(false);
  const zenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

      transport.subscribe((payload: GameMessagePayload) => {
        const eng = engineRef.current;
        if (!eng) return;

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

              eng.startGame(hostColor);
              setConnectionStatus('connected');
              playPeerJoinedSound();
              setTimeout(() => playGameStartSound(), 280);
            }
            break;
          }

          case 'ready': {
            // Guest receives allocated color from Host
            const readyPayload = payload as { type: 'ready'; color: Color };
            eng.startGame(readyPayload.color);
            setConnectionStatus('connected');
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
            const beforeState = eng.getState().board;
            const toIdx =
              movePayload.to.charCodeAt(0) -
              97 +
              (8 - parseInt(movePayload.to[1], 10)) * 8;
            const wasCapture = beforeState.pieces[toIdx] !== null;

            // Apply remote move & check if local queued premove executes
            const executedPremove = eng.applyRemoteMove(
              movePayload.from,
              movePayload.to,
              movePayload.promotion,
              movePayload.clock
            );

            const afterState = eng.getState().board;
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
              const times = eng.getCurrentTime();
              const myColor = eng.getPlayerColor();
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
            eng.resetForRematch();
            playGameStartSound();
            break;
          }

          case 'rematch-response': {
            const rematchPayload = payload as { type: 'rematch-response'; accepted: boolean };
            if (rematchPayload.accepted) {
              eng.resetForRematch();
              playGameStartSound();
            }
            break;
          }

          case 'resign': {
            eng.resign();
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
    []
  );

  const handleCreateRoom = useCallback(() => {
    initAudioOnGesture();
    const roomId = generateRoomId();
    engine.setTimeControl(selectedTC);
    engine.createRoom(roomId);

    const transport = setupTransport(roomId, true);
    setConnectionStatus('connecting');

    transport.connect(roomId, true).catch((err) => {
      console.warn('Host connection notice:', err);
    });

    window.history.pushState({}, '', `/room/${roomId}`);
  }, [engine, selectedTC, setupTransport]);

  const handleJoinRoom = useCallback(
    (roomId: string) => {
      initAudioOnGesture();
      engine.setTimeControl(selectedTC);
      engine.joinRoom(roomId, 'b');

      const transport = setupTransport(roomId, false);
      setConnectionStatus('connecting');

      transport
        .connect(roomId, false)
        .then(() => {
          setConnectionStatus('connected');
          transport.send({ type: 'hello' });
        })
        .catch((err) => {
          console.warn('Guest connection notice:', err);
        });
    },
    [engine, selectedTC, setupTransport]
  );

  // Auto-join from URL parameter
  useEffect(() => {
    if (isJoining && initialRoomId && connectionStatus === 'disconnected') {
      handleJoinRoom(initialRoomId);
    }
  }, [isJoining, initialRoomId, connectionStatus, handleJoinRoom]);

  const handleMove = useCallback((intent: MoveIntent): boolean => {
    const eng = engineRef.current;
    if (!eng) return false;

    const beforeState = eng.getState().board;
    const toIdx =
      intent.to.charCodeAt(0) - 97 + (8 - parseInt(intent.to[1], 10)) * 8;
    const isCapture = beforeState.pieces[toIdx] !== null;

    const success = eng.tryMove(intent);
    if (success) {
      const newState = eng.getState();
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
        const times = eng.getCurrentTime();
        const myColor = eng.getPlayerColor();
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
  }, []);

  const handleSelect = useCallback(
    (square: Square | null) => {
      const eng = engineRef.current;
      if (!eng) return;

      if (square === null) {
        eng.clearSelection();
        return;
      }

      const moveIntent = eng.selectSquare(square);
      if (moveIntent) {
        handleMove(moveIntent);
      }
    },
    [handleMove]
  );

  const handlePremove = useCallback((intent: MoveIntent | null) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.setPremove(intent);
  }, []);

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
    setConnectionStatus('disconnected');
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

      // Available vertical space for optimal instrument proportion (74-88% vh)
      const verticalReserved = 160;
      const maxFromHeight = Math.floor((vh - verticalReserved) * 0.94);
      const maxFromWidth = Math.min(vw - 32, 680);

      const size = Math.min(maxFromHeight, maxFromWidth);
      const clamped = Math.max(280, Math.min(size, 680));

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
      engineRef.current?.destroy();
    };
  }, []);

  const { board, room, premove } = state;
  const isPlaying = room.status === 'playing';
  const isEnded = room.status === 'ended';
  const isWaiting = room.status === 'waiting';
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

        {connectionStatus === 'connecting' && !isWaiting && (
          <div className="waiting-bar">
            <span className="waiting-text">Connecting to opponent…</span>
          </div>
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
