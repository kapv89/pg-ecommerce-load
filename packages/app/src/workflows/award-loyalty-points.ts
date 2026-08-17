import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { LOYALTY_MODULE } from "../modules/loyalty"
import type LoyaltyModuleService from "../modules/loyalty/service"

export type AwardLoyaltyPointsInput = {
  customer_id: string
  order_id: string
  order_total: number
  currency_code: string
}

/** One point per whole unit of currency spent. */
const POINTS_PER_CURRENCY_UNIT = 1

const ensureAccountStep = createStep(
  "ensure-loyalty-account",
  async (input: { customer_id: string }, { container }) => {
    const loyalty: LoyaltyModuleService = container.resolve(LOYALTY_MODULE)

    const existing = await loyalty.listLoyaltyAccounts({
      customer_id: input.customer_id,
    })

    if (existing.length) {
      return new StepResponse(existing[0], null)
    }

    const account = await loyalty.createLoyaltyAccounts({
      customer_id: input.customer_id,
    })

    return new StepResponse(account, account.id)
  },
  async (createdId: string | null | undefined, { container }) => {
    if (!createdId) {
      return
    }
    const loyalty: LoyaltyModuleService = container.resolve(LOYALTY_MODULE)
    await loyalty.deleteLoyaltyAccounts(createdId)
  }
)

const recordEarnStep = createStep(
  "record-loyalty-earn",
  async (
    input: AwardLoyaltyPointsInput & { account_id: string; current_balance: number; current_lifetime: number },
    { container }
  ) => {
    const loyalty: LoyaltyModuleService = container.resolve(LOYALTY_MODULE)

    const points = Math.floor(input.order_total * POINTS_PER_CURRENCY_UNIT)

    const expiresAt = new Date()
    expiresAt.setFullYear(expiresAt.getFullYear() + 1)

    const transaction = await loyalty.createLoyaltyTransactions({
      account_id: input.account_id,
      type: "earn",
      points,
      order_id: input.order_id,
      description: `Earned on order ${input.order_id}`,
      expires_at: expiresAt,
    })

    await loyalty.updateLoyaltyAccounts({
      id: input.account_id,
      points_balance: input.current_balance + points,
      lifetime_points: input.current_lifetime + points,
      last_earned_at: new Date(),
    })

    return new StepResponse(transaction, {
      transaction_id: transaction.id,
      account_id: input.account_id,
      balance: input.current_balance,
      lifetime: input.current_lifetime,
    })
  },
  async (compensation, { container }) => {
    if (!compensation) {
      return
    }
    const loyalty: LoyaltyModuleService = container.resolve(LOYALTY_MODULE)
    await loyalty.deleteLoyaltyTransactions(compensation.transaction_id)
    await loyalty.updateLoyaltyAccounts({
      id: compensation.account_id,
      points_balance: compensation.balance,
      lifetime_points: compensation.lifetime,
    })
  }
)

/**
 * Re-evaluates which tier the account belongs in after the balance moved. Runs on
 * every earn, which is deliberate: it is a read of every tier plus a write, and
 * real loyalty programmes do exactly this on the order-placed path.
 */
const applyTierStep = createStep(
  "apply-loyalty-tier",
  async (input: { account_id: string; lifetime_points: number }, { container }) => {
    const loyalty: LoyaltyModuleService = container.resolve(LOYALTY_MODULE)

    const tiers = await loyalty.listLoyaltyTiers(
      { min_lifetime_points: { $lte: input.lifetime_points } },
      { order: { min_lifetime_points: "DESC" }, take: 1 }
    )

    if (!tiers.length) {
      return new StepResponse(null)
    }

    await loyalty.updateLoyaltyAccounts({
      id: input.account_id,
      tier_id: tiers[0].id,
    })

    return new StepResponse(tiers[0])
  }
)

export const awardLoyaltyPointsWorkflow = createWorkflow(
  "award-loyalty-points",
  (input: AwardLoyaltyPointsInput) => {
    const account = ensureAccountStep({ customer_id: input.customer_id })

    // Step inputs that combine values have to go through transform — the workflow
    // body builds a graph, so `account.points_balance + x` cannot be evaluated inline.
    const earnInput = transform({ input, account }, (data) => ({
      ...data.input,
      account_id: data.account.id,
      current_balance: data.account.points_balance,
      current_lifetime: data.account.lifetime_points,
    }))

    const transaction = recordEarnStep(earnInput)

    const tierInput = transform({ account, transaction }, (data) => ({
      account_id: data.account.id,
      lifetime_points: data.account.lifetime_points + data.transaction.points,
    }))

    applyTierStep(tierInput)

    return new WorkflowResponse(transaction)
  }
)

export default awardLoyaltyPointsWorkflow
