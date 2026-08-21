import type { GameMessagePayload } from '@/types/protocol';
import { createEnvelope, validateEnvelope } from '@/types/protocol';

export type TransportStatus =
  | 'idle'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'timeout'
  | 'peer-disconnected';

export interface TransportStats {
  localCandidateType?: string;
  remoteCandidateType?: string;
  protocol?: string;
  isRelay: boolean;
  roundTripTime?: number;
}

export interface GameTransport {
  connect(roomId: string, isHost: boolean): Promise<void>;
  send(payload: GameMessagePayload): void;
  subscribe(handler: (payload: GameMessagePayload) => void): () => void;
  onStatus(handler: (status: TransportStatus, stats?: TransportStats) => void): () => void;
  disconnect(): void;
  isConnected(): boolean;
  getStatus(): TransportStatus;
  getStats(): TransportStats | null;
}

export function buildIceServers(): RTCIceServer[] {
  const iceServers: RTCIceServer[] = [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
      ],
    },
  ];

  const username = process.env.NEXT_PUBLIC_TURN_USERNAME || '';
  const credential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL || '';

  const turnUrlsRaw =
    process.env.NEXT_PUBLIC_TURN_URLS ||
    process.env.NEXT_PUBLIC_TURN_URL ||
    '';

  if (turnUrlsRaw.trim()) {
    const urls = turnUrlsRaw
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);

    if (urls.length > 0) {
      if (username || credential) {
        iceServers.push({
          urls,
          username,
          credential,
        });
      } else {
        iceServers.push({ urls });
      }
    }
  } else if (typeof window !== 'undefined') {
    if (process.env.NODE_ENV === 'development') {
      console.warn(
        '[VEYRN WebRTC] ⚠️ TURN is not configured. Connections behind restrictive NAT/VPN may fail.\n' +
          'Configure NEXT_PUBLIC_TURN_URLS, NEXT_PUBLIC_TURN_USERNAME, and NEXT_PUBLIC_TURN_CREDENTIAL for relay fallback.'
      );
    }
  }

  return iceServers;
}

export async function extractConnectionStats(
  pc: RTCPeerConnection | null
): Promise<TransportStats> {
  const result: TransportStats = { isRelay: false };
  if (!pc) return result;

  try {
    const stats = await pc.getStats();
    let selectedPair: Record<string, unknown> | null = null;

    stats.forEach((report) => {
      const rep = report as Record<string, unknown>;
      if (
        rep.type === 'transport' &&
        rep.selectedCandidatePairId
      ) {
        selectedPair = stats.get(rep.selectedCandidatePairId as string) as Record<string, unknown> | undefined || null;
      } else if (
        rep.type === 'candidate-pair' &&
        (rep.selected || rep.nominated || rep.state === 'succeeded')
      ) {
        if (!selectedPair || rep.selected) {
          selectedPair = rep;
        }
      }
    });

    if (selectedPair) {
      const pair = selectedPair as Record<string, unknown>;
      const localCandidate = pair.localCandidateId
        ? (stats.get(pair.localCandidateId as string) as Record<string, unknown> | undefined)
        : undefined;
      const remoteCandidate = pair.remoteCandidateId
        ? (stats.get(pair.remoteCandidateId as string) as Record<string, unknown> | undefined)
        : undefined;

      if (localCandidate) {
        result.localCandidateType = localCandidate.candidateType as string | undefined;
        result.protocol = localCandidate.protocol as string | undefined;
      }
      if (remoteCandidate) {
        result.remoteCandidateType = remoteCandidate.candidateType as string | undefined;
      }
      if (pair.currentRoundTripTime !== undefined && typeof pair.currentRoundTripTime === 'number') {
        result.roundTripTime = Math.round(pair.currentRoundTripTime * 1000);
      }

      result.isRelay =
        result.localCandidateType === 'relay' ||
        result.remoteCandidateType === 'relay';
    }
  } catch {}

  return result;
}

export class P2PGameTransport implements GameTransport {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private sessionId: string = '';
  private clientId: string = '';
  private sequence: number = 0;
  private remoteSequence: number = -1;
  private handlers: Set<(payload: GameMessagePayload) => void> = new Set();
  private statusHandlers: Set<(status: TransportStatus, stats?: TransportStats) => void> =
    new Set();
  private status: TransportStatus = 'idle';
  private stats: TransportStats | null = null;
  private isHost: boolean = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private joinRetryInterval: ReturnType<typeof setInterval> | null = null;
  private isPolling: boolean = false;
  private statsInterval: ReturnType<typeof setInterval> | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private lastPollTimestamp: number = 0;
  private iceCandidatesQueue: RTCIceCandidateInit[] = [];
  private hasRemoteDescription: boolean = false;
  private seenMessageIds: Set<string> = new Set();
  private restartAttempts: number = 0;
  private isDestroyed: boolean = false;
  private disconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.clientId = `client-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  private setStatus(status: TransportStatus, stats?: TransportStats) {
    if (this.status === status && !stats) return;
    this.status = status;
    if (stats) this.stats = stats;
    this.statusHandlers.forEach((h) => h(status, this.stats || undefined));
  }

  getStatus(): TransportStatus {
    return this.status;
  }

  getStats(): TransportStats | null {
    return this.stats;
  }

  onStatus(
    handler: (status: TransportStatus, stats?: TransportStats) => void
  ): () => void {
    this.statusHandlers.add(handler);
    handler(this.status, this.stats || undefined);
    return () => this.statusHandlers.delete(handler);
  }

  async connect(roomId: string, isHost: boolean): Promise<void> {
    this.stopJoinRetry();
    this.isDestroyed = false;
    this.sessionId = roomId;
    this.isHost = isHost;
    this.sequence = 0;
    this.remoteSequence = -1;
    this.iceCandidatesQueue = [];
    this.hasRemoteDescription = false;
    this.seenMessageIds.clear();
    this.restartAttempts = 0;
    this.setStatus(isHost ? 'waiting' : 'connecting');

    const config: RTCConfiguration = {
      iceServers: buildIceServers(),
      iceTransportPolicy: 'all', // 'all' allows direct P2P or TURN relay seamlessly
      iceCandidatePoolSize: 10,
    };

    if (process.env.NODE_ENV === 'development') {
      console.log(
        `[VEYRN WebRTC] Initializing PeerConnection for room ${roomId} (isHost: ${isHost})`
      );
    }

    this.pc = new RTCPeerConnection(config);

    // Setup multi-tier signaling: BroadcastChannel (same-browser tabs) + API route (cross-device)
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        this.broadcastChannel = new BroadcastChannel(`veyrn-signal-${roomId}`);
        this.broadcastChannel.onmessage = (event) => {
          if (event.data && event.data.senderId !== this.clientId) {
            this.handleSignalingMessage(
              event.data.id || `${Date.now()}-bc`,
              event.data.type,
              event.data.data
            );
          }
        };
      }
    } catch {
      this.broadcastChannel = null;
    }

    // Start polling signaling API
    this.startSignalingPoll(roomId);

    return new Promise<void>((resolve, reject) => {
      const connectionTimeout = setTimeout(() => {
        if (!this.isConnected() && !this.isDestroyed) {
          if (isHost) {
            // Keep host in waiting state until opponent appears
            this.setStatus('waiting');
          } else {
            this.stopJoinRetry();
            this.setStatus('timeout');
            reject(new Error('Connection timeout waiting for host'));
          }
        }
      }, 45000);

      this.pc!.onicecandidate = (e) => {
        if (e.candidate) {
          if (process.env.NODE_ENV === 'development') {
            console.log(
              `[VEYRN WebRTC] ICE candidate discovered (${e.candidate.type || 'unknown'} ${e.candidate.protocol || ''})`
            );
          }
          this.sendSignalingMessage('ice-candidate', e.candidate.toJSON());
        }
      };

      this.pc!.oniceconnectionstatechange = () => {
        if (!this.pc) return;
        const iceState = this.pc.iceConnectionState;
        if (process.env.NODE_ENV === 'development') {
          console.log(`[VEYRN WebRTC] iceConnectionState: ${iceState}`);
        }
        if (iceState === 'failed') {
          this.handleConnectionFailure();
        }
      };

      this.pc!.onconnectionstatechange = async () => {
        if (!this.pc) return;
        const connState = this.pc.connectionState;
        if (process.env.NODE_ENV === 'development') {
          console.log(`[VEYRN WebRTC] connectionState: ${connState}`);
        }

        if (connState === 'connected') {
          if (this.disconnectTimeout) {
            clearTimeout(this.disconnectTimeout);
            this.disconnectTimeout = null;
          }
          this.setStatus('connected');
          await this.logConnectionStats();
        } else if (connState === 'disconnected') {
          // Transient disconnect: grant a 5s grace period before marking disconnected
          if (!this.disconnectTimeout) {
            this.disconnectTimeout = setTimeout(() => {
              if (this.pc?.connectionState === 'disconnected') {
                this.setStatus('disconnected');
              }
            }, 5000);
          }
        } else if (connState === 'failed') {
          this.handleConnectionFailure();
        } else if (connState === 'closed') {
          this.setStatus('disconnected');
        }
      };

      if (isHost) {
        // Host creates the DataChannel
        this.dc = this.pc!.createDataChannel('game', {
          ordered: true,
        });
        this.setupDataChannel(this.dc, resolve, connectionTimeout);
        this.createAndSendOffer();
      } else {
        // Guest waits for DataChannel from Host
        this.pc!.ondatachannel = (event) => {
          this.dc = event.channel;
          this.setupDataChannel(this.dc, resolve, connectionTimeout);
        };

        // Re-send until connected so one lost request cannot strand the room.
        this.startJoinRetry();
      }
    });
  }

  private async handleConnectionFailure() {
    if (this.isDestroyed) return;

    if (this.restartAttempts < 2 && this.pc) {
      this.restartAttempts++;
      if (process.env.NODE_ENV === 'development') {
        console.log(
          `[VEYRN WebRTC] Attempting ICE restart (attempt ${this.restartAttempts}/2)...`
        );
      }
      try {
        if (this.isHost) {
          const offer = await this.pc.createOffer({ iceRestart: true });
          await this.pc.setLocalDescription(offer);
          await this.sendSignalingMessage('offer', offer);
        } else {
          await this.sendSignalingMessage('join-request', { restart: true });
        }
        return;
      } catch (err) {
        console.warn('[VEYRN WebRTC] ICE restart error:', err);
      }
    }

    this.setStatus('failed');
  }

  private async logConnectionStats() {
    if (!this.pc) return;
    const stats = await extractConnectionStats(this.pc);
    this.stats = stats;
    this.setStatus('connected', stats);

    if (process.env.NODE_ENV === 'development') {
      const local = `${stats.localCandidateType || 'unknown'} (${stats.protocol || 'udp'})`;
      const remote = `${stats.remoteCandidateType || 'unknown'}`;
      const mode = stats.isRelay ? 'TURN RELAY (VPN/NAT Friendly)' : 'P2P DIRECT';
      console.log(
        `[VEYRN WebRTC] 🚀 Connected | Mode: ${mode} | Local: ${local} <-> Remote: ${remote}`
      );
    }
  }

  private async createAndSendOffer() {
    if (!this.pc || this.isDestroyed) return;
    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      if (process.env.NODE_ENV === 'development') {
        console.log('[VEYRN WebRTC] Signaling offer created and dispatched');
      }
      await this.sendSignalingMessage('offer', offer);
    } catch (err) {
      console.warn('[VEYRN WebRTC] Error creating offer:', err);
    }
  }

  private async sendSignalingMessage(type: string, data: unknown) {
    if (this.isDestroyed) return;

    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const payload = {
      id,
      senderId: this.clientId,
      type,
      data,
      timestamp: Date.now(),
    };

    this.seenMessageIds.add(id);

    // 1. Send via BroadcastChannel for zero-latency local same-browser delivery
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(payload);
      } catch {}
    }

    // 2. Send via HTTP API for serverless cross-browser / cross-machine delivery
    try {
      await fetch(`/api/signal/${this.sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {}
  }

  private startSignalingPoll(roomId: string) {
    this.stopSignalingPoll();
    this.lastPollTimestamp = Date.now() - 60000;

    const poll = async () => {
      if (this.isDestroyed || this.isPolling) return;
      if (this.isConnected()) {
        // Slow down polling significantly once DataChannel is alive
        return;
      }

      this.isPolling = true;
      try {
        const since = Math.max(0, this.lastPollTimestamp - 5000);
        const res = await fetch(
          `/api/signal/${roomId}?senderId=${encodeURIComponent(this.clientId)}&since=${since}`
        );
        if (!res.ok) return;

        const data = await res.json();
        if (data.messages && Array.isArray(data.messages)) {
          for (const msg of data.messages) {
            this.lastPollTimestamp = Math.max(this.lastPollTimestamp, msg.timestamp);
            await this.handleSignalingMessage(msg.id, msg.type, msg.data);
          }
        }
      } catch {
      } finally {
        this.isPolling = false;
      }
    };

    poll();
    // A single in-flight request at a time keeps serverless signaling responsive without overlap.
    this.pollInterval = setInterval(poll, 120);
  }

  private startJoinRetry() {
    this.stopJoinRetry();

    const requestJoin = () => {
      if (this.isDestroyed || this.isConnected()) {
        this.stopJoinRetry();
        return;
      }
      void this.sendSignalingMessage('join-request', { guestId: this.clientId });
    };

    requestJoin();
    this.joinRetryInterval = setInterval(requestJoin, 1500);
  }

  private stopJoinRetry() {
    if (this.joinRetryInterval) {
      clearInterval(this.joinRetryInterval);
      this.joinRetryInterval = null;
    }
  }

  private stopSignalingPoll() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isPolling = false;
  }

  private async handleSignalingMessage(id: string, type: string, data: unknown) {
    if (!this.pc || this.isDestroyed) return;

    if (id && this.seenMessageIds.has(id)) {
      return;
    }
    if (id) {
      this.seenMessageIds.add(id);
      if (this.seenMessageIds.size > 200) {
        const first = this.seenMessageIds.values().next().value;
        if (first) this.seenMessageIds.delete(first);
      }
    }

    try {
      if (type === 'join-request' && this.isHost) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[VEYRN WebRTC] Guest joined room, dispatching offer...');
        }
        if (this.pc.localDescription) {
          await this.sendSignalingMessage('offer', this.pc.localDescription);
        } else {
          await this.createAndSendOffer();
        }
      } else if (type === 'offer' && !this.isHost) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[VEYRN WebRTC] Offer received, setting remote description...');
        }
        if (
          this.pc.signalingState !== 'stable' &&
          this.pc.signalingState !== 'have-local-offer'
        ) {
          return;
        }

        await this.pc.setRemoteDescription(new RTCSessionDescription(data as RTCSessionDescriptionInit));
        this.hasRemoteDescription = true;
        this.drainIceCandidates();

        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        if (process.env.NODE_ENV === 'development') {
          console.log('[VEYRN WebRTC] Answer created and dispatched');
        }
        await this.sendSignalingMessage('answer', answer);
      } else if (type === 'answer' && this.isHost) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[VEYRN WebRTC] Answer received from guest');
        }
        if (this.pc.signalingState === 'have-local-offer') {
          await this.pc.setRemoteDescription(new RTCSessionDescription(data as RTCSessionDescriptionInit));
          this.hasRemoteDescription = true;
          this.drainIceCandidates();
        }
      } else if (type === 'ice-candidate' && data) {
        if (this.hasRemoteDescription) {
          try {
            await this.pc.addIceCandidate(new RTCIceCandidate(data as RTCIceCandidateInit));
          } catch {}
        } else {
          this.iceCandidatesQueue.push(data as RTCIceCandidateInit);
        }
      } else if (type === 'peer-disconnect') {
        this.setStatus('peer-disconnected');
      }
    } catch (err) {
      console.warn('[VEYRN WebRTC] Signaling processing error:', err);
    }
  }

  private drainIceCandidates() {
    if (!this.pc || !this.hasRemoteDescription) return;
    while (this.iceCandidatesQueue.length > 0) {
      const cand = this.iceCandidatesQueue.shift();
      if (cand) {
        try {
          this.pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch {}
      }
    }
  }

  private setupDataChannel(
    dc: RTCDataChannel,
    resolve: () => void,
    timeout: ReturnType<typeof setTimeout>
  ) {
    dc.onopen = async () => {
      this.setStatus('connected');
      this.stopSignalingPoll();
      this.stopJoinRetry();
      clearTimeout(timeout);
      await this.logConnectionStats();

      // Poll stats periodically to update UI latency / relay indicators
      if (!this.statsInterval) {
        this.statsInterval = setInterval(async () => {
          if (this.pc && this.isConnected()) {
            const stats = await extractConnectionStats(this.pc);
            this.stats = stats;
            this.statusHandlers.forEach((h) => h(this.status, stats));
          }
        }, 5000);
      }

      resolve();
    };

    dc.onclose = () => {
      if (!this.isDestroyed) {
        this.setStatus('peer-disconnected');
      }
    };

    dc.onerror = () => {
      if (!this.isDestroyed) {
        this.setStatus('disconnected');
      }
    };

    dc.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const envelope = validateEnvelope(data);
        if (!envelope) return;
        if (envelope.sessionId !== this.sessionId) return;

        // Sequence check to avoid duplicate or reordered out-of-sequence packets
        if (envelope.sequence <= this.remoteSequence && envelope.type === 'move') {
          return;
        }
        if (envelope.type === 'move') {
          this.remoteSequence = envelope.sequence;
        }

        this.handlers.forEach((h) => h(envelope.payload));
      } catch {}
    };
  }

  send(payload: GameMessagePayload): void {
    if (!this.dc || this.dc.readyState !== 'open') return;
    const envelope = createEnvelope(this.sessionId, ++this.sequence, payload);
    this.dc.send(JSON.stringify(envelope));
  }

  subscribe(handler: (payload: GameMessagePayload) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  disconnect(): void {
    this.isDestroyed = true;
    this.stopSignalingPoll();
    this.stopJoinRetry();

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    if (this.disconnectTimeout) {
      clearTimeout(this.disconnectTimeout);
      this.disconnectTimeout = null;
    }

    if (this.dc && this.dc.readyState === 'open') {
      try {
        this.send({ type: 'resign' });
      } catch {}
      try {
        this.dc.close();
      } catch {}
      this.dc = null;
    }

    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close();
      } catch {}
      this.broadcastChannel = null;
    }

    if (this.pc) {
      try {
        this.pc.close();
      } catch {}
      this.pc = null;
    }

    this.setStatus('disconnected');
    this.handlers.clear();
    this.statusHandlers.clear();
  }

  isConnected(): boolean {
    return this.status === 'connected' && this.dc?.readyState === 'open';
  }
}
