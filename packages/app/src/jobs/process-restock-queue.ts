import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { notifyRestockWorkflow } from "../workflows/notify-restock"

export default async function processRestockQueue(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const { result } = await notifyRestockWorkflow(container).run({
    input: { limit: 200 },
  })

  if (result.notified) {
    logger.info(`Sent ${result.notified} restock notifications`)
  }
}

export const config = {
  name: "process-restock-queue",
  schedule: "*/15 * * * *",
}
