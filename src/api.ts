import type { AppState, AuthUser } from './types'

type ApiErrorPayload = {
  error?: string
}

export type AppHealth = {
  ok: true
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init?.headers ?? {}),
    },
  })

  const contentType = response.headers.get('content-type') ?? ''
  const isJson = contentType.includes('application/json')
  const data = isJson ? ((await response.json()) as T | ApiErrorPayload) : null

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `Request failed with status ${response.status}`
    throw new Error(message)
  }

  return data as T
}

export function getSession() {
  return request<{ user: AuthUser | null }>('/api/auth/session')
}

export function fetchHealth() {
  return request<AppHealth>('/api/health')
}

export function register(payload: { email: string; name: string; password: string }) {
  return request<{ user: AuthUser }>('/api/auth/register', {
    body: JSON.stringify(payload),
    method: 'POST',
  })
}

export function login(payload: { email: string; password: string }) {
  return request<{ user: AuthUser }>('/api/auth/login', {
    body: JSON.stringify(payload),
    method: 'POST',
  })
}

export function fetchRemoteState() {
  return request<{ state: AppState | null }>('/api/app-state')
}

export function saveRemoteState(state: AppState) {
  return request<{ ok: true; savedAt: string }>('/api/app-state', {
    body: JSON.stringify({ state }),
    method: 'PUT',
  })
}
