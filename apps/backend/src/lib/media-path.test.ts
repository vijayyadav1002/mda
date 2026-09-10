import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { isValidAssetId, resolveWithinRoot, joinWithinRoot } from './media-path.js';

describe('isValidAssetId', () => {
  it('accepts positive integers', () => {
    assert.equal(isValidAssetId('1'), true);
    assert.equal(isValidAssetId('42'), true);
  });
  it('rejects zero, decimals, text, and traversal', () => {
    assert.equal(isValidAssetId('0'), false);
    assert.equal(isValidAssetId('abc'), false);
    assert.equal(isValidAssetId('1.2'), false);
    assert.equal(isValidAssetId('../2'), false);
  });
});

describe('resolveWithinRoot', () => {
  const root = path.resolve('/data/media');
  it('allows paths inside root', () => {
    assert.equal(resolveWithinRoot(root, path.join(root, 'a.jpg')), path.resolve(root, 'a.jpg'));
  });
  it('returns null for .. and absolute escapes', () => {
    assert.equal(resolveWithinRoot(root, path.join(root, '..', 'etc', 'passwd')), null);
    assert.equal(resolveWithinRoot(root, '/etc/passwd'), null);
  });
});

describe('joinWithinRoot', () => {
  const root = path.resolve('/data/media');
  it('joins segments inside root', () => {
    assert.equal(joinWithinRoot(root, 'hls', '12', 'master.m3u8'), path.join(root, 'hls', '12', 'master.m3u8'));
  });
  it('throws when segments escape root', () => {
    assert.throws(() => joinWithinRoot(root, '..', 'etc'), /Path escapes allowed root/);
  });
});
