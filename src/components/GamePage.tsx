'use client';

import React, { useState, useCallback, useRef, useEffect, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { GameEngine } from '@/engine/GameEngine';
import {
  type GameTransport,
  type TransportStatus,
  type TransportStats,
} from '@/transport/GameTransport';
import { P2PGameTransport } from '@/transport/GameTransport';
import type { TimeControl, MoveIntent, RoomStatus, GameResult } from '@/types/chess';
import type { Color, Square } from '@/types/chess';
import { TIME_CONTROLS } from '@/types/chess';
import type { GameMessagePayload } from '@/types/protocol';
import { createGameRecord, saveGameRecord } from '@/lib/gameStats';
import { normalizeCountryCode } from '@/lib/countries';
import { useCountry } from '@/lib/useCountry';
import {
  LichessBoardClient,
  splitUciMoves,
  type LichessAccount,
  type LichessGameStart,
  type LichessGameState,
  type LichessStreamMessage,
} from '@/lib/lichess';
import { CountrySelect } from '@/components/CountrySelect';
import { CountryFlag } from '@/components/CountryFlag';
import { Chessboard } from '@/components/Chessboard';
import { Clock } from '@/components/Clock';
import {
  SetupControls,
  WaitingBar,
  LichessWaitingBar,
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

const LICHESS_TIME_CONTROL = TIME_CONTROLS.find((tc) => tc.label === '10+0')!;

function lichessResult(state: LichessGameState): GameResult | null {
  if (state.status === 'started') return null;

  const winner: Color | undefined = state.winner === 'white'
    ? 'w'
    : state.winner === 'black'
      ? 'b'
      : undefined;

  if (state.status === 'mate' && winner) return { type: 'checkmate', winner };
  if (state.status === 'stalemate') return { type: 'stalemate' };
  if (state.status === 'resign' && winner) return { type: 'resignation', winner };
  if ((state.status === 'timeout' || state.status === 'outoftime') && winner) {
    return { type: 'timeout', winner };
  }
  return { type: 'draw', reason: 'agreement' };
}

function PlayerIdentity({
  country,
  color,
  name,
  isLocal = false,
  active = false,
}: {
  country: string | null;
  color: Color;
  name?: string | null;
  isLocal?: boolean;
  active?: boolean;
}) {
  return (
    <span className={`player-name ${active ? 'active' : ''}`}>
      <span className="player-flag" aria-label={country ? `Country ${country}` : 'Country unknown'}>
        <CountryFlag code={country} />
      </span>
      <span className="player-identity-copy">
        <strong>{name || country || '—'}</strong>
        <small>{color === 'w' ? 'White' : 'Black'} / {isLocal ? 'You' : 'Opponent'}</small>
      </span>
    </span>
  );
}

export default function GamePage({ roomId: initialRoomId, isJoining }: GamePageProps) {
  const [engine] = useState(() => new GameEngine());
  const transportRef = useRef<GameTransport | null>(null);

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
  const [opponentCountry, setOpponentCountry] = useState<string | null>(null);
  const [opponentName, setOpponentName] = useState<string | null>(null);
  const [gameMode, setGameMode] = useState<'p2p' | 'lichess'>('p2p');
  const [lichessStatus, setLichessStatus] = useState<
    'checking' | 'idle' | 'authorizing' | 'searching' | 'connecting' | 'playing' | 'error'
  >('checking');
  const [lichessUser, setLichessUser] = useState<string | null>(null);
  const [lichessError, setLichessError] = useState<string | null>(null);
  const { country, setCountry, ready: countryReady } = useCountry();
  const lichessClientRef = useRef<LichessBoardClient | null>(null);
  const lichessInitRef = useRef<Promise<{
    account: LichessAccount | null;
    returnedFromAuth: boolean;
  }> | null>(null);
  const lichessAccountRef = useRef<LichessAccount | null>(null);
  const lichessGameIdRef = useRef('');
  const lichessColorRef = useRef<Color>('w');
  const latestLichessStateRef = useRef<LichessGameState | null>(null);
  const zenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoJoinInitiatedRef = useRef(false);
  const teardownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameStartedAtRef = useRef(0);
  const turnStartedAtRef = useRef(0);
  const thinkTimesRef = useRef<number[]>([]);
  const previousRoomStatusRef = useRef<RoomStatus>('idle');

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
              setOpponentCountry(normalizeCountryCode(payload.country));
              const hostColor: Color = Math.random() > 0.5 ? 'w' : 'b';
              const guestColor: Color = hostColor === 'w' ? 'b' : 'w';

              transport.send({
                type: 'ready',
                color: guestColor,
                country,
              });

              engine.startGame(hostColor);
              playPeerJoinedSound();
              setTimeout(() => playGameStartSound(), 280);
            }
            break;
          }

          case 'ready': {
            // Guest receives allocated color from Host
            const readyPayload = payload as { type: 'ready'; color: Color; country?: string };
            setOpponentCountry(normalizeCountryCode(readyPayload.country));
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
            turnStartedAtRef.current = Date.now();

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
              thinkTimesRef.current.push(0);
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
            if (engine.getState().room.status === 'ended') {
              engine.resetForRematch();
              playGameStartSound();
            }
            break;
          }

          case 'country-update': {
            setOpponentCountry(normalizeCountryCode(payload.country));
            break;
          }

          case 'rematch-response': {
            const rematchPayload = payload as { type: 'rematch-response'; accepted: boolean };
            if (rematchPayload.accepted && engine.getState().room.status === 'ended') {
              engine.resetForRematch();
              playGameStartSound();
            }
            break;
          }

          case 'resign': {
            engine.opponentResigned();
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
    [country, engine]
  );

  const syncLichessBoard = useCallback((remoteState: LichessGameState) => {
    return engine.syncExternalGame({
      roomId: lichessGameIdRef.current,
      moves: splitUciMoves(remoteState.moves),
      playerColor: lichessColorRef.current,
      timeControl: LICHESS_TIME_CONTROL,
      whiteTime: remoteState.wtime / 1000,
      blackTime: remoteState.btime / 1000,
      status: remoteState.status === 'started' ? 'playing' : 'ended',
      result: lichessResult(remoteState),
    });
  }, [engine]);

  const failLichess = useCallback((error: Error) => {
    if (error.name === 'AbortError') return;
    setLichessError(error.message || 'Lichess connection failed.');
    setLichessStatus('error');
  }, []);

  const handleLichessState = useCallback((remoteState: LichessGameState) => {
    const previous = latestLichessStateRef.current;
    const previousMoves = previous ? splitUciMoves(previous.moves) : [];
    const moves = splitUciMoves(remoteState.moves);
    latestLichessStateRef.current = remoteState;

    const executedPremove = syncLichessBoard(remoteState);
    const isPlayingRemote = remoteState.status === 'started';
    setLichessStatus(isPlayingRemote ? 'playing' : 'idle');
    setLichessError(null);

    if (!previous && isPlayingRemote) playGameStartSound();

    if (moves.length > previousMoves.length) {
      const mover: Color = moves.length % 2 === 1 ? 'w' : 'b';
      if (mover !== lichessColorRef.current) {
        const last = moves[moves.length - 1];
        if (engine.getState().board.isCheck) playCheckSound();
        else playMoveSound(last.slice(2, 4) as Square);
      }
    }

    if (executedPremove && lichessClientRef.current && lichessGameIdRef.current) {
      const uci = `${executedPremove.from}${executedPremove.to}${executedPremove.promotion || ''}`;
      void lichessClientRef.current.move(lichessGameIdRef.current, uci).catch((error: unknown) => {
        syncLichessBoard(remoteState);
        failLichess(error instanceof Error ? error : new Error('Lichess rejected the premove.'));
      });
      playMoveSound(executedPremove.to);
    }

    if (previous?.status === 'started' && !isPlayingRemote) {
      playGameEndSound();
    }
  }, [engine, failLichess, syncLichessBoard]);

  const handleLichessStream = useCallback((message: LichessStreamMessage) => {
    if (message.type === 'gameFull') {
      if (message.initialFen !== 'startpos') {
        failLichess(new Error('VEYRN supports standard Lichess games only.'));
        return;
      }

      const opponent = lichessColorRef.current === 'w' ? message.black : message.white;
      const name = opponent.name || opponent.id || 'Lichess player';
      setOpponentName(name);
      void lichessClientRef.current?.countryOf(name).then((code) => {
        setOpponentCountry(normalizeCountryCode(code));
      });
      handleLichessState(message.state);
      return;
    }

    handleLichessState(message);
  }, [failLichess, handleLichessState]);

  const handleLichessGameStart = useCallback((event: LichessGameStart) => {
    const color: Color = event.game.color === 'white' ? 'w' : 'b';
    lichessGameIdRef.current = event.game.id;
    lichessColorRef.current = color;
    latestLichessStateRef.current = null;
    setActiveRoomId(event.game.id);
    setOpponentName(event.game.opponent.username || event.game.opponent.id || 'Lichess player');
    setLichessStatus('connecting');

    void lichessClientRef.current
      ?.openGame(event.game.id, handleLichessStream, failLichess)
      .catch((error: unknown) => {
        failLichess(error instanceof Error ? error : new Error('Could not open the Lichess game.'));
      });
  }, [failLichess, handleLichessStream]);

  const beginLichessSeek = useCallback(async () => {
    const client = lichessClientRef.current;
    if (!client || !lichessAccountRef.current) {
      failLichess(new Error('Lichess login is required.'));
      return;
    }

    initAudioOnGesture();
    transportRef.current?.disconnect();
    transportRef.current = null;
    setTransportStatus('idle');
    setTransportStats(null);
    setGameMode('lichess');
    setSelectedTC(LICHESS_TIME_CONTROL);
    setOpponentCountry(null);
    setOpponentName(null);
    setLichessError(null);
    setLichessStatus('searching');
    lichessGameIdRef.current = '';
    latestLichessStateRef.current = null;
    engine.setTimeControl(LICHESS_TIME_CONTROL);
    engine.createRoom('lichess');

    try {
      await client.startRapidSeek(handleLichessGameStart, failLichess);
    } catch (error) {
      failLichess(error instanceof Error ? error : new Error('Could not start Lichess search.'));
    }
  }, [engine, failLichess, handleLichessGameStart]);

  useEffect(() => {
    if (!lichessClientRef.current) {
      lichessClientRef.current = new LichessBoardClient(`${window.location.origin}/play`);
      lichessInitRef.current = lichessClientRef.current.initialize();
    }

    let active = true;
    void lichessInitRef.current
      ?.then(({ account }) => {
        if (!active) return;
        lichessAccountRef.current = account;
        setLichessUser(account?.username || null);
        setLichessStatus('idle');

        if (account && sessionStorage.getItem('veyrn:lichess-seek') === '1') {
          sessionStorage.removeItem('veyrn:lichess-seek');
          void beginLichessSeek();
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        sessionStorage.removeItem('veyrn:lichess-seek');
        failLichess(error instanceof Error ? error : new Error('Lichess login failed.'));
      });

    return () => {
      active = false;
    };
  }, [beginLichessSeek, failLichess]);

  const handlePlayLichess = useCallback(() => {
    const client = lichessClientRef.current;
    if (!client || lichessStatus === 'checking' || lichessStatus === 'authorizing') return;

    if (!lichessAccountRef.current) {
      sessionStorage.setItem('veyrn:lichess-seek', '1');
      setLichessStatus('authorizing');
      void client.authorize().catch((error: unknown) => {
        sessionStorage.removeItem('veyrn:lichess-seek');
        failLichess(error instanceof Error ? error : new Error('Lichess login failed.'));
      });
      return;
    }

    void beginLichessSeek();
  }, [beginLichessSeek, failLichess, lichessStatus]);

  const handleCreateRoom = useCallback(() => {
    initAudioOnGesture();
    lichessClientRef.current?.close();
    setGameMode('p2p');
    setLichessStatus('idle');
    setLichessError(null);
    setOpponentName(null);
    const roomId = generateRoomId();
    setActiveRoomId(roomId);
    setIsHostRole(true);

    engine.setTimeControl(selectedTC);
    engine.createRoom(roomId);

    const transport = setupTransport(roomId, true);
    transport.connect(roomId, true).catch((err) => {
      console.warn('Host connection notice:', err);
    });

  }, [engine, selectedTC, setupTransport]);

  const handleJoinRoom = useCallback(
    (roomId: string) => {
      initAudioOnGesture();
      lichessClientRef.current?.close();
      setGameMode('p2p');
      setLichessStatus('idle');
      setLichessError(null);
      setOpponentName(null);
      setActiveRoomId(roomId);
      setIsHostRole(false);

      engine.setTimeControl(selectedTC);
      engine.joinRoom(roomId, 'b');

      const transport = setupTransport(roomId, false);
      transport
        .connect(roomId, false)
        .then(() => {
          transport.send({ type: 'hello', country });
        })
        .catch((err) => {
          console.warn('Guest connection notice:', err);
        });
    },
    [country, engine, selectedTC, setupTransport]
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
    if (isJoining && initialRoomId && countryReady && !autoJoinInitiatedRef.current) {
      const timer = setTimeout(() => {
        autoJoinInitiatedRef.current = true;
        handleJoinRoom(initialRoomId);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [countryReady, isJoining, initialRoomId, handleJoinRoom]);

  useEffect(() => {
    if (transportStatus === 'connected' && transportRef.current?.isConnected()) {
      transportRef.current.send({ type: 'country-update', country });
    }
  }, [country, transportStatus]);

  const handleMove = useCallback((intent: MoveIntent): boolean => {
    const beforeState = engine.getState().board;
    const toIdx =
      intent.to.charCodeAt(0) - 97 + (8 - parseInt(intent.to[1], 10)) * 8;
    const isCapture = beforeState.pieces[toIdx] !== null;

    const success = engine.tryMove(intent);
    if (success) {
      thinkTimesRef.current.push(
        turnStartedAtRef.current ? Math.max(0, Date.now() - turnStartedAtRef.current) : 0
      );
      turnStartedAtRef.current = Date.now();
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

      if (gameMode === 'lichess' && lichessGameIdRef.current && lichessClientRef.current) {
        const uci = `${intent.from}${intent.to}${intent.promotion || ''}`;
        void lichessClientRef.current.move(lichessGameIdRef.current, uci).catch((error: unknown) => {
          if (latestLichessStateRef.current) syncLichessBoard(latestLichessStateRef.current);
          failLichess(error instanceof Error ? error : new Error('Lichess rejected the move.'));
        });
      } else if (transportRef.current && transportRef.current.isConnected()) {
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
  }, [engine, failLichess, gameMode, syncLichessBoard]);

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
    if (gameMode === 'lichess') {
      void beginLichessSeek();
      return;
    }
    if (transportRef.current) {
      transportRef.current.send({ type: 'rematch-offer' });
    }
  }, [beginLichessSeek, gameMode]);

  const handleResign = useCallback(() => {
    if (gameMode === 'lichess') {
      const client = lichessClientRef.current;
      const gameId = lichessGameIdRef.current;
      if (client && gameId) {
        void client.resign(gameId).catch((error: unknown) => {
          failLichess(error instanceof Error ? error : new Error('Lichess resignation failed.'));
        });
      }
      return;
    }
    if (transportRef.current) {
      transportRef.current.send({ type: 'resign' });
    }
    engine.resign();
    playGameEndSound();
  }, [engine, failLichess, gameMode]);

  const handleNewRoom = useCallback(() => {
    if (transportRef.current) {
      transportRef.current.disconnect();
      transportRef.current = null;
    }
    lichessClientRef.current?.close();
    lichessGameIdRef.current = '';
    latestLichessStateRef.current = null;
    setTransportStatus('idle');
    setTransportStats(null);
    setGameMode('p2p');
    setLichessStatus('idle');
    setLichessError(null);
    setActiveRoomId('');
    setOpponentCountry(null);
    setOpponentName(null);
    window.history.pushState({}, '', '/play');
    engine.resetToIdle();
  }, [engine]);

  const handleRetryLichess = useCallback(() => {
    const client = lichessClientRef.current;
    const gameId = lichessGameIdRef.current;
    if (client && gameId && engine.getState().room.status === 'playing') {
      setLichessError(null);
      setLichessStatus('connecting');
      void client.openGame(gameId, handleLichessStream, failLichess).catch((error: unknown) => {
        failLichess(error instanceof Error ? error : new Error('Could not reconnect to Lichess.'));
      });
      return;
    }
    void beginLichessSeek();
  }, [beginLichessSeek, engine, failLichess, handleLichessStream]);

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

      const verticalReserved = state.room.status === 'idle'
        ? (vw <= 600 ? 290 : 270)
        : 170;
      const maxFromHeight = Math.floor(vh - verticalReserved);
      const maxFromWidth = vw - 32;

      const size = Math.min(maxFromHeight, maxFromWidth);
      const clamped = Math.max(280, Math.min(size, 860));

      document.documentElement.style.setProperty('--board-size', `${clamped}px`);
    };

    computeBoardSize();
    window.addEventListener('resize', computeBoardSize);
    return () => window.removeEventListener('resize', computeBoardSize);
  }, [state.room.status]);

  // Teardown
  useEffect(() => {
    if (teardownTimerRef.current) {
      clearTimeout(teardownTimerRef.current);
      teardownTimerRef.current = null;
    }
    return () => {
      transportRef.current?.disconnect();
      teardownTimerRef.current = setTimeout(() => {
        lichessClientRef.current?.close();
        engine.destroy();
      }, 0);
    };
  }, [engine]);

  const { board, room, premove } = state;
  const isPlaying = room.status === 'playing';
  const isEnded = room.status === 'ended';
  const isWaiting = gameMode === 'p2p' && room.status === 'waiting' && transportStatus === 'waiting';
  const isIdle = room.status === 'idle';
  const showLichessStatus = gameMode === 'lichess' && !isEnded && (
    lichessStatus === 'searching' ||
    lichessStatus === 'connecting' ||
    lichessStatus === 'error'
  );

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

  useEffect(() => {
    const previous = previousRoomStatusRef.current;

    if (room.status === 'playing' && previous !== 'playing') {
      gameStartedAtRef.current = Date.now();
      turnStartedAtRef.current = Date.now();
      thinkTimesRef.current = [];
    }

    if (room.status === 'ended' && previous !== 'ended' && room.result) {
      const player = room.playerColor || 'w';
      saveGameRecord(
        createGameRecord({
          pgn: engine.getPgn(),
          playerColor: player,
          result: room.result,
          timeControl: room.timeControl,
          durationMs: Math.max(
            1000,
            gameStartedAtRef.current ? Date.now() - gameStartedAtRef.current : 1000
          ),
          thinkTimesMs: thinkTimesRef.current,
          networkLatencyMs: transportStats?.roundTripTime
            ? transportStats.roundTripTime * 1000
            : undefined,
          relay: transportStats?.isRelay,
          whiteTime: room.whiteTime,
          blackTime: room.blackTime,
          country,
          opponentCountry: opponentCountry || undefined,
        })
      );
    }

    previousRoomStatusRef.current = room.status;
  }, [country, engine, opponentCountry, room, transportStats]);

  return (
    <div className={`app ${isZen && isPlaying ? 'zen-mode' : ''}`}>
      <nav className="instrument-nav" aria-label="Platform navigation">
        <Link href="/" aria-label="VEYRN home">V</Link>
        <Link href="/stats">STAT</Link>
        <span>{gameMode === 'lichess' ? 'LIVE / LICHESS' : 'LIVE / P2P'}</span>
        <CountrySelect value={country} onChange={setCountry} compact />
      </nav>
      {/* Top Player Row */}
      <div className="player-row">
        <PlayerIdentity
          country={opponentCountry}
          color={topColor}
          name={opponentName}
          active={topActive}
        />
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
        <div className="player-local-actions">
          <PlayerIdentity
            country={country}
            color={bottomColor}
            name={gameMode === 'lichess' ? lichessUser : null}
            isLocal
            active={bottomActive}
          />
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
        </div>
        <Clock time={bottomTime} active={bottomActive} />
      </div>

      {/* Primary Action Controls */}
      <div className="controls-zone">
        {isIdle && (
          <SetupControls
            selectedTC={selectedTC}
            onSelectTC={handleSelectTC}
            onCreateRoom={handleCreateRoom}
            onPlayLichess={handlePlayLichess}
            lichessStatus={lichessStatus === 'connecting' ? 'searching' : lichessStatus}
            lichessUser={lichessUser}
          />
        )}

        {isWaiting && <WaitingBar roomId={room.roomId} />}

        {showLichessStatus && (
          <LichessWaitingBar
            status={lichessStatus === 'error' ? 'error' : lichessStatus}
            error={lichessError}
            onCancel={handleNewRoom}
            onRetry={handleRetryLichess}
          />
        )}

        {gameMode === 'p2p' && !isIdle && !isWaiting && !isEnded && (
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
            rematchLabel={gameMode === 'lichess' ? 'FIND NEXT' : 'REMATCH'}
            newRoomLabel={gameMode === 'lichess' ? 'PRIVATE ROOM' : 'NEW ROOM'}
          />
        )}
      </div>
    </div>
  );
}
