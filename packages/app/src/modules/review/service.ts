import { MedusaService } from "@medusajs/framework/utils"
import { ProductReview, ReviewResponse, ReviewVote } from "./models/review"

class ReviewModuleService extends MedusaService({
  ProductReview,
  ReviewResponse,
  ReviewVote,
}) {}

export default ReviewModuleService
