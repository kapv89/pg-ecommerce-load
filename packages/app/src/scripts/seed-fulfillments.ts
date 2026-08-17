import type { ExecArgs } from "@medusajs/framework/types"
import { seedFulfillments } from "./workload-seed/fulfillments"
import { createRng, SEED } from "./workload-seed/random"

/**
 * Ships a share of the orders that do not have a fulfillment yet.
 *
 * Safe to re-run: orders that already have one are skipped.
 */
export default async function seedFulfillmentsScript({ container }: ExecArgs) {
  await seedFulfillments(container, createRng(SEED + 2))
}
