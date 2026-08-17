import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260812145802 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "support_ticket" ("id" text not null, "customer_id" text null, "order_id" text null, "email" text not null, "subject" text not null, "category" text check ("category" in ('order', 'shipping', 'return', 'product', 'billing', 'other')) not null default 'other', "status" text check ("status" in ('open', 'pending', 'resolved', 'closed')) not null default 'open', "priority" text check ("priority" in ('low', 'normal', 'high', 'urgent')) not null default 'normal', "assigned_to" text null, "first_response_at" timestamptz null, "resolved_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "support_ticket_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_support_ticket_deleted_at" ON "support_ticket" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_support_ticket_customer_id" ON "support_ticket" ("customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_support_ticket_order_id" ON "support_ticket" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_support_ticket_status" ON "support_ticket" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_support_ticket_assigned_to" ON "support_ticket" ("assigned_to") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_support_ticket_status_priority" ON "support_ticket" ("status", "priority") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "ticket_message" ("id" text not null, "author_type" text check ("author_type" in ('customer', 'agent', 'system')) not null, "author_id" text null, "body" text not null, "is_internal" boolean not null default false, "ticket_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ticket_message_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ticket_message_ticket_id" ON "ticket_message" ("ticket_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ticket_message_deleted_at" ON "ticket_message" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ticket_message_author_type" ON "ticket_message" ("author_type") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "ticket_message" add constraint "ticket_message_ticket_id_foreign" foreign key ("ticket_id") references "support_ticket" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "ticket_message" drop constraint if exists "ticket_message_ticket_id_foreign";`);

    this.addSql(`drop table if exists "support_ticket" cascade;`);

    this.addSql(`drop table if exists "ticket_message" cascade;`);
  }

}
