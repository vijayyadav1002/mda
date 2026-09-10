import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isProtectedMediaPath, isPublicPath } from './protected-path.js';

describe('isPublicPath', () => {
  it('treats /health as public', () => {
    assert.equal(isPublicPath('/health'), true);
  });
});

describe('isProtectedMediaPath', () => {
  it('treats /thumbnails/x as protected', () => {
    assert.equal(isProtectedMediaPath('/thumbnails/x'), true);
  });
});
