import { useMemo, useState } from 'react';
import type { PartDefinition } from '@circuitgit/schema';
import { partLibrary, partSymbols } from '../state/library.js';
import { useStore } from '../state/store.js';

/**
 * The parts palette.
 *
 * Built entirely from the part library: categories come from each definition's
 * `category` field, so a new part file appears here with no code change.
 */

function PartChip({ part }: { part: PartDefinition }) {
  const addComponent = useStore((s) => s.addComponent);
  const locked = useStore((s) => s.mode === 'simulate');
  const svg = partSymbols[part.visual.symbol2d.path];

  return (
    <button
      type="button"
      className="part-chip"
      disabled={locked}
      draggable={!locked}
      title={`${part.description}\n\nSource: ${part.source}`}
      style={{ '--part-accent': part.visual.accent } as React.CSSProperties}
      onDragStart={(event) => {
        event.dataTransfer.setData('application/circuitgit-part', `${part.id}@${part.version}`);
        event.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() =>
        addComponent(part, { x: 120 + Math.random() * 160, y: 80 + Math.random() * 160 })
      }
    >
      <span
        className="part-chip__symbol"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: svg ?? '' }}
      />
      <span className="part-chip__text">
        <span className="part-chip__name">{part.name}</span>
        <span className="part-chip__pins">
          {part.pins.length} pin{part.pins.length === 1 ? '' : 's'}
        </span>
      </span>
    </button>
  );
}

/** Thin rail shown in place of the palette when it is collapsed. */
function CollapsedRail() {
  const togglePalette = useStore((s) => s.togglePalette);

  return (
    <aside className="palette-rail">
      <button
        type="button"
        className="palette-rail__button"
        onClick={togglePalette}
        title="Show the parts panel"
        aria-expanded={false}
      >
        <span aria-hidden="true">›</span>
        <span className="palette-rail__text">Parts</span>
        <span className="chip">{partLibrary.all().length}</span>
      </button>
    </aside>
  );
}

export function Palette() {
  const [query, setQuery] = useState('');
  const paletteOpen = useStore((s) => s.paletteOpen);
  const togglePalette = useStore((s) => s.togglePalette);
  const locked = useStore((s) => s.mode === 'simulate');

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return partLibrary
      .categories()
      .map((group) => ({
        ...group,
        parts: group.parts.filter(
          (part) =>
            needle === '' ||
            part.name.toLowerCase().includes(needle) ||
            part.description.toLowerCase().includes(needle) ||
            part.category.toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.parts.length > 0);
  }, [query]);

  if (!paletteOpen) return <CollapsedRail />;

  return (
    <aside className={`palette panel${locked ? ' palette--locked' : ''}`}>
      <div className="panel__header">
        Parts
        <span className="panel__header-actions">
          <span className="chip">{partLibrary.all().length}</span>
          <button
            type="button"
            className="btn btn--ghost btn--sm panel__collapse"
            onClick={togglePalette}
            title="Hide the parts panel"
            aria-expanded
          >
            <span aria-hidden="true">‹</span>
            <span className="visually-hidden">Hide parts panel</span>
          </button>
        </span>
      </div>

      <div className="palette__search">
        <input
          className="input"
          type="search"
          placeholder="Search parts…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="palette__list scroll">
        {groups.length === 0 && <p className="empty">No parts match “{query}”.</p>}
        {groups.map((group) => (
          <section key={group.category} className="palette__group">
            <h3 className="palette__category">{group.category}</h3>
            {group.parts.map((part) => (
              <PartChip key={part.id} part={part} />
            ))}
          </section>
        ))}
      </div>

      <p className="palette__foot">
        {locked
          ? 'Locked while the session runs. Stop it to add parts.'
          : 'Drag onto the canvas, or click to drop one in.'}
      </p>
    </aside>
  );
}
