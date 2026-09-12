import { useEffect, useRef, useState } from 'react';
import { roomNameSchema } from '@circuitgit/schema';
import { useStore } from '../state/store.js';

/**
 * Room control.
 *
 * Joining a room mirrors this circuit to every other device in it — a headset
 * on the same network, most usefully. Connection state is shown honestly:
 * "connecting" and "offline" are never dressed up as connected.
 */

const STATUS_LABEL = {
  online: 'Synced',
  connecting: 'Connecting…',
  offline: 'Offline',
} as const;

export function RoomMenu() {
  const room = useStore((s) => s.room);
  const connection = useStore((s) => s.connection);
  const peers = useStore((s) => s.peers);
  const roomVersion = useStore((s) => s.roomVersion);
  const joinRoom = useStore((s) => s.joinRoom);
  const leaveRoom = useStore((s) => s.leaveRoom);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('demo');
  const [error, setError] = useState<string | undefined>();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const join = () => {
    const parsed = roomNameSchema.safeParse(name.trim().toLowerCase());
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? 'Invalid room name');
      return;
    }
    setError(undefined);
    joinRoom(parsed.data);
    setOpen(false);
  };

  const headsets = peers.filter((peer) => peer.role === 'xr').length;

  return (
    <div className="room-menu" ref={root}>
      <button
        type="button"
        className={`btn room-menu__trigger room-menu__trigger--${room ? connection : 'off'}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title={room ? `Room "${room}" — ${STATUS_LABEL[connection]}` : 'Not syncing'}
      >
        <span className="room-menu__led" aria-hidden="true" />
        {room ? (
          <>
            <span className="room-menu__name">{room}</span>
            {headsets > 0 && (
              <span className="chip chip--headset">
                {headsets} headset{headsets === 1 ? '' : 's'}
              </span>
            )}
          </>
        ) : (
          <span className="room-menu__name">Sync off</span>
        )}
      </button>

      {open && (
        <div className="menu menu--right">
          <div className="menu__header">Device sync</div>

          {room ? (
            <div className="room-panel">
              <p className="room-panel__status">
                <strong>{STATUS_LABEL[connection]}</strong> · room{' '}
                <span className="mono">{room}</span> · v{roomVersion}
              </p>

              <ul className="room-panel__peers">
                {peers.length === 0 && <li className="empty">No other devices yet.</li>}
                {peers.map((peer) => (
                  <li key={peer.device}>
                    <span className={`chip chip--${peer.role}`}>{peer.role}</span>
                    <span className="mono">{peer.device}</span>
                  </li>
                ))}
              </ul>

              <p className="field__hint">
                Open this editor on another machine, using this machine&rsquo;s LAN address, and
                join the same room. The headset runs the Unity app, which syncs through the
                CircuitDoctor bridge rather than joining a room here.
              </p>

              <button type="button" className="btn btn--sm" onClick={leaveRoom}>
                Leave room
              </button>
            </div>
          ) : (
            <div className="menu__footer">
              <label className="field">
                <span className="field__label">Room name</span>
                <input
                  className="input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && join()}
                  placeholder="demo"
                />
              </label>
              {error && <span className="field__hint room-panel__error">{error}</span>}
              <button type="button" className="btn btn--sm btn--primary" onClick={join}>
                Join room
              </button>
              <span className="field__hint">
                Everything in the room mirrors the same circuit live.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
