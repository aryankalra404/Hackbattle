import { useState } from 'react';
import { useStore } from '../state/store.js';
import { config } from '../state/library.js';
import { BranchMenu } from './BranchMenu.js';

/** Icons are inline so the app pulls in no icon dependency. */
function Icon({ path, size = 16 }: { path: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}

const ICONS = {
  branch:
    'M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.49 2.49 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z',
  edit: 'M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Z',
  logo: 'M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0ZM4.5 8a1 1 0 1 1 2 0 1 1 0 0 1-2 0Zm5 0a1 1 0 1 1 2 0 1 1 0 0 1-2 0ZM3 7.25h1a.75.75 0 0 1 0 1.5H3a.75.75 0 0 1 0-1.5Zm4 0h2a.75.75 0 0 1 0 1.5H7a.75.75 0 0 1 0-1.5Zm5 0h1a.75.75 0 0 1 0 1.5h-1a.75.75 0 0 1 0-1.5Z',
};

export function TopBar() {
  const snapshot = useStore((s) => s.snapshot);
  const setMeta = useStore((s) => s.setMeta);

  const [editingName, setEditingName] = useState(false);

  return (
    <header className="topbar">
      <div className="topbar__left">
        <span className="brand">
          <Icon path={ICONS.logo} size={20} />
          <span className="brand__name">{config.product.name}</span>
        </span>

        <span className="topbar__divider" />

        {editingName ? (
          <input
            className="input topbar__name-input"
            autoFocus
            value={snapshot.meta.name}
            onChange={(event) => setMeta({ name: event.target.value })}
            onBlur={() => setEditingName(false)}
            onKeyDown={(event) => event.key === 'Enter' && setEditingName(false)}
          />
        ) : (
          <button
            type="button"
            className="topbar__name"
            onClick={() => setEditingName(true)}
            title="Rename circuit"
          >
            {snapshot.meta.name || 'Untitled circuit'}
            <Icon path={ICONS.edit} size={12} />
          </button>
        )}

        <BranchMenu icon={<Icon path={ICONS.branch} />} />
      </div>
    </header>
  );
}
