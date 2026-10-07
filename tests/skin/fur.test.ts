import { describe, expect, it } from 'vitest';
import { furShellOffsets } from '../../src/skin/fur';

describe('furShellOffsets', () => {
  it('rises to the fur length, packed closer near the skin', () => {
    const o = furShellOffsets(16, 0.04);
    expect(o).toHaveLength(16);
    for (let i = 1; i < o.length; i++) expect(o[i]).toBeGreaterThan(o[i - 1]);
    expect(o[15]).toBeCloseTo(0.04, 10);
    expect(o[1] - o[0]).toBeLessThan(o[15] - o[14]);
  });
});
