import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseSearchTerm,
  toLikePattern,
  toDirLikePattern,
  buildNameMatcher,
} from './search-query.js';

describe('parseSearchTerm', () => {
  it('parses type, tag, ext, and size operators', () => {
    const parsed = parseSearchTerm('type:image tag:holiday ext:jpg size:>10mb size:<500kb rest');
    assert.equal(parsed.type, 'image');
    assert.equal(parsed.tag, 'holiday');
    assert.equal(parsed.ext, 'jpg');
    assert.equal(parsed.minSize, 10 * 1024 * 1024);
    assert.equal(parsed.maxSize, 500 * 1024);
    assert.equal(parsed.nameTerm, 'rest');
  });
  it('parses quoted in: and slash folder syntax', () => {
    const quoted = parseSearchTerm('in:"summer trip" photo');
    assert.deepEqual(quoted.dirTerms, ['summer trip']);
    assert.equal(quoted.nameTerm, 'photo');
    const slash = parseSearchTerm('vacation/beach');
    assert.deepEqual(slash.dirTerms, ['vacation']);
    assert.equal(slash.nameTerm, 'beach');
  });
  it('leaves unknown keys as literal text', () => {
    const parsed = parseSearchTerm('foo:bar hello');
    assert.equal(parsed.nameTerm, 'foo:bar hello');
  });
});

describe('toLikePattern / toDirLikePattern / buildNameMatcher', () => {
  it('uses contains without wildcards and raw pattern with wildcards', () => {
    assert.equal(toLikePattern('cat'), '%cat%');
    assert.equal(toLikePattern('*.jpg'), '%.jpg');
    assert.equal(toDirLikePattern('beach'), '%beach%/%');
  });
  it('matches folder names with contains or wildcards', () => {
    const contains = buildNameMatcher(['Beach']);
    assert.equal(contains('summer-beach'), true);
    const wild = buildNameMatcher(['vac*']);
    assert.equal(wild('vacation'), true);
    assert.equal(wild('trip'), false);
  });
});
