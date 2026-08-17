import { authenticateAdmin } from "./setup"

const SALE_NAME = "Black Friday"

type SaleEvent = { id: string; name: string; status: string }

/**
 * Turns the anomaly on and off.
 *
 * The switch is a row, not a deployment: same build, same routes, same traffic
 * driver. That is what makes the two runs comparable — anything the triage
 * systems see differently has to come from the workload, not from the system
 * under it being a different system.
 */
export async function setSaleActive(
  baseUrl: string,
  active: boolean
): Promise<SaleEvent | null> {
  const { token } = await authenticateAdmin(baseUrl)
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  }

  const listed = await fetch(`${baseUrl}/admin/sale-events?limit=50`, { headers })
  const body = (await listed.json()) as { sale_events?: SaleEvent[] }
  let event = body.sale_events?.find((e) => e.name === SALE_NAME)

  if (!event) {
    if (!active) {
      return null
    }
    const created = await fetch(`${baseUrl}/admin/sale-events`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: SALE_NAME,
        status: "scheduled",
        discount_percentage: 30,
        allocation_total: 250000,
      }),
    })
    const createdBody = (await created.json()) as { sale_event: SaleEvent }
    event = createdBody.sale_event
  }

  const updated = await fetch(`${baseUrl}/admin/sale-events/${event.id}`, {
    method: "POST",
    headers,
    body: JSON.stringify(
      active
        ? { status: "active", starts_at: new Date().toISOString() }
        : { status: "ended" }
    ),
  })

  const updatedBody = (await updated.json()) as { sale_event: SaleEvent }
  return updatedBody.sale_event
}

export async function getSaleState(baseUrl: string): Promise<SaleEvent | null> {
  const { token } = await authenticateAdmin(baseUrl)
  const res = await fetch(`${baseUrl}/admin/sale-events?status=active`, {
    headers: { authorization: `Bearer ${token}` },
  })
  const body = (await res.json()) as { sale_events?: SaleEvent[] }
  return body.sale_events?.[0] ?? null
}
