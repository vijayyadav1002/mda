import { GraphQLClient } from 'graphql-request';

const explicitApiUrl = import.meta.env.VITE_API_URL?.trim();

export function getApiUrl() {
  if (explicitApiUrl) {
    return explicitApiUrl.replace(/\/$/, '');
  }

  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:4000`;
  }

  return 'http://localhost:4000';
}

export function createGraphQLClient(token?: string) {
  return new GraphQLClient(`${getApiUrl()}/graphql`, {
    headers: token
      ? {
          authorization: `Bearer ${token}`,
        }
      : {},
  });
}

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token');
}

export function setAuthToken(token: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('auth_token', token);
}

export function clearAuthToken() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('auth_token');
}
