CREATE TYPE "public"."cycle_end_reason" AS ENUM('completed', 'ended_early', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."cycle_status" AS ENUM('running', 'finished', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."machine_status" AS ENUM('free', 'awaiting_student', 'running', 'out_of_service');--> statement-breakpoint
CREATE TYPE "public"."reservation_close_reason" AS ENUM('fulfilled', 'no_show', 'not_started', 'cancelled_by_student', 'cancelled_by_admin', 'laundry_closed');--> statement-breakpoint
CREATE TYPE "public"."reservation_notice" AS ENUM('machine_out_of_service');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('waiting', 'called', 'confirmed', 'fulfilled', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'student');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cycles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"machine_id" smallint NOT NULL,
	"student_id" uuid NOT NULL,
	"reservation_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"planned_duration_min" smallint NOT NULL,
	"planned_end_at" timestamp with time zone NOT NULL,
	"actual_end_at" timestamp with time zone,
	"status" "cycle_status" NOT NULL,
	"end_reason" "cycle_end_reason",
	CONSTRAINT "cycles_reservation_id_unique" UNIQUE("reservation_id"),
	CONSTRAINT "cycles_duration_ck" CHECK ("cycles"."planned_duration_min" between 1 and 600),
	CONSTRAINT "cycles_end_after_start_ck" CHECK ("cycles"."planned_end_at" > "cycles"."started_at"),
	CONSTRAINT "cycles_closed_consistency_ck" CHECK (("cycles"."status" = 'running') = ("cycles"."actual_end_at" is null and "cycles"."end_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "laundry_state" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"next_deadline_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "laundry_state_singleton_ck" CHECK ("laundry_state"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" smallint PRIMARY KEY NOT NULL,
	"number" smallint NOT NULL,
	"name" text NOT NULL,
	"status" "machine_status" DEFAULT 'free' NOT NULL,
	"default_duration_min" smallint DEFAULT 45 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machines_number_unique" UNIQUE("number"),
	CONSTRAINT "machines_number_ck" CHECK ("machines"."number" between 1 and 7),
	CONSTRAINT "machines_default_duration_ck" CHECK ("machines"."default_duration_min" between 1 and 300)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "opening_hours" (
	"weekday" smallint PRIMARY KEY NOT NULL,
	"is_open" boolean DEFAULT true NOT NULL,
	"open_minute" smallint NOT NULL,
	"close_minute" smallint NOT NULL,
	CONSTRAINT "opening_hours_weekday_ck" CHECK ("opening_hours"."weekday" between 1 and 7),
	CONSTRAINT "opening_hours_range_ck" CHECK ("opening_hours"."open_minute" >= 0 and "opening_hours"."close_minute" <= 1440 and "opening_hours"."open_minute" < "opening_hours"."close_minute")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"student_id" uuid NOT NULL,
	"target_machine_id" smallint,
	"assigned_machine_id" smallint,
	"rank" double precision NOT NULL,
	"status" "reservation_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"called_at" timestamp with time zone,
	"call_deadline_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"confirm_deadline_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"close_reason" "reservation_close_reason",
	"notice" "reservation_notice",
	CONSTRAINT "reservations_called_has_machine_ck" CHECK ("reservations"."status" not in ('called', 'confirmed') or ("reservations"."assigned_machine_id" is not null and "reservations"."call_deadline_at" is not null)),
	CONSTRAINT "reservations_confirmed_has_deadline_ck" CHECK ("reservations"."status" <> 'confirmed' or "reservations"."confirm_deadline_at" is not null),
	CONSTRAINT "reservations_closed_consistency_ck" CHECK (("reservations"."status" in ('waiting', 'called', 'confirmed')) = ("reservations"."closed_at" is null and "reservations"."close_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"call_delay_min" smallint DEFAULT 5 NOT NULL,
	"confirm_delay_min" smallint DEFAULT 3 NOT NULL,
	"cycle_durations_min" smallint[] DEFAULT '{30,45,60,90}' NOT NULL,
	"max_active_reservations" smallint DEFAULT 1 NOT NULL,
	"student_can_start_cycle" boolean DEFAULT true NOT NULL,
	"no_show_warning_threshold" smallint DEFAULT 3 NOT NULL,
	"no_show_window_days" smallint DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_singleton_ck" CHECK ("settings"."id" = 1),
	CONSTRAINT "settings_call_delay_ck" CHECK ("settings"."call_delay_min" between 1 and 60),
	CONSTRAINT "settings_confirm_delay_ck" CHECK ("settings"."confirm_delay_min" between 1 and 60),
	CONSTRAINT "settings_max_active_ck" CHECK ("settings"."max_active_reservations" between 1 and 5),
	CONSTRAINT "settings_durations_ck" CHECK (cardinality("settings"."cycle_durations_min") between 1 and 10),
	CONSTRAINT "settings_no_show_ck" CHECK ("settings"."no_show_warning_threshold" >= 1 and "settings"."no_show_window_days" between 1 and 365)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" "user_role" NOT NULL,
	"school_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"room" text,
	"password_hash" text NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"locale" text DEFAULT 'fr' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_target_machine_id_machines_id_fk" FOREIGN KEY ("target_machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_assigned_machine_id_machines_id_fk" FOREIGN KEY ("assigned_machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_at_idx" ON "activity_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "activity_log_entity_idx" ON "activity_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "activity_log_actor_idx" ON "activity_log" USING btree ("actor_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "cycles_one_running_per_machine_uq" ON "cycles" USING btree ("machine_id") WHERE "cycles"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "cycles_one_running_per_student_uq" ON "cycles" USING btree ("student_id") WHERE "cycles"."status" = 'running';--> statement-breakpoint
CREATE INDEX "cycles_running_end_idx" ON "cycles" USING btree ("planned_end_at") WHERE "cycles"."status" = 'running';--> statement-breakpoint
CREATE INDEX "cycles_student_idx" ON "cycles" USING btree ("student_id","started_at");--> statement-breakpoint
CREATE INDEX "cycles_started_idx" ON "cycles" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id","id") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_waiting_rank_uq" ON "reservations" USING btree ("rank") WHERE "reservations"."status" = 'waiting';--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_one_called_per_machine_uq" ON "reservations" USING btree ("assigned_machine_id") WHERE "reservations"."status" in ('called', 'confirmed');--> statement-breakpoint
CREATE INDEX "reservations_active_idx" ON "reservations" USING btree ("status") WHERE "reservations"."status" in ('waiting', 'called', 'confirmed');--> statement-breakpoint
CREATE INDEX "reservations_student_idx" ON "reservations" USING btree ("student_id","created_at");--> statement-breakpoint
CREATE INDEX "reservations_closed_idx" ON "reservations" USING btree ("close_reason","closed_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_school_id_uq" ON "users" USING btree (lower("school_id"));--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");