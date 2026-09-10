import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shouldSlideSession } from './slide-session.js';

describe('shouldSlideSession', () => {
  it('does not slide GET /thumbnails/x', () => {
    assert.equal(shouldSlideSession('GET', '/thumbnails/x'), false);
  });

  it('slides POST /api/upload', () => {
    assert.equal(shouldSlideSession('POST', '/api/upload'), true);
  });

  it('does not slide GET /download-zip', () => {
    assert.equal(shouldSlideSession('GET', '/download-zip'), false);
  });

  it('slides PUT /file-preview/1/content', () => {
    assert.equal(shouldSlideSession('PUT', '/file-preview/1/content'), true);
  });
});
