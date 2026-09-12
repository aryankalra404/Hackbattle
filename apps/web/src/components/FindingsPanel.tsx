import { useStore } from '../state/store.js';

/**
 * Live rule findings.
 *
 * These are structured findings from the generic rule engine — each one knows
 * which components it points at, so clicking selects and highlights them.
 */
/**
 * `embedded`: rendered inside the tabbed right rail (`RightRail`), which
 * already labels this tab "Checks" and shows the same pass/fail badge on the
 * tab itself — so the in-panel header is skipped to avoid saying it twice.
 */
export function FindingsPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const findings = useStore((s) => s.findings);
  const deferred = useStore((s) => s.deferred);
  const select = useStore((s) => s.select);
  const snapshot = useStore((s) => s.snapshot);

  const errors = findings.filter((finding) => finding.severity === 'error');

  return (
    <section className="findings panel">
      {!embedded && (
        <div className="panel__header">
          Checks
          {findings.length === 0 ? (
            <span className="badge badge--pass">clear</span>
          ) : (
            <span className={`badge badge--${errors.length > 0 ? 'fail' : 'warn'}`}>
              {findings.length}
            </span>
          )}
        </div>
      )}

      <div className="findings__list scroll">
        {findings.length === 0 && (
          <p className="empty">
            {Object.keys(snapshot.components).length === 0
              ? 'Add a part to start checking.'
              : 'No topology problems found.'}
          </p>
        )}

        {findings.map((finding, index) => (
          <button
            key={index}
            type="button"
            className={`finding finding--${finding.severity}`}
            onClick={() => finding.componentIds[0] && select(finding.componentIds[0])}
          >
            <span className="finding__kind">{finding.kind.replace(/_/g, ' ')}</span>
            <span className="finding__message">{finding.message}</span>
            {finding.measured !== undefined && finding.limit !== undefined && (
              <span className="finding__numbers mono">
                {finding.measured} / {finding.limit} {finding.unit}
              </span>
            )}
          </button>
        ))}
      </div>

      {deferred.length > 0 && (
        <div className="findings__deferred">
          <span className="findings__deferred-title">Waiting on the simulator</span>
          <ul>
            {deferred.map((entry) => (
              <li key={entry.kind}>
                <span className="badge badge--pending">{entry.kind.replace(/_/g, ' ')}</span>
              </li>
            ))}
          </ul>
          <p className="field__hint">
            These checks need measured values. They stay pending rather than reporting a pass.
          </p>
        </div>
      )}
    </section>
  );
}
