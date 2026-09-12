import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ATTRIBUTION_REQUIRED } from '@circuitgit/schema';
import { repoRoot } from '@circuitgit/schema/node';
import { assetReport } from '@circuitgit/parts';
import { loadPartLibraryFromDisk } from '@circuitgit/parts/node';

/**
 * Every asset a part references exists, says where it came from, and carries
 * the credit its licence demands. The committed ASSETS.md must match what the
 * part files say; regenerate it with `pnpm assets:report`.
 */

const library = loadPartLibraryFromDisk();
const partsPackage = join(repoRoot(), 'packages/parts');

describe('part assets', () => {
  for (const part of library.all()) {
    it(`${part.id} ships real, credited assets`, () => {
      const { symbol2d, model3d } = part.visual;
      expect(existsSync(join(partsPackage, symbol2d.path)), `${symbol2d.path} missing`).toBe(true);
      if (model3d.path) {
        expect(existsSync(join(partsPackage, model3d.path)), `${model3d.path} missing`).toBe(true);
      }
      for (const asset of [symbol2d, model3d]) {
        if (ATTRIBUTION_REQUIRED.includes(asset.license)) {
          expect(asset.attribution, `${part.id}: ${asset.license} needs attribution`).toBeTruthy();
        }
      }
    });
  }

  it('ASSETS.md is up to date', async () => {
    await expect(assetReport(library.all())).toMatchFileSnapshot(join(repoRoot(), 'ASSETS.md'));
  });
});
