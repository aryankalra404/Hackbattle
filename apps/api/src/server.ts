import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  clientMessageSchema,
  roomNameSchema,
  type Peer,
  type ServerMessage,
} from '@circuitgit/schema';
import { RoomRegistry } from './rooms.js';

/**
 * CircuitGit sync hub.
 *
 * A plain HTTP + WebSocket server on the LAN. The web app's dev server proxies
 * `/sync` to it, so the headset connects over the same HTTPS origin as the page
 * and no second certificate is needed.
 *
 * The LLM gateway, simulation endpoints and merge sessions land here too in
 * P3/P4; this is the service they attach to.
 */

const PORT = Number(process.env['API_PORT'] ?? 8787);
const registry = new RoomRegistry();

type Client = {
  socket: WebSocket;
  room: string;
  peer: Peer;
};

const clients = new Set<Client>();

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(room: string, message: ServerMessage, except?: WebSocket): void {
  for (const client of clients) {
    if (client.room === room && client.socket !== except) send(client.socket, message);
  }
}

function announcePeers(room: string): void {
  broadcast(room, { type: 'peers', peers: registry.get(room).peerList() });
}

const httpServer = createServer((request, response) => {
  // A tiny health endpoint, useful for checking the LAN address from the headset.
  if (request.url?.startsWith('/health')) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        ok: true,
        service: 'circuitgit-sync',
        rooms: registry.names(),
        clients: clients.size,
      }),
    );
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('Not found');
});

const wss = new WebSocketServer({ server: httpServer, path: '/sync' });

wss.on('connection', (socket, request) => {
  const url = new URL(request.url ?? '/sync', 'http://localhost');
  const roomResult = roomNameSchema.safeParse(url.searchParams.get('room') ?? 'demo');

  if (!roomResult.success) {
    send(socket, {
      type: 'rejected',
      reason: 'invalid',
      detail: 'Bad room name.',
      state: null,
    });
    socket.close();
    return;
  }

  const room = roomResult.data;
  let client: Client | undefined;

  socket.on('message', (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      return; // not JSON; ignore rather than crash the hub
    }

    const message = clientMessageSchema.safeParse(parsed);
    if (!message.success) {
      send(socket, {
        type: 'rejected',
        reason: 'invalid',
        detail: message.error.errors[0]?.message ?? 'unrecognised message',
        state: registry.get(room).current() ?? null,
      });
      return;
    }

    switch (message.data.type) {
      case 'hello': {
        const peer: Peer = {
          device: message.data.device,
          role: message.data.role,
          label: message.data.label,
        };
        client = { socket, room, peer };
        clients.add(client);
        registry.get(room).join(peer);

        send(socket, { type: 'welcome', device: peer.device, room });
        const state = registry.get(room).current();
        if (state) send(socket, { type: 'state', state });
        announcePeers(room);
        return;
      }

      case 'pull': {
        const state = registry.get(room).current();
        if (state) send(socket, { type: 'state', state });
        return;
      }

      case 'push': {
        if (!client) return; // must say hello first
        const outcome = registry.get(room).push(message.data, client.peer.device);
        if (outcome.ok) {
          broadcast(room, { type: 'state', state: outcome.state });
        } else {
          send(socket, outcome.reply);
        }
        return;
      }

      case 'ping':
        send(socket, { type: 'pong' });
        return;
    }
  });

  socket.on('close', () => {
    if (!client) return;
    clients.delete(client);
    registry.get(room).leave(client.peer.device);
    announcePeers(room);
    registry.release(room);
  });

  socket.on('error', () => {
    // A dropped headset is routine; `close` does the cleanup.
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.warn(`CircuitGit sync hub listening on http://0.0.0.0:${PORT} (ws path /sync)`);
});
