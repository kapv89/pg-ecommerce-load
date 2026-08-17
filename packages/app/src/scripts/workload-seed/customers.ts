import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createCustomerGroupsWorkflow,
  createCustomersWorkflow,
  linkCustomersToCustomerGroupWorkflow,
} from "@medusajs/medusa/core-flows"
import { LOYALTY_MODULE } from "../../modules/loyalty"
import type LoyaltyModuleService from "../../modules/loyalty/service"
import type { Rng } from "./random"
import { CITIES, FIRST_NAMES, LAST_NAMES } from "./vocabulary"

export const CUSTOMER_COUNT = 120

const GROUPS = ["VIP", "Wholesale", "Newsletter", "Lapsed", "Staff"] as const

const TIERS = [
  { name: "Bronze", code: "bronze", min_lifetime_points: 0, discount_percentage: 0 },
  { name: "Silver", code: "silver", min_lifetime_points: 500, discount_percentage: 5 },
  { name: "Gold", code: "gold", min_lifetime_points: 2000, discount_percentage: 10 },
  { name: "Platinum", code: "platinum", min_lifetime_points: 5000, discount_percentage: 15 },
] as const

export type CustomerResult = {
  customerIds: string[]
  customerEmails: string[]
  groupIds: string[]
  tierIds: string[]
}

export async function seedCustomers(
  container: MedusaContainer,
  rng: Rng
): Promise<CustomerResult> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const loyalty: LoyaltyModuleService = container.resolve(LOYALTY_MODULE)

  logger.info("Seeding loyalty tiers...")
  const tiers = await loyalty.createLoyaltyTiers(TIERS.map((t) => ({ ...t })))

  logger.info("Seeding customer groups...")
  const { result: groups } = await createCustomerGroupsWorkflow(container).run({
    input: { customersData: GROUPS.map((name) => ({ name })) },
  })

  logger.info(`Seeding ${CUSTOMER_COUNT} customers...`)
  const customersInput = Array.from({ length: CUSTOMER_COUNT }, (_, i) => {
    const first = rng.pick(FIRST_NAMES)
    const last = rng.pick(LAST_NAMES)
    const place = rng.pick(CITIES)

    return {
      email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`,
      first_name: first,
      last_name: last,
      has_account: true,
      addresses: [
        {
          first_name: first,
          last_name: last,
          address_1: `${rng.int(1, 240)} ${rng.pick(["High", "Mill", "Station", "Church", "Park"])} Street`,
          city: place.city,
          country_code: place.country,
          postal_code: place.postal,
          is_default_shipping: true,
          is_default_billing: true,
        },
      ],
    }
  })

  const { result: customers } = await createCustomersWorkflow(container).run({
    input: { customersData: customersInput },
  })

  const customerIds = customers.map((c) => c.id)

  logger.info("Assigning customers to groups...")
  // Group membership is uneven — a few customers are in several groups, most are
  // in one, some in none. Segment-filtered reads are only interesting when the
  // segments differ in size.
  for (const group of groups) {
    const members = customerIds.filter(() => rng.chance(0.22))
    if (!members.length) {
      continue
    }
    await linkCustomersToCustomerGroupWorkflow(container).run({
      input: { id: group.id, add: members },
    })
  }

  logger.info("Seeding loyalty accounts...")

  // The customer.created subscriber provisions a loyalty account too, and with
  // the Redis event bus it runs on a worker — concurrently with this seed, not
  // after it. customer_id is unique on loyalty_account, so blindly creating one
  // per customer races the subscriber and fails.
  //
  // Let the subscriber be the creator, wait for it to catch up, and create only
  // the stragglers. Then update every account to its seeded values. This is also
  // the more honest path: it exercises the same provisioning code that runs in
  // production rather than side-stepping it.
  const wanted = new Map(
    customerIds.map((customerId) => {
      const lifetime = rng.chance(0.25) ? rng.int(0, 8000) : rng.int(0, 600)
      const tier = [...tiers]
        .sort((a, b) => b.min_lifetime_points - a.min_lifetime_points)
        .find((t) => t.min_lifetime_points <= lifetime)

      return [
        customerId,
        {
          lifetime_points: lifetime,
          points_balance: Math.floor(lifetime * (0.3 + rng.next() * 0.7)),
          tier_id: tier?.id ?? null,
          last_earned_at: rng.chance(0.8) ? rng.dateWithin(180) : null,
        },
      ] as const
    })
  )

  const deadline = Date.now() + 30_000
  let provisioned = await loyalty.listLoyaltyAccounts(
    { customer_id: customerIds },
    { take: customerIds.length }
  )

  while (provisioned.length < customerIds.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    provisioned = await loyalty.listLoyaltyAccounts(
      { customer_id: customerIds },
      { take: customerIds.length }
    )
  }

  const haveAccount = new Set(provisioned.map((a) => a.customer_id))
  const missing = customerIds.filter((id) => !haveAccount.has(id))

  if (missing.length) {
    logger.info(
      `Creating ${missing.length} loyalty accounts the subscriber did not provision`
    )
    await loyalty.createLoyaltyAccounts(
      missing.map((customerId) => ({ customer_id: customerId }))
    )
    provisioned = await loyalty.listLoyaltyAccounts(
      { customer_id: customerIds },
      { take: customerIds.length }
    )
  }

  await loyalty.updateLoyaltyAccounts(
    provisioned.map((account) => ({
      id: account.id,
      ...wanted.get(account.customer_id)!,
    }))
  )

  const accounts = provisioned

  logger.info("Seeding loyalty ledger...")
  const transactions = accounts.flatMap((account) => {
    const count = rng.int(0, 12)
    return Array.from({ length: count }, () => {
      const type = rng.weighted(
        ["earn", "redeem", "expire", "adjust"] as const,
        [70, 20, 7, 3]
      )
      const points = type === "earn" ? rng.int(10, 400) : -rng.int(10, 200)
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + rng.int(-60, 365))

      return {
        account_id: account.id,
        type,
        points,
        description: `${type} transaction`,
        expires_at: type === "earn" ? expiresAt : null,
      }
    })
  })

  if (transactions.length) {
    await loyalty.createLoyaltyTransactions(transactions)
  }

  logger.info(
    `Customers seeded: ${customerIds.length} customers, ${transactions.length} loyalty transactions`
  )

  return {
    customerIds,
    customerEmails: customers.map((c) => c.email!),
    groupIds: groups.map((g) => g.id),
    tierIds: tiers.map((t) => t.id),
  }
}
