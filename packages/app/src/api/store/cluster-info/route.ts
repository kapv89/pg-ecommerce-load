import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * Which process answered.
 *
 * Deliberately unauthenticated and outside /store and /admin: the load test uses
 * it to prove requests are actually spread across pm2's cluster workers rather
 * than all landing on one core. Without something like this, "it is load
 * balanced" is an assumption rather than a measurement.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  res.json({
    pid: process.pid,
    // pm2 sets this per cluster worker, zero-indexed.
    instance: process.env.NODE_APP_INSTANCE ?? null,
    pm_id: process.env.pm_id ?? null,
    worker_mode: process.env.MEDUSA_WORKER_MODE ?? "shared",
    uptime_seconds: Math.round(process.uptime()),
  })
}
