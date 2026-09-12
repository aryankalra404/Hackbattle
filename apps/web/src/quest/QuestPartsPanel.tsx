import { PART_DEFS, type PartDef } from '../parts/catalog.js';
import { useCircuitEditor } from './CircuitEditorContext.js';

/**
 * The Parts tab: every drawn part, ready to be dragged onto the canvas or
 * clicked to drop one in. A part added here goes out over the bridge as a
 * `circuit:update` like any other edit, so a connected headset spawns the same
 * component — see `QuestCircuitBridge.ApplyRemoteCircuit`.
 */

/** The drag payload. A private MIME type keeps the canvas from accepting stray drags. */
export const PART_DRAG_TYPE = 'application/x-circuitgit-part';

function pinSummary(def: PartDef): string {
  if (def.holes.length === 0) return 'no terminals';
  const terminals = new Set(def.holes.map((hole) => hole.pin));
  return terminals.size === 1 ? '1 terminal' : `${terminals.size} terminals`;
}

function PartCard({
  def,
  disabled,
  onAdd,
}: {
  def: PartDef;
  disabled: boolean;
  onAdd: (def: PartDef) => void;
}) {
  return (
    <button
      type="button"
      className="parts__item"
      // The artwork is inline SVG; without an explicit label its text nodes run
      // into the label and the button announces as "Arduino Uno29 terminals".
      aria-label={`${def.label}, ${pinSummary(def)}`}
      draggable={!disabled}
      disabled={disabled}
      onDragStart={(event) => {
        event.dataTransfer.setData(PART_DRAG_TYPE, def.type);
        event.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => onAdd(def)}
      title={
        disabled
          ? `The circuit already has a ${def.label}; the bridge carries one board.`
          : (def.note ?? `Drag ${def.label} onto the canvas, or click to drop one in`)
      }
    >
      <span
        className="parts__art"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: def.art }}
      />
      <span className="parts__meta">
        <span className="parts__label">{def.label}</span>
        <span className="parts__pins">{pinSummary(def)}</span>
      </span>
    </button>
  );
}

export function QuestPartsPanel() {
  const { addPart, boardPlaced } = useCircuitEditor();

  return (
    <div className="parts">
      <p className="parts__hint">
        Drag a part onto the canvas, or click to drop one in. Then drag pin to pin to wire it up.
      </p>
      <div className="parts__grid" role="toolbar" aria-label="Parts">
        {PART_DEFS.map((def) => (
          <PartCard
            key={def.type}
            def={def}
            disabled={def.board === true && boardPlaced}
            onAdd={addPart}
          />
        ))}
      </div>
    </div>
  );
}
