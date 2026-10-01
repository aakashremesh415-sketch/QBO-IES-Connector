import { relations } from "drizzle-orm";
import {
  boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

/**
 * ADMIN: manages users and companies, and can do everything on every company.
 * OPERATOR: prepares and confirms changes on the companies they're given.
 * VIEWER: can look and prepare previews on their companies, but never confirm a change.
 */
export const roleEnum = pgEnum("role", ["ADMIN", "OPERATOR", "VIEWER"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("VIEWER"),
  active: boolean("active").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ emailIdx: uniqueIndex("users_email_idx").on(t.email) }));

/** One row per connected QuickBooks company (each IES entity is its own company). */
export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  alias: text("alias").notNull(),
  realmId: text("realm_id").notNull(),
  companyName: text("company_name"),
  environment: text("environment").notNull(),
  accessTokenEnc: text("access_token_enc"),
  refreshTokenEnc: text("refresh_token_enc"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  connectedById: uuid("connected_by_id").references(() => users.id),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  aliasIdx: uniqueIndex("companies_alias_idx").on(t.alias),
  realmIdx: uniqueIndex("companies_realm_env_idx").on(t.realmId, t.environment),
}));

/** Which companies a non-admin user may work on. Admins can use every company. */
export const companyAccess = pgTable("company_access", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.companyId] }) }));

export const jobKindEnum = pgEnum("job_kind", ["accounts", "inactivate", "transfer", "reverse", "move"]);
export const jobStatusEnum = pgEnum("job_status", ["PREVIEW", "RUNNING", "DONE", "CANCELLED"]);
export const itemStatusEnum = pgEnum("item_status", ["READY", "ERROR", "RUNNING", "DONE", "FAILED", "SKIPPED"]);

/**
 * A prepared change. It starts as a PREVIEW; nothing touches QuickBooks until someone with
 * the right role types the company alias to confirm it, which moves it to RUNNING.
 */
export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  kind: jobKindEnum("kind").notNull(),
  status: jobStatusEnum("status").notNull().default("PREVIEW"),
  title: text("title").notNull(),
  params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
  /** Kind-specific preview data shown on the job page (e.g. journal lines, warnings). */
  preview: jsonb("preview").$type<Record<string, unknown>>().notNull().default({}),
  result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
  createdById: uuid("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedById: uuid("confirmed_by_id").references(() => users.id),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => ({ companyIdx: index("jobs_company_idx").on(t.companyId, t.createdAt) }));

/** One unit of work inside a job: one account change, one transaction moved, one journal entry. */
export const jobItems = pgTable("job_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  label: text("label").notNull(),
  action: text("action").notNull(),
  detail: text("detail").notNull().default(""),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  status: itemStatusEnum("status").notNull(),
  message: text("message").notNull().default(""),
  resultRef: text("result_ref"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ jobIdx: index("job_items_job_idx").on(t.jobId, t.seq) }));

/** Who did what outside of jobs: sign-ins, user changes, companies connected. */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  detail: text("detail").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  company: one(companies, { fields: [jobs.companyId], references: [companies.id] }),
  createdBy: one(users, { fields: [jobs.createdById], references: [users.id], relationName: "createdBy" }),
  confirmedBy: one(users, { fields: [jobs.confirmedById], references: [users.id], relationName: "confirmedBy" }),
  items: many(jobItems),
}));
export const jobItemsRelations = relations(jobItems, ({ one }) => ({
  job: one(jobs, { fields: [jobItems.jobId], references: [jobs.id] }),
}));

export type User = typeof users.$inferSelect;
export type Company = typeof companies.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type JobItem = typeof jobItems.$inferSelect;
export type Role = (typeof roleEnum.enumValues)[number];
