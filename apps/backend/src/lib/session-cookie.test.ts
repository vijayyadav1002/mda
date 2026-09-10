import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sessionCookieOptions } from './session-cookie.js';

describe('sessionCookieOptions', () => {
  it('sets Secure on HTTPS and not on HTTP', () => {
    const httpsOpts = sessionCookieOptions({ protocol: 'https' });
    assert.equal(httpsOpts.secure, true);
    assert.equal(httpsOpts.httpOnly, true);
    assert.equal(httpsOpts.path, '/');
    assert.equal(httpsOpts.sameSite, 'lax');
    assert.equal(httpsOpts.maxAge, 2592000);
    const httpOpts = sessionCookieOptions({ protocol: 'http' });
    assert.equal(httpOpts.secure, false);
  });
});
