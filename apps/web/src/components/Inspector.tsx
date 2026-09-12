import type { ParamDefinition, PartDefinition } from '@circuitgit/schema';
import { pinRef } from '@circuitgit/schema';
import { partLibrary } from '../state/library.js';
import { useStore } from '../state/store.js';
import { formatNumber, formatSi } from '../format.js';

/**
 * The inspector.
 *
 * Parameter controls are generated from each part's `params` schema — there is
 * no UI code for any individual part. Ratings and the citation come straight
 * from the definition too, so what the user sees is what the checks enforce.
 */

function ParamField({
  componentId,
  paramId,
  definition,
  value,
}: {
  componentId: string;
  paramId: string;
  definition: ParamDefinition;
  value: number | string | boolean | undefined;
}) {
  const setParam = useStore((s) => s.setParam);
  const locked = useStore((s) => s.mode === 'simulate');

  if (definition.type === 'boolean') {
    return (
      <label className="switch">
        <input
          type="checkbox"
          checked={value === true}
          disabled={locked}
          onChange={(event) => setParam(componentId, paramId, event.target.checked)}
        />
        <span className="switch__track" aria-hidden="true" />
        <span className="switch__text">
          {definition.label}
          {definition.description && <em>{definition.description}</em>}
        </span>
      </label>
    );
  }

  if (definition.type === 'enum') {
    return (
      <div className="field">
        <span className="field__label">{definition.label}</span>
        <select
          className="select"
          disabled={locked}
          value={String(value ?? definition.default)}
          onChange={(event) => setParam(componentId, paramId, event.target.value)}
        >
          {definition.values.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {definition.description && <span className="field__hint">{definition.description}</span>}
      </div>
    );
  }

  const current = typeof value === 'number' ? value : definition.default;

  return (
    <div className="field">
      <span className="field__label">
        {definition.label}
        <span className="field__unit">{definition.unit}</span>
      </span>
      <input
        className="input"
        type="number"
        disabled={locked}
        value={current}
        min={definition.min}
        max={definition.max}
        step="any"
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) setParam(componentId, paramId, next);
        }}
      />
      <span className="field__hint">
        {formatNumber(current, definition.unit, definition.siPrefix)}
      </span>
      {definition.presets && definition.presets.length > 0 && (
        <div className="presets">
          {definition.presets.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`presets__item${preset === current ? ' presets__item--on' : ''}`}
              disabled={locked}
              onClick={() => setParam(componentId, paramId, preset)}
            >
              {formatNumber(preset, definition.unit, definition.siPrefix)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Ratings({ part }: { part: PartDefinition }) {
  if (part.ratings.length === 0) return null;
  return (
    <div className="inspector__section">
      <h4 className="inspector__heading">Ratings</h4>
      <ul className="ratings">
        {part.ratings.map((rating, index) => (
          <li key={index}>
            <span className="ratings__quantity">{rating.quantity.replace(/_/g, ' ')}</span>
            <span className="ratings__value mono">
              {typeof rating.max === 'number'
                ? `≤ ${formatSi(rating.max, rating.unit)}`
                : 'from ' +
                  ('configRef' in rating.max ? rating.max.configRef : rating.max.paramRef)}
            </span>
          </li>
        ))}
      </ul>
      <p className="inspector__source">{part.source}</p>
    </div>
  );
}

function CircuitDetails() {
  const snapshot = useStore((s) => s.snapshot);
  const setMeta = useStore((s) => s.setMeta);
  const locked = useStore((s) => s.mode === 'simulate');

  return (
    <div className="inspector__body scroll">
      <div className="inspector__section">
        <h4 className="inspector__heading">Circuit</h4>
        <div className="field">
          <span className="field__label">Name</span>
          <input
            className="input"
            disabled={locked}
            value={snapshot.meta.name}
            onChange={(event) => setMeta({ name: event.target.value })}
          />
        </div>
        <div className="field">
          <span className="field__label">What should it do?</span>
          <textarea
            className="input"
            disabled={locked}
            rows={3}
            placeholder="e.g. Blink a red LED about twice a second"
            value={snapshot.meta.intent}
            onChange={(event) => setMeta({ intent: event.target.value })}
          />
          <span className="field__hint">
            Checked against the real circuit by the intent checker once the LLM layer is connected.
          </span>
        </div>
        <div className="field">
          <span className="field__label">Notes</span>
          <textarea
            className="input"
            disabled={locked}
            rows={2}
            value={snapshot.meta.description}
            onChange={(event) => setMeta({ description: event.target.value })}
          />
        </div>
      </div>

      <div className="inspector__section">
        <h4 className="inspector__heading">Ground reference</h4>
        <p className="field__hint">
          {snapshot.settings.ground
            ? 'Set. Select a pin on a part to move it.'
            : 'Not set. Open a part and choose a pin to act as 0 V.'}
        </p>
        {snapshot.settings.ground && <p className="mono">{snapshot.settings.ground}</p>}
      </div>
    </div>
  );
}

/**
 * `embedded`: rendered inside the tabbed right rail (`RightRail`), which
 * already labels this tab "Context" — so the generic "Details" header is
 * skipped. The header for a selected part stays: which part is selected is
 * information, not decoration.
 */
export function Inspector({ embedded = false }: { embedded?: boolean } = {}) {
  const selection = useStore((s) => s.selection);
  const snapshot = useStore((s) => s.snapshot);
  const setLabel = useStore((s) => s.setLabel);
  const setGround = useStore((s) => s.setGround);
  const removeComponent = useStore((s) => s.removeComponent);
  const locked = useStore((s) => s.mode === 'simulate');

  const component = selection ? snapshot.components[selection] : undefined;

  if (!selection || !component || !partLibrary.has(component.part)) {
    return (
      <aside className="inspector panel">
        {!embedded && <div className="panel__header">Details</div>}
        <CircuitDetails />
      </aside>
    );
  }

  const part = partLibrary.get(component.part);
  const params = Object.entries(part.params);

  return (
    <aside className="inspector panel">
      <div className="panel__header">
        {part.name}
        <span className="chip mono">{component.part}</span>
      </div>

      <div className="inspector__body scroll">
        <div className="inspector__section">
          <div className="field">
            <span className="field__label">Label</span>
            <input
              className="input"
              value={component.label}
              disabled={locked}
              onChange={(event) => setLabel(selection, event.target.value)}
            />
          </div>
          <p className="field__hint">{part.description}</p>
        </div>

        {params.length > 0 && (
          <div className="inspector__section">
            <h4 className="inspector__heading">Parameters</h4>
            {params.map(([paramId, definition]) => (
              <ParamField
                key={paramId}
                componentId={selection}
                paramId={paramId}
                definition={definition}
                value={component.params[paramId]}
              />
            ))}
          </div>
        )}

        <div className="inspector__section">
          <h4 className="inspector__heading">Pins</h4>
          <ul className="pins">
            {part.pins.map((pin) => {
              const ref = pinRef(selection, pin.id);
              const isGround = snapshot.settings.ground === ref;
              const wired = Object.values(snapshot.wires).some(
                (wire) => wire.a === ref || wire.b === ref,
              );
              return (
                <li key={pin.id} className="pins__row">
                  <span className="pins__name">
                    {pin.name}
                    {part.requiredPins.includes(pin.id) && <em title="Required">*</em>}
                  </span>
                  <span className={`pins__state${wired ? ' pins__state--wired' : ''}`}>
                    {wired ? 'wired' : 'open'}
                  </span>
                  <button
                    type="button"
                    className={`btn btn--sm${isGround ? ' btn--primary' : ''}`}
                    disabled={locked}
                    onClick={() => setGround(isGround ? undefined : ref)}
                  >
                    {isGround ? 'Ground' : 'Set 0 V'}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {part.polarized && (
          <p className="callout callout--warn">
            Polarised: {part.pins.find((p) => p.id === part.polarized?.positive)?.name} is positive.
          </p>
        )}

        <Ratings part={part} />
      </div>

      <div className="inspector__foot">
        {locked ? (
          <span className="inspector__locked">Read-only while the session runs.</span>
        ) : (
          <button
            type="button"
            className="btn btn--danger-text"
            onClick={() => removeComponent(selection)}
          >
            Delete part
          </button>
        )}
      </div>
    </aside>
  );
}
