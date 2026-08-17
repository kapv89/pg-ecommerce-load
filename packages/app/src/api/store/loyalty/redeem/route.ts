import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { redeemLoyaltyPointsWorkflow } from "../../../../workflows/redeem-loyalty-points"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const body = req.body as { points: number; description?: string }

  const { result } = await redeemLoyaltyPointsWorkflow(req.scope).run({
    input: {
      customer_id: req.auth_context.actor_id,
      points: body.points,
      description: body.description,
    },
  })

  res.status(201).json({ transaction: result })
}
