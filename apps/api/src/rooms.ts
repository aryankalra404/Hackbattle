import {
  circuitSnapshotSchema,
  type ClientMessage,
  type Peer,
  type RoomState,
  type ServerMessage,
} from '@circuitgit/schema';

/**
 * Room state.
 *
 * Transport-free so it can be unit tested: a room takes messages in and returns
 * what should be sent out. The WebSocket layer only moves bytes.
 */

export type PushOutcome =
  | { ok: true; state: RoomState }
  | { ok: false; reply: Extract<ServerMessage, { type: 'rejected' }> };

export class Room {
  private state: RoomState | undefined;
  private readonly peers = new Map<string, Peer>();

  constructor(readonly name: string) {}

  current(): RoomState | undefined {
    return this.state;
  }

  peerList(): Peer[] {
    return [...this.peers.values()].sort((a, b) => a.device.localeCompare(b.device));
  }

  join(peer: Peer): void {
    this.peers.set(peer.device, peer);
  }

  leave(device: string): void {
    this.peers.delete(device);
  }

  isEmpty(): boolean {
    return this.peers.size === 0;
  }

  /**
   * Apply a push.
   *
   * Two things are refused:
   *  - a stale push, where the sender was working from an older version than the
   *    room holds. The sender gets the current state back to rebase on (this is
   *    the wire-level form of conflict C32);
   *  - a circuit change while a session is live. The lock exists so that a
   *    running simulation and the circuit it measures cannot drift apart, and a
   *    remote device must not be able to sidestep it.
   */
  push(message: Extract<ClientMessage, { type: 'push' }>, device: string): PushOutcome {
    const parsed = circuitSnapshotSchema.safeParse(message.snapshot);
    if (!parsed.success) {
      return {
        ok: false,
        reply: {
          type: 'rejected',
          reason: 'invalid',
          detail: parsed.error.errors[0]?.message ?? 'snapshot failed validation',
          state: this.state ?? null,
        },
      };
    }

    if (this.state && message.baseVersion !== this.state.version) {
      return {
        ok: false,
        reply: {
          type: 'rejected',
          reason: 'stale',
          detail:
            `Room is at version ${this.state.version}, push was based on ` +
            `${message.baseVersion}.`,
          state: this.state,
        },
      };
    }

    // Leaving the session is always allowed; changing the circuit inside one is not.
    if (this.state?.mode === 'simulate' && message.mode === 'simulate') {
      const changed = JSON.stringify(this.state.snapshot) !== JSON.stringify(parsed.data);
      if (changed) {
        return {
          ok: false,
          reply: {
            type: 'rejected',
            reason: 'locked',
            detail: 'The circuit is locked while a session is live.',
            state: this.state,
          },
        };
      }
    }

    this.state = {
      snapshot: parsed.data,
      mode: message.mode,
      simulatingHash: message.simulatingHash,
      version: (this.state?.version ?? 0) + 1,
      updatedBy: device,
    };

    return { ok: true, state: this.state };
  }
}

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();

  get(name: string): Room {
    let room = this.rooms.get(name);
    if (!room) {
      room = new Room(name);
      this.rooms.set(name, room);
    }
    return room;
  }

  /** Drop a room once nobody is left, so an empty server holds nothing. */
  release(name: string): void {
    const room = this.rooms.get(name);
    if (room?.isEmpty()) this.rooms.delete(name);
  }

  names(): string[] {
    return [...this.rooms.keys()].sort();
  }

  size(): number {
    return this.rooms.size;
  }
}
