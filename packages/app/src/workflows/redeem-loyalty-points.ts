import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { LOYALTY_MODULE } from "../modules/loyalty"
import type LoyaltyModuleService from "../modules/loyalty/service"

export type RedeemLoyaltyPointsInput = {
  customer_id: string
  points: number
  description?: string
}

const loadAccountStep = createStep(
  "load-loyalty-account",
  async (input: { customer_id: string }, { container }) => {
    const loyalty: LoyaltyModuleService = container.resolve(LOYALTY_MODULE)

    const [account] = await loyalty.listLoyaltyAccounts(
      { customer_id: input.customer_id },
      { relations: ["tier"] }
    )

    if (!account) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `No loyalty account for customer ${input.customer_id}`
      )
    }

    return new StepResponse(account)
  }
)

const redeemStep = createStep(
  "redeem-loyalty-points",
  async (
    input: { account_id: string; balance: number; points: number; description?: string },
    { container }
  ) => {
    if (input.points > input.balance) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Cannot redeem ${input.points} points against a balance of ${input.balance}`
      )
    }

    const loyalty: LoyaltyModuleService = container.resolve(LOYALTY_MODULE)

    const transaction = await loyalty.createLoyaltyTransactions({
      account_id: input.account_id,
      type: "redeem",
      points: -input.points,
      description: input.description ?? "Points redeemed",
    })

    await loyalty.updateLoyaltyAccounts({
      id: input.account_id,
      points_balance: input.balance - input.points,
    })

    return new StepResponse(transaction, {
      transaction_id: transaction.id,
      account_id: input.account_id,
      balance: input.balance,
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
    })
  }
)

export const redeemLoyaltyPointsWorkflow = createWorkflow(
  "redeem-loyalty-points",
  (input: RedeemLoyaltyPointsInput) => {
    const account = loadAccountStep({ customer_id: input.customer_id })

    const transaction = redeemStep(
      transform({ input, account }, (data) => ({
        account_id: data.account.id,
        balance: data.account.points_balance,
        points: data.input.points,
        description: data.input.description,
      }))
    )

    return new WorkflowResponse(transaction)
  }
)

export default redeemLoyaltyPointsWorkflow
