import type {
  CreateProductWorkflowInputDTO,
  MedusaContainer,
} from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils"
import {
  createCollectionsWorkflow,
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
} from "@medusajs/medusa/core-flows"
import { BRAND_MODULE } from "../../modules/brand"
import type BrandModuleService from "../../modules/brand/service"
import type { Rng } from "./random"
import {
  BRANDS,
  CATEGORY_TREE,
  COLLECTIONS,
  COLOUR_OPTIONS,
  SIZE_OPTIONS,
  material,
  productName,
} from "./vocabulary"

export const PRODUCT_COUNT = 180
const PRODUCT_BATCH_SIZE = 20

export type CatalogResult = {
  brandIds: string[]
  categoryIds: string[]
  collectionIds: string[]
  productIds: string[]
  variantIds: string[]
}

function handleize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

export async function seedCatalog(
  container: MedusaContainer,
  rng: Rng,
  context: { salesChannelId: string; shippingProfileId: string; stockLocationId: string }
): Promise<CatalogResult> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const brandService: BrandModuleService = container.resolve(BRAND_MODULE)

  logger.info("Seeding brands...")
  const brands = await brandService.createBrands(
    BRANDS.map((brand) => ({
      name: brand.name,
      handle: handleize(brand.name),
      country_of_origin: brand.country,
      description: `${brand.name} products, designed and assembled in ${brand.country.toUpperCase()}.`,
      is_active: true,
    }))
  )
  const brandIds = brands.map((b) => b.id)

  logger.info("Seeding categories...")
  const { result: parentCategories } = await createProductCategoriesWorkflow(
    container
  ).run({
    input: {
      product_categories: CATEGORY_TREE.map((node) => ({
        name: node.name,
        handle: handleize(node.name),
        is_active: true,
      })),
    },
  })

  const childInput = CATEGORY_TREE.flatMap((node, index) =>
    node.children.map((child) => ({
      name: child,
      handle: handleize(`${node.name}-${child}`),
      is_active: true,
      parent_category_id: parentCategories[index].id,
    }))
  )

  const { result: childCategories } = await createProductCategoriesWorkflow(
    container
  ).run({ input: { product_categories: childInput } })

  const leafCategoryIds = childCategories.map((c) => c.id)
  const categoryIds = [
    ...parentCategories.map((c) => c.id),
    ...leafCategoryIds,
  ]

  logger.info("Seeding collections...")
  const { result: collections } = await createCollectionsWorkflow(container).run({
    input: {
      collections: COLLECTIONS.map((title) => ({
        title,
        handle: handleize(title),
      })),
    },
  })
  const collectionIds = collections.map((c) => c.id)

  logger.info(`Seeding ${PRODUCT_COUNT} products...`)
  const productIds: string[] = []

  for (let batchStart = 0; batchStart < PRODUCT_COUNT; batchStart += PRODUCT_BATCH_SIZE) {
    const batch: CreateProductWorkflowInputDTO[] = []

    for (
      let i = batchStart;
      i < Math.min(batchStart + PRODUCT_BATCH_SIZE, PRODUCT_COUNT);
      i++
    ) {
      const name = productName(rng.int(0, 100), i)
      const handle = `${handleize(name)}-${i}`

      // Apparel gets sizes, everything else gets colours. Mixed option shapes
      // matter: a variant matrix and a flat variant list produce different
      // queries on the product detail page.
      const isApparel = rng.chance(0.35)
      const optionValues = isApparel
        ? rng.pickMany(SIZE_OPTIONS, rng.int(3, 5))
        : rng.pickMany(COLOUR_OPTIONS, rng.int(2, 4))
      const optionTitle = isApparel ? "Size" : "Colour"

      const basePrice = rng.int(9, 240)

      batch.push({
        title: name,
        handle,
        description: `${name} in ${material(i)}. ${
          isApparel ? "Cut for everyday wear." : "Built to be used, not admired."
        }`,
        status: rng.chance(0.92) ? ProductStatus.PUBLISHED : ProductStatus.DRAFT,
        shipping_profile_id: context.shippingProfileId,
        category_ids: [leafCategoryIds[rng.zipf(leafCategoryIds.length, 0.6)]],
        // Most products sit outside any collection, as in a real catalogue.
        ...(rng.chance(0.4)
          ? { collection_id: rng.pick(collectionIds) }
          : {}),
        options: [{ title: optionTitle, values: [...optionValues] }],
        variants: optionValues.map((value, variantIndex) => ({
          title: `${name} / ${value}`,
          // The product index has to be in the SKU: truncating the handle alone
          // collides whenever two generated names share a prefix.
          sku: `${handle.toUpperCase().slice(0, 14)}-${i}-${variantIndex}`,
          manage_inventory: true,
          options: { [optionTitle]: value },
          prices: [
            { amount: basePrice, currency_code: "eur" },
            { amount: Math.round(basePrice * 1.12), currency_code: "usd" },
            { amount: Math.round(basePrice * 0.88), currency_code: "gbp" },
          ],
        })),
        sales_channels: [{ id: context.salesChannelId }],
      })
    }

    const { result } = await createProductsWorkflow(container).run({
      input: { products: batch },
    })

    productIds.push(...result.map((p) => p.id))
    logger.info(`  products: ${productIds.length}/${PRODUCT_COUNT}`)
  }

  logger.info("Linking products to brands...")
  // Brand popularity is skewed, so brand-filtered reads have wildly different
  // selectivity rather than each brand owning an equal slice of the catalogue.
  await link.create(
    productIds.map((productId) => ({
      [Modules.PRODUCT]: { product_id: productId },
      [BRAND_MODULE]: { brand_id: brandIds[rng.zipf(brandIds.length, 0.8)] },
    }))
  )

  logger.info("Seeding inventory levels...")
  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id"],
  })

  const existingLevels = await query.graph({
    entity: "inventory_level",
    fields: ["inventory_item_id"],
  })
  const alreadyStocked = new Set(
    existingLevels.data.map((level) => level.inventory_item_id)
  )

  const inventoryLevels = inventoryItems
    .filter((item) => !alreadyStocked.has(item.id))
    .map((item) => ({
      location_id: context.stockLocationId,
      inventory_item_id: item.id,
      // A deliberate minority are out of stock so the restock queue has work and
      // the storefront has to deal with unavailable variants.
      stocked_quantity: rng.chance(0.12) ? 0 : rng.int(5, 400),
    }))

  if (inventoryLevels.length) {
    await createInventoryLevelsWorkflow(container).run({
      input: { inventory_levels: inventoryLevels },
    })
  }

  const { data: variants } = await query.graph({
    entity: "variant",
    fields: ["id"],
  })

  logger.info(
    `Catalog seeded: ${productIds.length} products, ${variants.length} variants`
  )

  return {
    brandIds,
    categoryIds,
    collectionIds,
    productIds,
    variantIds: variants.map((v) => v.id),
  }
}
