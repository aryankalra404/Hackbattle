import { ATTRIBUTION_REQUIRED, type PartDefinition } from '@circuitgit/schema';

/**
 * Asset attribution and licence report.
 *
 * Built from each part's `visual.*` provenance fields, so the report can never
 * disagree with what ships. CI regenerates it and fails if the committed copy is
 * stale; the schema already refuses an asset whose licence needs a credit line
 * and has none.
 */

type Row = {
  part: string;
  kind: '2D symbol' | '3D model';
  file: string;
  source: string;
  license: string;
  attribution: string;
};

function rows(parts: readonly PartDefinition[]): Row[] {
  return parts.flatMap((part) => {
    const { symbol2d, model3d } = part.visual;
    return [
      {
        part: part.id,
        kind: '2D symbol' as const,
        file: symbol2d.path,
        source: symbol2d.source,
        license: symbol2d.license,
        attribution: symbol2d.attribution ?? '',
      },
      {
        part: part.id,
        kind: '3D model' as const,
        file: model3d.path ?? `(placeholder: ${model3d.placeholder ?? 'none'})`,
        source: model3d.source,
        license: model3d.license,
        attribution: model3d.attribution ?? '',
      },
    ];
  });
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim() || '—';

export function assetReport(parts: readonly PartDefinition[]): string {
  const sorted = [...parts].sort((a, b) => a.id.localeCompare(b.id));
  const all = rows(sorted);
  const credited = all.filter((row) =>
    ATTRIBUTION_REQUIRED.some((license) => license === row.license),
  );
  const placeholders = sorted.filter((part) => part.visual.model3d.placeholder);

  const lines = [
    '# Asset attribution and licences',
    '',
    '<!-- Generated from packages/parts/parts/*.yaml by `pnpm assets:report`. Do not edit. -->',
    '',
    `${sorted.length} parts, ${all.length} assets. ` +
      (credited.length === 0
        ? 'None needs an attribution line.'
        : `${credited.length} need an attribution line, and the part schema refuses any that lacks one.`),
    '',
    '## Credits',
    '',
  ];

  if (credited.length === 0) {
    lines.push('No shipped asset currently requires attribution.');
  } else {
    for (const row of credited) {
      lines.push(
        `- ${cell(row.attribution)} — ${row.part} ${row.kind} (${row.license}), ${cell(row.source)}`,
      );
    }
  }

  lines.push(
    '',
    '## All assets',
    '',
    '| Part | Asset | File | Source | Licence | Attribution |',
    '| --- | --- | --- | --- | --- | --- |',
    ...all.map(
      (row) =>
        `| ${row.part} | ${row.kind} | ${cell(row.file)} | ${cell(row.source)} | ${row.license} | ${cell(row.attribution)} |`,
    ),
    '',
    '## Still placeholders',
    '',
    placeholders.length === 0
      ? 'Every part has a real 3D model.'
      : `${placeholders.length} parts use a labelled placeholder in AR instead of a 3D model: ` +
          `${placeholders.map((part) => part.id).join(', ')}.`,
    '',
  );

  return lines.join('\n');
}
