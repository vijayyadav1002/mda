export const SESSION_COOKIE_NAME = 'mda_session';
export const SESSION_MAX_AGE_SECONDS = 2592000;

export function sessionCookieOptions(request: { protocol: string }) {
  return {
    httpOnly: true as const,
    path: '/' as const,
    sameSite: 'lax' as const,
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: request.protocol === 'https',
    signed: false as const,
  };
}

export function clearSessionCookieOptions(request: { protocol: string }) {
  return { ...sessionCookieOptions(request), maxAge: 0 };
}
