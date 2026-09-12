import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { emptySnapshot, pinRef, type CircuitSnapshot } from '@circuitgit/schema';
import { Room, RoomRegistry } from './rooms.js';

function circuit(name = 'test'): CircuitSnapshot {
  const supply = randomUUID();
  const resistor = randomUUID();
  const snapshot = emptySnapshot(name);
  snapshot.components[supply] = { part: 'dc-supply@1', label: 'V1', params: { voltage: 5 } };
  snapshot.components[resistor] = { part: 'resistor@1', label: 'R1', params: { resistance: 330 } };
  snapshot.wires[randomUUID()] = {
    a: pinRef(supply, 'pos'),
    b: pinRef(resistor, 'a'),
    style: {},
  };
  snapshot.settings.ground = pinRef(supply, 'neg');
  return snapshot;
}

function push(
  room: Room,
  snapshot: CircuitSnapshot,
  baseVersion: number,
  mode: 'edit' | 'simulate' = 'edit',
  device = 'laptop',
) {
  return room.push(
    {
      type: 'push',
      snapshot,
      mode,
      simulatingHash: mode === 'simulate' ? 'abc123' : null,
      baseVersion,
    },
    device,
  );
}

describe('room state', () => {
  it('starts empty and accepts the first push', () => {
    const room = new Room('demo');
    expect(room.current()).toBeUndefined();

    const outcome = push(room, circuit(), 0);
    expect(outcome.ok).toBe(true);
    expect(room.current()?.version).toBe(1);
    expect(room.current()?.updatedBy).toBe('laptop');
  });

  it('increments the version on each accepted push', () => {
    const room = new Room('demo');
    push(room, circuit('a'), 0);
    push(room, circuit('b'), 1);
    expect(room.current()?.version).toBe(2);
  });

  it('rejects a stale push and hands back the current state (C32)', () => {
    const room = new Room('demo');
    push(room, circuit('a'), 0);
    push(room, circuit('b'), 1);

    // A headset that missed an update still believes the room is at version 1.
    const outcome = push(room, circuit('c'), 1, 'edit', 'quest');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected rejection');

    expect(outcome.reply.reason).toBe('stale');
    expect(outcome.reply.state?.version).toBe(2);
    // The losing push changed nothing.
    expect(room.current()?.snapshot.meta.name).toBe('b');
  });

  it('refuses a circuit change while a session is live', () => {
    const room = new Room('demo');
    const original = circuit('locked');
    push(room, original, 0, 'simulate');

    const outcome = push(room, circuit('tampered'), 1, 'simulate', 'quest');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected rejection');

    expect(outcome.reply.reason).toBe('locked');
    expect(room.current()?.snapshot.meta.name).toBe('locked');
  });

  it('allows an unchanged push while simulating', () => {
    const room = new Room('demo');
    const snapshot = circuit('steady');
    push(room, snapshot, 0, 'simulate');

    expect(push(room, structuredClone(snapshot), 1, 'simulate').ok).toBe(true);
  });

  it('allows leaving the session, which unlocks the room', () => {
    const room = new Room('demo');
    const snapshot = circuit('steady');
    push(room, snapshot, 0, 'simulate');

    expect(push(room, structuredClone(snapshot), 1, 'edit').ok).toBe(true);
    expect(room.current()?.mode).toBe('edit');
    expect(push(room, circuit('edited'), 2, 'edit').ok).toBe(true);
  });

  it('rejects a snapshot that fails schema validation', () => {
    const room = new Room('demo');
    const outcome = room.push(
      {
        type: 'push',
        // A wire pointing at nothing must never reach another device.
        snapshot: { not: 'a snapshot' } as unknown as CircuitSnapshot,
        mode: 'edit',
        simulatingHash: null,
        baseVersion: 0,
      },
      'laptop',
    );

    expect(outcome.ok).toBe(false);
    expect(room.current()).toBeUndefined();
  });

  it('tracks peers joining and leaving', () => {
    const room = new Room('demo');
    room.join({ device: 'laptop', role: 'editor', label: 'Laptop' });
    room.join({ device: 'quest', role: 'xr', label: 'Quest' });
    expect(room.peerList().map((peer) => peer.role)).toEqual(['editor', 'xr']);

    room.leave('quest');
    expect(room.peerList()).toHaveLength(1);
    expect(room.isEmpty()).toBe(false);

    room.leave('laptop');
    expect(room.isEmpty()).toBe(true);
  });
});

describe('room registry', () => {
  it('creates rooms on demand and drops them when empty', () => {
    const registry = new RoomRegistry();
    const room = registry.get('demo');
    room.join({ device: 'laptop', role: 'editor', label: 'Laptop' });

    expect(registry.size()).toBe(1);

    registry.release('demo');
    expect(registry.size()).toBe(1); // still occupied

    room.leave('laptop');
    registry.release('demo');
    expect(registry.size()).toBe(0);
  });

  it('returns the same room for the same name', () => {
    const registry = new RoomRegistry();
    expect(registry.get('demo')).toBe(registry.get('demo'));
  });
});
