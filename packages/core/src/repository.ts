import type { Branch, CircuitSnapshot, Commit, CommitChecks, DiffChange } from '@circuitgit/schema';
import { findDanglingReferences } from '@circuitgit/schema';
import { hashSnapshot, sha256 } from './canonical.js';
import { diffSnapshots } from './diff.js';

/**
 * Commit graph and branches.
 *
 * An in-memory content-addressed store: snapshots are stored once per hash,
 * commits are immutable, and a branch is a named pointer moved only by
 * compare-and-swap. The same semantics back onto Postgres in P3 — this is the
 * reference implementation the API and the client both agree with.
 */

export class RepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepositoryError';
  }
}

/** A compare-and-swap that lost — conflict C32. */
export class HeadMovedError extends RepositoryError {
  constructor(
    readonly branch: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `Branch "${branch}" has moved: expected head ${expected.slice(0, 7)}, ` +
        `found ${actual.slice(0, 7)}`,
    );
    this.name = 'HeadMovedError';
  }
}

export type CommitInput = {
  snapshot: CircuitSnapshot;
  message: string;
  author: string;
  source: Commit['source'];
  /** Expected current head; omitted for the first commit on a branch. */
  expectedHead?: string | undefined;
  parents?: string[];
  checks?: CommitChecks;
  createdAt?: string;
};

const PENDING: CommitChecks = { rules: 'pending', sim: 'pending', llm: 'pending' };

export class Repository {
  private readonly snapshots = new Map<string, CircuitSnapshot>();
  private readonly commits = new Map<string, Commit>();
  private readonly branches = new Map<string, Branch>();

  constructor(
    readonly project: string,
    private readonly protectedBranches: readonly string[] = [],
  ) {}

  // ---- reads -------------------------------------------------------------

  getCommit(id: string): Commit {
    const commit = this.commits.get(id);
    if (!commit) throw new RepositoryError(`Unknown commit ${id}`);
    return commit;
  }

  getSnapshot(hash: string): CircuitSnapshot {
    const snapshot = this.snapshots.get(hash);
    if (!snapshot) throw new RepositoryError(`Unknown snapshot ${hash}`);
    return snapshot;
  }

  snapshotOf(commitId: string): CircuitSnapshot {
    return this.getSnapshot(this.getCommit(commitId).snapshotHash);
  }

  getBranch(name: string): Branch {
    const branch = this.branches.get(name);
    if (!branch) throw new RepositoryError(`Unknown branch "${name}"`);
    return branch;
  }

  hasBranch(name: string): boolean {
    return this.branches.has(name);
  }

  listBranches(): Branch[] {
    return [...this.branches.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  isProtected(name: string): boolean {
    return this.protectedBranches.includes(name);
  }

  /** Commits reachable from a branch head, newest first. */
  log(branchName: string, limit = 100): Commit[] {
    const head = this.branches.get(branchName)?.head;
    if (!head) return [];

    const seen = new Set<string>();
    const out: Commit[] = [];
    const queue = [head];

    while (queue.length > 0 && out.length < limit) {
      const id = queue.shift();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const commit = this.commits.get(id);
      if (!commit) continue;
      out.push(commit);
      queue.push(...commit.parents);
    }

    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Every commit in the project, newest first — the branch-graph view. */
  allCommits(): Commit[] {
    return [...this.commits.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Branch names whose head is this commit. */
  branchesAt(commitId: string): string[] {
    return this.listBranches()
      .filter((branch) => branch.head === commitId)
      .map((branch) => branch.name);
  }

  ancestorsOf(commitId: string): Set<string> {
    const seen = new Set<string>();
    const queue = [commitId];
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      queue.push(...(this.commits.get(id)?.parents ?? []));
    }
    return seen;
  }

  /** Lowest common ancestors. More than one is conflict C37. */
  mergeBases(a: string, b: string): string[] {
    const ancestorsA = this.ancestorsOf(a);
    const common = [...this.ancestorsOf(b)].filter((id) => ancestorsA.has(id));
    // Drop any candidate that is an ancestor of another candidate.
    return common.filter(
      (candidate) =>
        !common.some((other) => other !== candidate && this.ancestorsOf(other).has(candidate)),
    );
  }

  diff(fromCommit: string, toCommit: string, electricalOnly = false): DiffChange[] {
    return diffSnapshots(this.snapshotOf(fromCommit), this.snapshotOf(toCommit), {
      electricalOnly,
    });
  }

  // ---- writes ------------------------------------------------------------

  /** Store a snapshot, returning both hashes. Stored once per hash. */
  async putSnapshot(
    snapshot: CircuitSnapshot,
  ): Promise<{ snapshotHash: string; electricalHash: string }> {
    const dangling = findDanglingReferences(snapshot);
    if (dangling.length > 0) {
      throw new RepositoryError(
        `Refusing to store a snapshot with dangling references:\n  - ${dangling.join('\n  - ')}`,
      );
    }
    const hashes = await hashSnapshot(snapshot);
    if (!this.snapshots.has(hashes.snapshotHash)) {
      this.snapshots.set(hashes.snapshotHash, structuredClone(snapshot));
    }
    return hashes;
  }

  /**
   * Commit to a branch. `expectedHead` makes this a compare-and-swap: if the
   * branch moved since the client last looked, this throws HeadMovedError
   * rather than silently clobbering the other device's work.
   */
  async commit(branchName: string, input: CommitInput): Promise<Commit> {
    const existing = this.branches.get(branchName);

    if (existing && input.expectedHead !== undefined && existing.head !== input.expectedHead) {
      throw new HeadMovedError(branchName, input.expectedHead, existing.head);
    }

    const { snapshotHash, electricalHash } = await this.putSnapshot(input.snapshot);
    const parents = input.parents ?? (existing ? [existing.head] : []);
    const createdAt = input.createdAt ?? new Date().toISOString();

    const id = await sha256(
      JSON.stringify([parents, snapshotHash, input.message, input.author, createdAt]),
    );

    const commit: Commit = {
      id,
      parents,
      snapshotHash,
      electricalHash,
      message: input.message,
      author: input.author,
      source: input.source,
      createdAt,
      checks: input.checks ?? PENDING,
    };

    this.commits.set(id, commit);
    this.branches.set(branchName, {
      project: this.project,
      name: branchName,
      head: id,
      protected: this.isProtected(branchName),
    });

    return commit;
  }

  createBranch(name: string, fromCommit: string): Branch {
    if (this.branches.has(name)) throw new RepositoryError(`Branch "${name}" already exists`);
    this.getCommit(fromCommit); // existence check
    const branch: Branch = {
      project: this.project,
      name,
      head: fromCommit,
      protected: this.isProtected(name),
    };
    this.branches.set(name, branch);
    return branch;
  }

  renameBranch(from: string, to: string): Branch {
    const branch = this.getBranch(from);
    if (this.branches.has(to)) throw new RepositoryError(`Branch "${to}" already exists`);
    if (branch.protected) throw new RepositoryError(`Branch "${from}" is protected`);
    this.branches.delete(from);
    const renamed: Branch = { ...branch, name: to, protected: this.isProtected(to) };
    this.branches.set(to, renamed);
    return renamed;
  }

  deleteBranch(name: string): void {
    const branch = this.getBranch(name);
    if (branch.protected) throw new RepositoryError(`Branch "${name}" is protected`);
    this.branches.delete(name);
  }

  /**
   * Restore: a new commit whose snapshot equals the target's. It never
   * conflicts, because it does not replay anything — it just re-states a
   * known-good circuit on top of the current head.
   */
  async restore(branchName: string, targetCommit: string, author: string): Promise<Commit> {
    const branch = this.getBranch(branchName);
    const target = this.getCommit(targetCommit);
    return this.commit(branchName, {
      snapshot: this.getSnapshot(target.snapshotHash),
      message: `Restore to ${target.id.slice(0, 7)} — ${target.message}`,
      author,
      source: 'web',
      expectedHead: branch.head,
    });
  }
}
