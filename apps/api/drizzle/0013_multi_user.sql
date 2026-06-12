-- Multi-user: shop-membership + product-eigendom.
-- Users met role 'user' zien alleen shops waar ze member van zijn en alleen
-- eigen producten. role 'admin' (operator) ziet alles. Puur additief.

CREATE TABLE IF NOT EXISTS "shop_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_members_shop_user_unique" UNIQUE("shop_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "shop_members" ADD CONSTRAINT "shop_members_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shop_members" ADD CONSTRAINT "shop_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shop_members_user_idx" ON "shop_members" ("user_id");
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "owner_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_owner_idx" ON "products" ("owner_user_id");
