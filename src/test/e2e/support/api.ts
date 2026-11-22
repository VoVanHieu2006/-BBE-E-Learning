import { expect, type APIRequestContext, type APIResponse } from '@playwright/test'
import { ACCOUNTS, SEED_PASSWORD, type AccountKey } from './seed'

export type Session = { accessToken: string; refreshToken: string; user: { id: string; role: string; email: string; [key: string]: unknown } }
export type ApiResult<T = any> = { status: number; body: T; headers: Record<string, string>; response: APIResponse }

export const NO_SESSION_COOKIE = 'e2e_isolated=1'

async function result(response: APIResponse): Promise<ApiResult> {
  const text = await response.text()
  let body: unknown = text
  try { body = text ? JSON.parse(text) : null } catch { /* non-JSON body stays as text */ }
  return { status: response.status(), body, headers: response.headers(), response }
}

export class Api {
  constructor(private readonly request: APIRequestContext, readonly token?: string) {}
  // Playwright's request fixture keeps cookies set by earlier logins; an explicit Cookie header replaces that
  // jar, so every call carries exactly the identity this Api was built with (none for a guest).
  private headers() { return { Cookie: NO_SESSION_COOKIE, ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) } }
  get(path: string) { return this.request.get(path, { headers: this.headers() }).then(result) }
  delete(path: string) { return this.request.delete(path, { headers: this.headers() }).then(result) }
  post(path: string, data?: unknown) { return this.request.post(path, { headers: this.headers(), data: data ?? {} }).then(result) }
  put(path: string, data?: unknown) { return this.request.put(path, { headers: this.headers(), data: data ?? {} }).then(result) }
  patch(path: string, data?: unknown) { return this.request.patch(path, { headers: this.headers(), data: data ?? {} }).then(result) }
}

export function guest(request: APIRequestContext) { return new Api(request) }

export async function tryLogin(request: APIRequestContext, email: string, password: string) {
  return result(await request.post('/api/v1/auth/login', { headers: { Cookie: NO_SESSION_COOKIE }, data: { email, password } }))
}

export async function login(request: APIRequestContext, email: string, password = SEED_PASSWORD): Promise<Session> {
  const { status, body } = await tryLogin(request, email, password)
  expect(status, `login ${email}: ${JSON.stringify(body)}`).toBe(200)
  return body as Session
}

const sessions = new Map<string, Session>()
// Seeded accounts are reused across specs; access tokens live 15 minutes, so cache briefly.
export async function as(request: APIRequestContext, account: AccountKey): Promise<Api & { session: Session }> {
  const cached = sessions.get(account)
  const fresh = cached && Date.now() - (cached as any).issuedAt < 10 * 60 * 1000 ? cached : await login(request, ACCOUNTS[account])
  if (fresh !== cached) { (fresh as any).issuedAt = Date.now(); sessions.set(account, fresh) }
  return Object.assign(new Api(request, fresh.accessToken), { session: fresh })
}

export function errorCode(result: ApiResult) { return result.body?.error?.code as string | undefined }
