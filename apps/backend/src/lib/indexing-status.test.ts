import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getIndexingStatus,
  markIndexingFailed,
  markIndexingStarted,
  markIndexingSucceeded,
} from './indexing-status.js';

describe('indexing status', () => {
  it('is idle by default', () => {
    assert.deepEqual(getIndexingStatus(), { indexing: false, indexError: null });
  });

  it('is started after markIndexingStarted', () => {
    markIndexingStarted();
    assert.deepEqual(getIndexingStatus(), { indexing: true, indexError: null });
  });

  it('is success after markIndexingSucceeded', () => {
    markIndexingStarted();
    markIndexingSucceeded();
    assert.deepEqual(getIndexingStatus(), { indexing: false, indexError: null });
  });

  it('is failed after markIndexingFailed', () => {
    markIndexingStarted();
    markIndexingFailed('boom');
    assert.deepEqual(getIndexingStatus(), { indexing: false, indexError: 'boom' });
  });
});
