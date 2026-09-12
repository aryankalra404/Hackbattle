import { z } from 'zod';
import { circuitSnapshotSchema } from './circuit.js';

/**
 * Sync protocol.
 *
 * One room mirrors one circuit across devices — a laptop editor and a headset,
 * typically. Every message is validated at both ends by these schemas, so a
 * malformed or stale peer cannot corrupt the circuit on the other side.
 *
 * The unit of sync is the whole snapshot. Snapshots are small, and shipping the
 * complete state makes divergence impossible to accumulate: a client is either
 * on the sender's version or it is not.
 */

export const syncRoleSchema = z.enum(['editor', 'xr', 'observer']);
export type SyncRole = z.infer<typeof syncRoleSchema>;

export const sessionModeSchema = z.enum(['edit', 'simulate']);
export type SessionMode = z.infer<typeof sessionModeSchema>;

/** What every peer in a room agrees on. */
export const roomStateSchema = z
  .object({
    snapshot: circuitSnapshotSchema,
    mode: sessionModeSchema,
    /** Electrical hash the session was pinned to, when simulating. */
    simulatingHash: z.string().nullable(),
    /** Monotonic per room. A client ignores anything older than what it holds. */
    version: z.number().int().nonnegative(),
    /** Device id of whoever last wrote. */
    updatedBy: z.string().min(1),
  })
  .strict();
export type RoomState = z.infer<typeof roomStateSchema>;

export const peerSchema = z
  .object({
    device: z.string().min(1),
    role: syncRoleSchema,
    label: z.string().min(1),
  })
  .strict();
export type Peer = z.infer<typeof peerSchema>;

/** Client -> server. */
export const clientMessageSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('hello'),
      device: z.string().min(1).max(64),
      role: syncRoleSchema,
      label: z.string().min(1).max(64),
    })
    .strict(),
  z
    .object({
      type: z.literal('push'),
      snapshot: circuitSnapshotSchema,
      mode: sessionModeSchema,
      simulatingHash: z.string().nullable(),
      /** Version the client believed was current. Stale pushes are rejected. */
      baseVersion: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ type: z.literal('pull') }).strict(),
  z.object({ type: z.literal('ping') }).strict(),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

/** Server -> client. */
export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('welcome'), device: z.string(), room: z.string() }).strict(),
  z.object({ type: z.literal('state'), state: roomStateSchema }).strict(),
  z.object({ type: z.literal('peers'), peers: z.array(peerSchema) }).strict(),
  /** A push was refused. `state` carries the authoritative version to rebase on. */
  z
    .object({
      type: z.literal('rejected'),
      reason: z.enum(['stale', 'locked', 'invalid']),
      detail: z.string(),
      state: roomStateSchema.nullable(),
    })
    .strict(),
  z.object({ type: z.literal('pong') }).strict(),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

/** Room names stay simple so they can be typed into a headset. */
export const roomNameSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'room names are lowercase letters, digits and dashes');
