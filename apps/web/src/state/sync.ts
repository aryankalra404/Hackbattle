import {
  serverMessageSchema,
  type ClientMessage,
  type Peer,
  type RoomState,
  type SyncRole,
} from '@circuitgit/schema';

/**
 * Sync client.
 *
 * Connects to the hub over the page's own origin, so an HTTPS page (which the
 * Quest requires for WebXR) gets a WSS socket without a second certificate —
 * the Vite dev server proxies `/sync` through to the hub.
 *
 * Reconnects on its own: a headset that sleeps, moves out of range, or is
 * unplugged should rejoin without anyone touching the laptop.
 */

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

export type SyncHandlers = {
  onState: (state: RoomState) => void;
  onPeers: (peers: Peer[]) => void;
  onStatus: (status: ConnectionStatus) => void;
  onRejected: (reason: string, detail: string, state: RoomState | null) => void;
};

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 8000;
const PING_INTERVAL_MS = 20000;

export function syncUrl(room: string): string {
  const protocol = globalThis.location?.protocol === 'https:' ? 'wss' : 'ws';
  const host = globalThis.location?.host ?? 'localhost:5173';
  return `${protocol}://${host}/sync?room=${encodeURIComponent(room)}`;
}

export class SyncClient {
  private socket: WebSocket | undefined;
  private reconnectDelay = RECONNECT_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private closed = false;

  constructor(
    private readonly room: string,
    private readonly device: string,
    private readonly role: SyncRole,
    private readonly label: string,
    private readonly handlers: SyncHandlers,
  ) {}

  connect(): void {
    this.closed = false;
    this.handlers.onStatus('connecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(syncUrl(this.room));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.reconnectDelay = RECONNECT_MIN_MS;
      this.handlers.onStatus('online');
      this.send({
        type: 'hello',
        device: this.device,
        role: this.role,
        label: this.label,
      });
      this.pingTimer = setInterval(() => this.send({ type: 'ping' }), PING_INTERVAL_MS);
    });

    socket.addEventListener('message', (event) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(event.data));
      } catch {
        return;
      }

      // Anything off the wire is untrusted until the schema says otherwise.
      const parsed = serverMessageSchema.safeParse(raw);
      if (!parsed.success) return;

      switch (parsed.data.type) {
        case 'state':
          this.handlers.onState(parsed.data.state);
          return;
        case 'peers':
          this.handlers.onPeers(parsed.data.peers);
          return;
        case 'rejected':
          this.handlers.onRejected(parsed.data.reason, parsed.data.detail, parsed.data.state);
          // A rejection always carries the authoritative state, so adopt it.
          if (parsed.data.state) this.handlers.onState(parsed.data.state);
          return;
        case 'welcome':
        case 'pong':
          return;
      }
    });

    socket.addEventListener('close', () => {
      this.clearPing();
      this.handlers.onStatus('offline');
      this.scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      // `close` follows, which handles the retry.
    });
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      // Back off so a hub that is down does not get hammered.
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
      this.connect();
    }, this.reconnectDelay);
  }

  private clearPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  disconnect(): void {
    this.closed = true;
    this.clearPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.socket?.close();
    this.socket = undefined;
    this.handlers.onStatus('offline');
  }
}

/** Stable per browser, so a reload rejoins as the same device rather than a new peer. */
export function deviceId(): string {
  const key = 'circuitgit.deviceId';
  try {
    const existing = globalThis.localStorage?.getItem(key);
    if (existing) return existing;
    const created = crypto.randomUUID().slice(0, 8);
    globalThis.localStorage?.setItem(key, created);
    return created;
  } catch {
    return crypto.randomUUID().slice(0, 8);
  }
}
