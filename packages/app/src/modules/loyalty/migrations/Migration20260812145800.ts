import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260812145800 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "loyalty_account" drop constraint if exists "loyalty_account_customer_id_unique";`);
    this.addSql(`alter table if exists "loyalty_tier" drop constraint if exists "loyalty_tier_code_unique";`);
    this.addSql(`create table if not exists "loyalty_tier" ("id" text not null, "name" text not null, "code" text not null, "min_lifetime_points" integer not null default 0, "discount_percentage" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "loyalty_tier_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_loyalty_tier_deleted_at" ON "loyalty_tier" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_loyalty_tier_code_unique" ON "loyalty_tier" ("code") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "loyalty_account" ("id" text not null, "customer_id" text not null, "points_balance" integer not null default 0, "lifetime_points" integer not null default 0, "last_earned_at" timestamptz null, "tier_id" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "loyalty_account_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_loyalty_account_tier_id" ON "loyalty_account" ("tier_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_loyalty_account_deleted_at" ON "loyalty_account" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_loyalty_account_customer_id_unique" ON "loyalty_account" ("customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_loyalty_account_points_balance" ON "loyalty_account" ("points_balance") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "loyalty_transaction" ("id" text not null, "type" text check ("type" in ('earn', 'redeem', 'expire', 'adjust')) not null, "points" integer not null, "order_id" text null, "description" text null, "expires_at" timestamptz null, "account_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "loyalty_transaction_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_loyalty_transaction_account_id" ON "loyalty_transaction" ("account_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_loyalty_transaction_deleted_at" ON "loyalty_transaction" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_loyalty_transaction_type" ON "loyalty_transaction" ("type") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_loyalty_transaction_order_id" ON "loyalty_transaction" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_loyalty_transaction_expires_at" ON "loyalty_transaction" ("expires_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "loyalty_account" add constraint "loyalty_account_tier_id_foreign" foreign key ("tier_id") references "loyalty_tier" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table if exists "loyalty_transaction" add constraint "loyalty_transaction_account_id_foreign" foreign key ("account_id") references "loyalty_account" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "loyalty_account" drop constraint if exists "loyalty_account_tier_id_foreign";`);

    this.addSql(`alter table if exists "loyalty_transaction" drop constraint if exists "loyalty_transaction_account_id_foreign";`);

    this.addSql(`drop table if exists "loyalty_tier" cascade;`);

    this.addSql(`drop table if exists "loyalty_account" cascade;`);

    this.addSql(`drop table if exists "loyalty_transaction" cascade;`);
  }

}
