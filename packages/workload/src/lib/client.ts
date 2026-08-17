import { createRng, type Rng } from "./random"

export type Metrics = {
  record(op: string, ms: number, ok: boolean, pid: string | null): void
}

export type ClientOptions = {
  baseUrl: string
  publishableKey: string
  metrics: Metrics
}

/**
 * Thin HTTP client that records every call against a named operation.
 *
 * Naming the operation rather than the URL is deliberate: a product detail page
 * is one operation whether it is the tenth product or the ten-thousandth, so the
 * report groups by intent instead of by path.
 */
export class StoreClient {
  readonly baseUrl: string
  readonly rng: Rng

  private publishableKey: string
  private metrics: Metrics
  private customerToken: string | null = null

  constructor(options: ClientOptions, seed: number) {
    this.baseUrl = options.baseUrl
    this.publishableKey = options.publishableKey
    this.metrics = options.metrics
    this.rng = createRng(seed)
  }

  setCustomerToken(token: string | null): void {
    this.customerToken = token
  }

  get isAuthenticated(): boolean {
    return Boolean(this.customerToken)
  }

  async call<T = any>(
    op: string,
    method: string,
    path: string,
    options: { body?: unknown; auth?: boolean; token?: string } = {}
  ): Promise<T | null> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-publishable-api-key": this.publishableKey,
    }

    const token = options.token ?? (options.auth ? this.customerToken : null)
    if (token) {
      headers.authorization = `Bearer ${token}`
    }

    const startedAt = performance.now()

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      })

      const pid = res.headers.get("x-medusa-pid")
      const contentType = res.headers.get("content-type") ?? ""
      const isJson = contentType.includes("application/json")
      const payload = isJson ? await res.json() : (await res.arrayBuffer(), null)

      this.metrics.record(op, performance.now() - startedAt, res.ok, pid)

      return res.ok ? (payload as T) : null
    } catch {
      this.metrics.record(op, performance.now() - startedAt, false, null)
      return null
    }
  }
}
