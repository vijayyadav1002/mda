import { ClientError, GraphQLClient } from 'graphql-request';

// Cookie sessions require same-origin. VITE_API_URL remains an override;
// do not point it at a different origin if cookies must be sent.
const explicitApiUrl = import.meta.env.VITE_API_URL?.trim();
const SIGNED_IN_FLAG = 'mda_signed_in';

export function getApiUrl() {
  if (explicitApiUrl) return explicitApiUrl.replace(/\/$/, '');
  if (typeof window !== 'undefined') return '';
  return import.meta.env.DEV ? 'http://localhost:4000' : '';
}

export function handleAuthFailure() {
  if (typeof window === 'undefined') return;
  clearAuthToken();
  if (window.location.pathname === '/login') return;
  window.location.assign('/login');
}

export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, { ...init, credentials: 'include' });
  if (response.status === 401) handleAuthFailure();
  return response;
}

function hasUnauthorizedGraphQLError(errors: { message: string }[] | undefined) {
  return Boolean(errors?.some((error) => error.message === 'Unauthorized'));
}

export function createGraphQLClient(_token?: string) {
  const apiUrl = getApiUrl();
  // graphql-request 7 does `new URL(url)` and rejects relative `/graphql`.
  const graphqlUrl = !apiUrl && typeof window !== 'undefined'
    ? `${window.location.origin}/graphql`
    : `${apiUrl}/graphql`;
  return new GraphQLClient(graphqlUrl, {
    credentials: 'include',
    fetch: authFetch,
    responseMiddleware: (response) => {
      if (!(response instanceof ClientError)) return;
      if (response.response.status === 401 || hasUnauthorizedGraphQLError(response.response.errors)) {
        handleAuthFailure();
      }
    },
  });
}

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(SIGNED_IN_FLAG) === '1' ? '1' : null;
}

export function setAuthToken(_token: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SIGNED_IN_FLAG, '1');
}

export function clearAuthToken() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SIGNED_IN_FLAG);
}
