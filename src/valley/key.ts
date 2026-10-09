import { hash } from '../util/hash';
import { GENERATOR_VERSION, type Layout } from './types';

/**
 * The cache key: changes with the layout, the grid size and the generator version. Kept apart from the generator so the
 * page's cache lookup does not bundle the generator (which runs in the worker).
 */
export const cacheKey = (layout: Layout, grid: number, version = GENERATOR_VERSION) => hash({ layout, grid, v: version });
