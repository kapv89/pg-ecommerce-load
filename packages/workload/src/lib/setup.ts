export type AdminSession = { token: string; publishableKey: string }

export type Catalogue = {
  productIds: string[]
  productHandles: string[]
  categoryIds: string[]
  variantIds: string[]
}

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@ecommerce-load.local"
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "supersecret"

export async function authenticateAdmin(baseUrl: string): Promise<AdminSession> {
  const auth = await fetch(`${baseUrl}/auth/user/emailpass`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })

  if (!auth.ok) {
    throw new Error(
      `Could not authenticate as ${ADMIN_EMAIL}.\n` +
        `  cd packages/app && npx medusa user -e ${ADMIN_EMAIL} -p ${ADMIN_PASSWORD}`
    )
  }

  const { token } = (await auth.json()) as { token: string }

  const keys = await fetch(`${baseUrl}/admin/api-keys?type=publishable&limit=1`, {
    headers: { authorization: `Bearer ${token}` },
  })
  const body = (await keys.json()) as { api_keys?: { token: string }[] }
  const publishableKey = body.api_keys?.[0]?.token

  if (!publishableKey) {
    throw new Error("No publishable API key — run the seed first.")
  }

  return { token, publishableKey }
}

/**
 * One catalogue snapshot shared by every virtual user.
 *
 * Fetched once rather than per session on purpose: browsing should hit the
 * catalogue the way visitors do, and paying for discovery inside every session
 * would swamp the traffic mix with listing calls.
 */
export async function loadCatalogue(
  baseUrl: string,
  publishableKey: string,
  size = 120
): Promise<Catalogue> {
  const headers = { "x-publishable-api-key": publishableKey }

  const products = await fetch(
    `${baseUrl}/store/products?limit=${size}&fields=id,handle,*variants`,
    { headers }
  )
  const productBody = (await products.json()) as {
    products?: { id: string; handle: string; variants?: { id: string }[] }[]
  }

  const categories = await fetch(`${baseUrl}/store/product-categories?limit=40`, {
    headers,
  })
  const categoryBody = (await categories.json()) as {
    product_categories?: { id: string }[]
  }

  const list = productBody.products ?? []

  if (!list.length) {
    throw new Error("Catalogue is empty — run the seed first.")
  }

  return {
    productIds: list.map((p) => p.id),
    productHandles: list.map((p) => p.handle),
    categoryIds: (categoryBody.product_categories ?? []).map((c) => c.id),
    variantIds: list.flatMap((p) => (p.variants ?? []).map((v) => v.id)),
  }
}

/**
 * A pool of signed-in shoppers.
 *
 * Registration is idempotent in effect — if the identity already exists we log
 * in instead — so repeated runs reuse the same accounts and the customer table
 * does not grow by the pool size on every run.
 */
export async function buildCustomerPool(
  baseUrl: string,
  publishableKey: string,
  size: number
): Promise<string[]> {
  const headers = {
    "content-type": "application/json",
    "x-publishable-api-key": publishableKey,
  }

  const tokens = await Promise.all(
    Array.from({ length: size }, async (_, i) => {
      const email = `shopper${i}@ecommerce-load.test`
      const password = "supersecret"
      const credentials = JSON.stringify({ email, password })

      const registered = await fetch(
        `${baseUrl}/auth/customer/emailpass/register`,
        { method: "POST", headers, body: credentials }
      )

      // The token registration hands back is only good for creating the
      // customer record. Using it for authenticated store routes fails, so log
      // in afterwards regardless of which branch we took and return that token.
      if (registered.ok) {
        const { token: registrationToken } = (await registered.json()) as {
          token: string
        }
        await fetch(`${baseUrl}/store/customers`, {
          method: "POST",
          headers: { ...headers, authorization: `Bearer ${registrationToken}` },
          body: JSON.stringify({
            email,
            first_name: "Load",
            last_name: `Shopper${i}`,
          }),
        })
      }

      const loggedIn = await fetch(`${baseUrl}/auth/customer/emailpass`, {
        method: "POST",
        headers,
        body: credentials,
      })

      if (!loggedIn.ok) {
        return null
      }

      const { token } = (await loggedIn.json()) as { token: string }
      return token
    })
  )

  return tokens.filter((token): token is string => Boolean(token))
}

export async function getRegionId(
  baseUrl: string,
  publishableKey: string
): Promise<string | null> {
  const res = await fetch(`${baseUrl}/store/regions`, {
    headers: { "x-publishable-api-key": publishableKey },
  })
  const body = (await res.json()) as { regions?: { id: string }[] }
  return body.regions?.[0]?.id ?? null
}
