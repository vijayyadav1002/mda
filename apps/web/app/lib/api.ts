import { GraphQLClient } from 'graphql-request';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export function createGraphQLClient(token?: string) {
  return new GraphQLClient(`${API_URL}/graphql`, {
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
