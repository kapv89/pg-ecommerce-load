import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260812181257 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "sale_event" ("id" text not null, "name" text not null, "status" text check ("status" in ('scheduled', 'active', 'ended')) not null default 'scheduled', "starts_at" timestamptz null, "ends_at" timestamptz null, "discount_percentage" integer not null default 20, "live_scarcity_enabled" boolean not null default true, "allocation_tracking_enabled" boolean not null default true, "per_customer_limit_enabled" boolean not null default true, "allocation_total" integer not null default 250000, "allocation_reserved" integer not null default 0, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "sale_event_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sale_event_deleted_at" ON "sale_event" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sale_event_status" ON "sale_event" ("status") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "sale_event" cascade;`);
  }

}
