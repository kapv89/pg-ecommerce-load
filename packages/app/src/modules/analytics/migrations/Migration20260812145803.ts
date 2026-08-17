import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260812145803 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "product_view" ("id" text not null, "product_id" text not null, "variant_id" text null, "customer_id" text null, "session_id" text not null, "source" text check ("source" in ('search', 'category', 'collection', 'direct', 'recommendation', 'email')) not null default 'direct', "referrer" text null, "country_code" text null, "viewed_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "product_view_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_view_deleted_at" ON "product_view" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_view_product_id" ON "product_view" ("product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_view_session_id" ON "product_view" ("session_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_view_customer_id" ON "product_view" ("customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_view_viewed_at" ON "product_view" ("viewed_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_view_product_id_viewed_at" ON "product_view" ("product_id", "viewed_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "search_query" ("id" text not null, "query" text not null, "normalized_query" text not null, "results_count" integer not null default 0, "customer_id" text null, "session_id" text not null, "clicked_product_id" text null, "country_code" text null, "searched_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "search_query_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_search_query_deleted_at" ON "search_query" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_search_query_normalized_query" ON "search_query" ("normalized_query") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_search_query_results_count" ON "search_query" ("results_count") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_search_query_searched_at" ON "search_query" ("searched_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_search_query_session_id" ON "search_query" ("session_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "product_view" cascade;`);

    this.addSql(`drop table if exists "search_query" cascade;`);
  }

}
