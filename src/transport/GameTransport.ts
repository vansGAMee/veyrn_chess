import type { MessageEnvelope, GameMessagePayload } from '@/types/protocol';
import { createEnvelope, validateEnvelope } from '@/types/protocol';

export interface GameTransport {
  connect(roomId: string, isHost: boolean): Promise<void>;
  send(payload: GameMessagePayload): void;
  subscribe(handler: (payload: GameMessagePayload) => void): () => void;
  disconnect(): void;
  isConnected(): boolean;
}

export class P2PGameTransport implements GameTransport {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private sessionId: string = '';
  private clientId: string = '';
  private sequence: number = 0;
  private remoteSequence: number = -1;
  private handlers: Set<(payload: GameMessagePayload) => void> = new Set();
  private connected: boolean = false;
  private isHost: boolean = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private lastPollTimestamp: number = 0;
  private iceCandidatesQueue: RTCIceCandidateInit[] = [];
  private hasRemoteDescription: boolean = false;

  constructor() {
    this.clientId = `client-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  }

  async connect(roomId: string, isHost: boolean): Promise<void> {
    this.sessionId = roomId;
    this.isHost = isHost;
    this.sequence = 0;
    this.remoteSequence = -1;
    this.iceCandidatesQueue = [];
    this.hasRemoteDescription = false;

    const config: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
      ],
    };

    // Add optional TURN server from env if present
    if (process.env.NEXT_PUBLIC_TURN_URL) {
      config.iceServers!.push({
        urls: process.env.NEXT_PUBLIC_TURN_URL,
        username: process.env.NEXT_PUBLIC_TURN_USERNAME || '',
        credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL || '',
      });
    }

    this.pc = new RTCPeerConnection(config);

    // Setup multi-tier signaling: BroadcastChannel + API route
    try {
      this.broadcastChannel = new BroadcastChannel(`veyrn-signal-${roomId}`);
      this.broadcastChannel.onmessage = (event) => {
        if (event.data && event.data.senderId !== this.clientId) {
          this.handleSignalingMessage(event.data.type, event.data.data);
        }
      };
    } catch {
      this.broadcastChannel = null;
    }

    // Start signaling polling
    this.startSignalingPoll(roomId);

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.connected) {
          // Keep polling in background rather than immediately failing if waiting for opponent
          if (!isHost) {
            reject(new Error('Connection timeout waiting for host'));
          }
        }
      }, 45000);

      this.pc!.onicecandidate = (e) => {
        if (e.candidate) {
          this.sendSignalingMessage('ice-candidate', e.candidate.toJSON());
        }
      };

      this.pc!.onconnectionstatechange = () => {
        if (this.pc?.connectionState === 'connected') {
          this.connected = true;
        } else if (this.pc?.connectionState === 'disconnected' || this.pc?.connectionState === 'failed') {
          this.connected = false;
        }
      };

      if (isHost) {
        // Host creates the DataChannel
        this.dc = this.pc!.createDataChannel('game', {
          ordered: true,
        });
        this.setupDataChannel(this.dc, resolve, timeout);

        this.createAndSendOffer();
      } else {
        // Guest waits for DataChannel from Host
        this.pc!.ondatachannel = (event) => {
          this.dc = event.channel;
          this.setupDataChannel(this.dc, resolve, timeout);
        };

        // Notify host that guest is present
        this.sendSignalingMessage('join-request', {});
      }
    });
  }

  private async createAndSendOffer() {
    if (!this.pc) return;
    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      await this.sendSignalingMessage('offer', offer);
    } catch (err) {
      console.warn('Error creating offer:', err);
    }
  }

  private async sendSignalingMessage(type: string, data: unknown) {
    const payload = {
      senderId: this.clientId,
      type,
      data,
      timestamp: Date.now(),
    };

    // 1. Send via BroadcastChannel for immediate local same-browser delivery
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(payload);
      } catch {}
    }

    // 2. Send via HTTP API for cross-browser / cross-machine delivery
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
    this.lastPollTimestamp = Date.now() - 60000; // fetch recent

    const poll = async () => {
      if (this.connected && this.dc?.readyState === 'open') {
        // Already connected, slow down polling or stop
        return;
      }
      try {
        const res = await fetch(
          `/api/signal/${roomId}?senderId=${encodeURIComponent(this.clientId)}&since=${this.lastPollTimestamp}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (data.messages && Array.isArray(data.messages)) {
          for (const msg of data.messages) {
            this.lastPollTimestamp = Math.max(this.lastPollTimestamp, msg.timestamp);
            await this.handleSignalingMessage(msg.type, msg.data);
          }
        }
      } catch {}
    };

    // Initial immediate poll
    poll();
    // Poll every 350ms during negotiation
    this.pollInterval = setInterval(poll, 350);
  }

  private stopSignalingPoll() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private async handleSignalingMessage(type: string, data: any) {
    if (!this.pc) return;

    try {
      if (type === 'join-request' && this.isHost) {
        // Re-send offer when guest joins
        if (this.pc.localDescription) {
          await this.sendSignalingMessage('offer', this.pc.localDescription);
        } else {
          await this.createAndSendOffer();
        }
      } else if (type === 'offer' && !this.isHost) {
        if (this.pc.signalingState !== 'stable' && this.pc.signalingState !== 'have-local-offer') {
          return;
        }
        await this.pc.setRemoteDescription(new RTCSessionDescription(data));
        this.hasRemoteDescription = true;
        this.drainIceCandidates();

        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        await this.sendSignalingMessage('answer', answer);
      } else if (type === 'answer' && this.isHost) {
        if (this.pc.signalingState === 'have-local-offer') {
          await this.pc.setRemoteDescription(new RTCSessionDescription(data));
          this.hasRemoteDescription = true;
          this.drainIceCandidates();
        }
      } else if (type === 'ice-candidate' && data) {
        if (this.hasRemoteDescription) {
          try {
            await this.pc.addIceCandidate(new RTCIceCandidate(data));
          } catch {}
        } else {
          this.iceCandidatesQueue.push(data);
        }
      }
    } catch (err) {
      console.warn('Signaling error:', err);
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
    dc.onopen = () => {
      this.connected = true;
      this.stopSignalingPoll();
      clearTimeout(timeout);
      resolve();
    };

    dc.onclose = () => {
      this.connected = false;
    };

    dc.onerror = () => {
      this.connected = false;
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
    this.stopSignalingPoll();
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
    if (this.dc) {
      this.dc.close();
      this.dc = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.connected = false;
    this.handlers.clear();
  }

  isConnected(): boolean {
    return this.connected && this.dc?.readyState === 'open';
  }
}
