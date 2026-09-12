import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../state/store.js';

/** Branch switcher, in the shape a version-control UI has trained everyone to expect. */
export function BranchMenu({ icon }: { icon: ReactNode }) {
  const repo = useStore((s) => s.repo);
  const branch = useStore((s) => s.branch);
  const baseCommit = useStore((s) => s.baseCommit);
  const dirty = useStore((s) => s.dirty);
  const switchBranch = useStore((s) => s.switchBranch);
  const createBranch = useStore((s) => s.createBranch);
  const deleteBranch = useStore((s) => s.deleteBranch);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const branches = repo.listBranches();

  return (
    <div className="branch-menu" ref={root}>
      <button
        type="button"
        className="btn branch-menu__trigger"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {icon}
        <span className="branch-menu__name">{branch}</span>
        {repo.isProtected(branch) && <span className="chip chip--lock">protected</span>}
        {dirty && <span className="dot" title="Uncommitted changes" />}
      </button>

      {open && (
        <div className="menu">
          <div className="menu__header">Switch branch</div>

          {branches.length === 0 && (
            <p className="empty">No branches yet. Make your first commit.</p>
          )}

          {branches.map((candidate) => (
            <div key={candidate.name} className="menu__row">
              <button
                type="button"
                className={`menu__item${candidate.name === branch ? ' menu__item--on' : ''}`}
                onClick={() => {
                  switchBranch(candidate.name);
                  setOpen(false);
                }}
              >
                <span className="menu__label">{candidate.name}</span>
                <span className="mono menu__hash">{candidate.head.slice(0, 7)}</span>
              </button>
              {!candidate.protected && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  title={`Delete ${candidate.name}`}
                  onClick={() => deleteBranch(candidate.name)}
                >
                  ✕
                </button>
              )}
            </div>
          ))}

          <div className="menu__footer">
            <input
              className="input"
              placeholder="new-branch-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || name.trim() === '') return;
                createBranch(name.trim());
                setName('');
                setOpen(false);
              }}
            />
            <button
              type="button"
              className="btn btn--sm"
              disabled={name.trim() === '' || !baseCommit}
              onClick={() => {
                createBranch(name.trim());
                setName('');
                setOpen(false);
              }}
            >
              Create from {baseCommit ? baseCommit.slice(0, 7) : 'HEAD'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
