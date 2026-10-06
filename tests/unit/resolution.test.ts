import { describe, expect, it } from 'vitest';
import { MAX_RENDER_RESOLUTION, renderResolution } from '../../src/render/resolution';

describe('renderResolution', () => {
  it('follows the device pixel ratio between 1 and the cap', () => {
    expect(renderResolution(1)).toBe(1);
    expect(renderResolution(1.5)).toBe(1.5);
    expect(renderResolution(2)).toBe(2);
    expect(renderResolution(3)).toBe(MAX_RENDER_RESOLUTION);
  });

  it('falls back to 1 for low or invalid ratios', () => {
    expect(renderResolution(0.5)).toBe(1);
    expect(renderResolution(0)).toBe(1);
    expect(renderResolution(Number.NaN)).toBe(1);
    expect(renderResolution(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
