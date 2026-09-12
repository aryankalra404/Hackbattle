import { useMemo } from 'react';
import type { Commit } from '@circuitgit/schema';
import { useInspectedDiff, useStore } from '../state/store.js';
import { relativeTime } from '../format.js';

/**
 * History: the commit graph, a commit's detail, and the diff between any two
 * commits with the electrical / cosmetic filter.
 */

/** Lane assignment for the graph rail — one column per concurrent line of work. */
function lanes(commits: readonly Commit[]): Map<string, number> {
  const lane = new Map<string, number>();
  const open: (string | undefined)[] = [];

  for (const commit of commits) {
    let index = open.indexOf(commit.id);
    if (index === -1) {
      index = open.findIndex((slot) => slot === undefined);
      if (index === -1) index = open.length;
    }
    open[index] = commit.parents[0];
    lane.set(commit.id, index);

    // A merge's second parent claims its own lane.
    for (const parent of commit.parents.slice(1)) {
      const free = open.findIndex((slot) => slot === undefined);
      open[free === -1 ? open.length : free] = parent;
    }
  }

  return lane;
}

const LANE_COLORS = ['#0969da', '#8250df', '#1a7f37', '#bf3989', '#9a6700'];

function Badges({ commit }: { commit: Commit }) {
  return (
    <span className="badges">
      {(['rules', 'sim', 'llm'] as const).map((key) => (
        <span key={key} className={`badge badge--${commit.checks[key]}`}>
          {key} {commit.checks[key]}
        </span>
      ))}
    </span>
  );
}

function CommitRow({ commit, lane }: { commit: Commit; lane: number }) {
  const inspecting = useStore((s) => s.inspecting);
  const inspect = useStore((s) => s.inspect);
  const repo = useStore((s) => s.repo);
  const branches = repo.branchesAt(commit.id);

  return (
    <button
      type="button"
      className={`commit${inspecting === commit.id ? ' commit--on' : ''}`}
      onClick={() => inspect(commit.id)}
    >
      <span className="commit__rail" style={{ paddingLeft: lane * 14 }}>
        <span
          className="commit__node"
          style={{ background: LANE_COLORS[lane % LANE_COLORS.length] }}
        />
      </span>

      <span className="commit__main">
        <span className="commit__message">{commit.message}</span>
        <span className="commit__meta">
          <span className="mono">{commit.id.slice(0, 7)}</span>
          <span>·</span>
          <span>{commit.author}</span>
          <span>·</span>
          <span>{relativeTime(commit.createdAt)}</span>
          <span className="chip chip--source">{commit.source}</span>
          {branches.map((name) => (
            <span key={name} className="chip chip--branch">
              {name}
            </span>
          ))}
        </span>
      </span>

      <Badges commit={commit} />
    </button>
  );
}

function DiffList() {
  const changes = useInspectedDiff();
  const electricalOnly = useStore((s) => s.electricalOnly);
  const toggle = useStore((s) => s.toggleElectricalOnly);
  const inspecting = useStore((s) => s.inspecting);

  if (!inspecting) {
    return <p className="empty">Pick a commit to see what changed in it.</p>;
  }

  return (
    <>
      <div className="diff__toolbar">
        <label className="switch switch--inline">
          <input type="checkbox" checked={electricalOnly} onChange={toggle} />
          <span className="switch__track" aria-hidden="true" />
          <span className="switch__text">Electrical changes only</span>
        </label>
        <span className="chip">
          {changes.length} change{changes.length === 1 ? '' : 's'}
        </span>
      </div>

      {changes.length === 0 && (
        <p className="empty">
          {electricalOnly ? 'Nothing changed electrically in this commit.' : 'No differences.'}
        </p>
      )}

      <ul className="diff">
        {changes.map((change, index) => (
          <li key={index} className={`diff__row diff__row--${change.kind}`}>
            <span className="diff__sign" aria-hidden="true">
              {change.kind === 'added' ? '+' : change.kind === 'removed' ? '−' : '~'}
            </span>
            <span className="diff__label">{change.label}</span>
            <span className="diff__tags">
              <span className="chip">{change.collection}</span>
              {!change.electrical && <span className="chip chip--muted">cosmetic</span>}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function CommitDetail() {
  const inspecting = useStore((s) => s.inspecting);
  const repo = useStore((s) => s.repo);
  const restore = useStore((s) => s.restore);
  const checkout = useStore((s) => s.checkout);

  if (!inspecting) return null;

  let commit: Commit;
  try {
    commit = repo.getCommit(inspecting);
  } catch {
    return null;
  }

  return (
    <div className="commit-detail">
      <div className="commit-detail__head">
        <div>
          <h3>{commit.message}</h3>
          <p className="commit__meta">
            <span className="mono">{commit.id.slice(0, 12)}</span>
            <span>·</span>
            <span>{commit.author}</span>
            <span>·</span>
            <span>{new Date(commit.createdAt).toLocaleString()}</span>
          </p>
        </div>
        <div className="commit-detail__actions">
          <button type="button" className="btn btn--sm" onClick={() => checkout(commit.id)}>
            Open
          </button>
          <button
            type="button"
            className="btn btn--sm btn--primary"
            onClick={() => void restore(commit.id)}
            title="Create a new commit whose circuit equals this one"
          >
            Restore
          </button>
        </div>
      </div>

      <dl className="commit-detail__grid">
        <div>
          <dt>Snapshot</dt>
          <dd className="mono">{commit.snapshotHash.slice(0, 12)}</dd>
        </div>
        <div>
          <dt>Electrical</dt>
          <dd className="mono">{commit.electricalHash.slice(0, 12)}</dd>
        </div>
        <div>
          <dt>Parents</dt>
          <dd className="mono">
            {commit.parents.length === 0
              ? 'root'
              : commit.parents.map((id) => id.slice(0, 7)).join(', ')}
          </dd>
        </div>
      </dl>

      <Badges commit={commit} />
    </div>
  );
}

export function History() {
  const repo = useStore((s) => s.repo);
  const commits = repo.allCommits();
  const laneOf = useMemo(() => lanes(commits), [commits]);

  return (
    <div className="history">
      <section className="panel history__graph">
        <div className="panel__header">
          Commits
          <span className="chip">{commits.length}</span>
        </div>
        <div className="scroll history__list">
          {commits.length === 0 && (
            <p className="empty">
              No commits yet. Build something, then use <strong>Commit</strong>.
            </p>
          )}
          {commits.map((commit) => (
            <CommitRow key={commit.id} commit={commit} lane={laneOf.get(commit.id) ?? 0} />
          ))}
        </div>
      </section>

      <section className="panel history__detail">
        <div className="panel__header">Changes</div>
        <div className="scroll history__detail-body">
          <CommitDetail />
          <DiffList />
        </div>
      </section>
    </div>
  );
}
