import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260812145636 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "review_response" drop constraint if exists "review_response_review_id_unique";`);
    this.addSql(`create table if not exists "product_review" ("id" text not null, "product_id" text not null, "variant_id" text null, "customer_id" text null, "order_id" text null, "author_name" text not null, "author_email" text null, "title" text not null, "content" text not null, "rating" integer not null, "status" text check ("status" in ('pending', 'approved', 'rejected')) not null default 'pending', "verified_purchase" boolean not null default false, "helpful_count" integer not null default 0, "reported_count" integer not null default 0, "published_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "product_review_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_review_deleted_at" ON "product_review" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_review_product_id" ON "product_review" ("product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_review_customer_id" ON "product_review" ("customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_review_status" ON "product_review" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_review_product_id_status" ON "product_review" ("product_id", "status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_review_rating" ON "product_review" ("rating") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "review_response" ("id" text not null, "body" text not null, "author_id" text null, "review_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "review_response_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_review_response_review_id_unique" ON "review_response" ("review_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_review_response_deleted_at" ON "review_response" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "review_vote" ("id" text not null, "customer_id" text null, "session_id" text null, "vote" text check ("vote" in ('helpful', 'not_helpful')) not null, "review_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "review_vote_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_review_vote_review_id" ON "review_vote" ("review_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_review_vote_deleted_at" ON "review_vote" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_review_vote_customer_id" ON "review_vote" ("customer_id") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "review_response" add constraint "review_response_review_id_foreign" foreign key ("review_id") references "product_review" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table if exists "review_vote" add constraint "review_vote_review_id_foreign" foreign key ("review_id") references "product_review" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "review_response" drop constraint if exists "review_response_review_id_foreign";`);

    this.addSql(`alter table if exists "review_vote" drop constraint if exists "review_vote_review_id_foreign";`);

    this.addSql(`drop table if exists "product_review" cascade;`);

    this.addSql(`drop table if exists "review_response" cascade;`);

    this.addSql(`drop table if exists "review_vote" cascade;`);
  }

}
