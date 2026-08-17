import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260812145801 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "restock_subscription" ("id" text not null, "variant_id" text not null, "product_id" text not null, "customer_id" text null, "email" text not null, "status" text check ("status" in ('active', 'notified', 'cancelled')) not null default 'active', "notified_at" timestamptz null, "sales_channel_id" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "restock_subscription_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_restock_subscription_deleted_at" ON "restock_subscription" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_restock_subscription_variant_id" ON "restock_subscription" ("variant_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_restock_subscription_status" ON "restock_subscription" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_restock_subscription_variant_id_status" ON "restock_subscription" ("variant_id", "status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_restock_subscription_email" ON "restock_subscription" ("email") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "restock_subscription" cascade;`);
  }

}
