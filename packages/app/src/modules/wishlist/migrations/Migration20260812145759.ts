import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260812145759 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "wishlist" drop constraint if exists "wishlist_share_token_unique";`);
    this.addSql(`create table if not exists "wishlist" ("id" text not null, "customer_id" text not null, "name" text not null default 'My wishlist', "is_public" boolean not null default false, "share_token" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "wishlist_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wishlist_deleted_at" ON "wishlist" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wishlist_customer_id" ON "wishlist" ("customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_wishlist_share_token_unique" ON "wishlist" ("share_token") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "wishlist_item" ("id" text not null, "product_id" text not null, "variant_id" text null, "note" text null, "price_at_add" numeric null, "wishlist_id" text not null, "raw_price_at_add" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "wishlist_item_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wishlist_item_wishlist_id" ON "wishlist_item" ("wishlist_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wishlist_item_deleted_at" ON "wishlist_item" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wishlist_item_product_id" ON "wishlist_item" ("product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_wishlist_item_variant_id" ON "wishlist_item" ("variant_id") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "wishlist_item" add constraint "wishlist_item_wishlist_id_foreign" foreign key ("wishlist_id") references "wishlist" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "wishlist_item" drop constraint if exists "wishlist_item_wishlist_id_foreign";`);

    this.addSql(`drop table if exists "wishlist" cascade;`);

    this.addSql(`drop table if exists "wishlist_item" cascade;`);
  }

}
