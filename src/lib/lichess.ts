import { OAuth2AuthCodePKCE } from '@bity/oauth2-auth-code-pkce';

const LICHESS_ORIGIN = 'https://lichess.org';

export interface LichessAccount {
  id: string;
  username: string;
}

export interface LichessPlayer {
  id?: string;
  name?: string;
  rating?: number;
}

export interface LichessGameState {
  type: 'gameState';
  moves: string;
  wtime: number;
  btime: number;
  winc: number;
  binc: number;
  status: string;
  winner?: 'white' | 'black';
}

export interface LichessGameFull {
  type: 'gameFull';
  id: string;
  initialFen: string;
  white: LichessPlayer;
  black: LichessPlayer;
  state: LichessGameState;
}

export interface LichessGameStart {
  type: 'gameStart';
  game: {
    id: string;
    color: 'white' | 'black';
    opponent: {
      id?: string;
      username?: string;
      rating?: number;
    };
  };
}

export type LichessStreamMessage = LichessGameFull | LichessGameState;

interface LichessProfile {
  profile?: { country?: string };
}

type MessageHandler<T> = (message: T) => void;

export function splitUciMoves(moves: string): string[] {
  return moves.trim().split(/\s+/).filter((move) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move));
}

export class LichessBoardClient {
  private readonly oauth: OAuth2AuthCodePKCE;
  private readonly authorizedFetch: typeof fetch;
  private eventController: AbortController | null = null;
  private seekController: AbortController | null = null;
  private gameController: AbortController | null = null;
  private searchGeneration = 0;

  constructor(redirectUrl: string) {
    this.oauth = new OAuth2AuthCodePKCE({
      authorizationUrl: `${LICHESS_ORIGIN}/oauth`,
      tokenUrl: `${LICHESS_ORIGIN}/api/token`,
      clientId: 'veyrn-chess',
      redirectUrl,
      scopes: ['board:play'],
      onAccessTokenExpiry: (refresh) => refresh(),
      onInvalidGrant: () => this.oauth.reset(),
    });
    this.authorizedFetch = this.oauth.decorateFetchHTTPClient(
      (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)
    ) as typeof fetch;
  }

  async initialize(): Promise<{ account: LichessAccount | null; returnedFromAuth: boolean }> {
    const returnedFromAuth = await this.oauth.isReturningFromAuthServer();
    if (!returnedFromAuth && !this.oauth.isAuthorized()) {
      return { account: null, returnedFromAuth };
    }

    await this.oauth.getAccessToken();
    const account = await this.fetchJson<LichessAccount>('/api/account');
    if (returnedFromAuth) this.removeOAuthParams();
    return { account, returnedFromAuth };
  }

  authorize(): Promise<void> {
    return this.oauth.fetchAuthorizationCode();
  }

  async startRapidSeek(
    onGameStart: MessageHandler<LichessGameStart>,
    onError: (error: Error) => void
  ): Promise<void> {
    this.cancelSearch();
    const generation = this.searchGeneration;
    const eventController = await this.openStream<LichessGameStart>(
      '/api/stream/event',
      {},
      (message) => {
        if (message.type === 'gameStart') onGameStart(message);
      },
      onError
    );
    if (generation !== this.searchGeneration) {
      eventController.abort();
      return;
    }
    this.eventController = eventController;

    const body = new URLSearchParams({ rated: 'false', time: '10', increment: '0' });
    const seekController = await this.openStream<Record<string, never>>(
      '/api/board/seek',
      { method: 'POST', body },
      () => undefined,
      onError
    );
    if (generation !== this.searchGeneration) {
      seekController.abort();
      return;
    }
    this.seekController = seekController;
  }

  async openGame(
    gameId: string,
    onMessage: MessageHandler<LichessStreamMessage>,
    onError: (error: Error) => void
  ): Promise<void> {
    this.cancelSearch();
    this.gameController?.abort();
    this.gameController = await this.openStream<LichessStreamMessage>(
      `/api/board/game/stream/${gameId}`,
      {},
      onMessage,
      onError
    );
  }

  async move(gameId: string, uci: string): Promise<void> {
    await this.request(`/api/board/game/${gameId}/move/${uci}`, { method: 'POST' });
  }

  async resign(gameId: string): Promise<void> {
    await this.request(`/api/board/game/${gameId}/resign`, { method: 'POST' });
  }

  async countryOf(username: string): Promise<string | null> {
    try {
      const user = await this.fetchJson<LichessProfile>(`/api/user/${encodeURIComponent(username)}`);
      return user.profile?.country || null;
    } catch {
      return null;
    }
  }

  cancelSearch(): void {
    this.searchGeneration += 1;
    this.eventController?.abort();
    this.seekController?.abort();
    this.eventController = null;
    this.seekController = null;
  }

  close(): void {
    this.cancelSearch();
    this.gameController?.abort();
    this.gameController = null;
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const response = await this.request(path);
    return response.json() as Promise<T>;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.authorizedFetch(`${LICHESS_ORIGIN}${path}`, init);
    if (response.ok) return response;

    const detail = (await response.text()).trim();
    if (response.status === 429) {
      throw new Error('Lichess rate limit reached. Try again in one minute.');
    }
    throw new Error(detail || `Lichess request failed (${response.status}).`);
  }

  private async openStream<T>(
    path: string,
    init: RequestInit,
    onMessage: MessageHandler<T>,
    onError: (error: Error) => void
  ): Promise<AbortController> {
    const controller = new AbortController();
    const response = await this.request(path, { ...init, signal: controller.signal });

    void this.consumeNdjson(response, onMessage, controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        onError(error instanceof Error ? error : new Error('Lichess stream closed.'));
      }
    });
    return controller;
  }

  private async consumeNdjson<T>(
    response: Response,
    onMessage: MessageHandler<T>,
    signal: AbortSignal
  ): Promise<void> {
    if (!response.body) throw new Error('Lichess returned an empty stream.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) onMessage(JSON.parse(trimmed) as T);
      }
    }

    const tail = buffer.trim();
    if (tail && !signal.aborted) onMessage(JSON.parse(tail) as T);
  }

  private removeOAuthParams(): void {
    const url = new URL(window.location.href);
    url.searchParams.delete('code');
    url.searchParams.delete('state');
    url.searchParams.delete('error');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }
}
