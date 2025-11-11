import { describe, it, expect } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('p-2', 'text-sm')).toBe('p-2 text-sm');
  });

  it('dedupes and merges conditionals', () => {
    const truthy = true;
    const falsy = false;
    // clsx compacts falsy values
    expect(cn('p-2', falsy && 'hidden', truthy && 'block')).toBe('p-2 block');
  });
});