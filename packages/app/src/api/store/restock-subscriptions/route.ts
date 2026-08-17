import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { RESTOCK_MODULE } from "../../../modules/restock"
import type RestockModuleService from "../../../modules/restock/service"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const restock: RestockModuleService = req.scope.resolve(RESTOCK_MODULE)
  const email = req.query.email as string

  const subscriptions = await restock.listRestockSubscriptions(
    { email, status: "active" },
    { order: { created_at: "DESC" } }
  )

  res.json({ subscriptions })
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const restock: RestockModuleService = req.scope.resolve(RESTOCK_MODULE)
  const body = req.body as {
    variant_id: string
    product_id: string
    email: string
    sales_channel_id?: string
  }

  const existing = await restock.listRestockSubscriptions({
    variant_id: body.variant_id,
    email: body.email,
    status: "active",
  })

  if (existing.length) {
    res.status(200).json({ subscription: existing[0], created: false })
    return
  }

  const subscription = await restock.createRestockSubscriptions({
    ...body,
    customer_id: req.auth_context?.actor_id ?? null,
  })

  res.status(201).json({ subscription, created: true })
}
