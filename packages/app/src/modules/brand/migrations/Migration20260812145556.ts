import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260812145556 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "brand" drop constraint if exists "brand_handle_unique";`);
    this.addSql(`create table if not exists "brand" ("id" text not null, "name" text not null, "handle" text not null, "description" text null, "country_of_origin" text null, "logo_url" text null, "is_active" boolean not null default true, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "brand_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_brand_deleted_at" ON "brand" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_brand_handle_unique" ON "brand" ("handle") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_brand_is_active" ON "brand" ("is_active") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "brand" cascade;`);
  }

}
