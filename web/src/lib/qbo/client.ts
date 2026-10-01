/**
 * QuickBooks Online Accounting API client: OAuth 2.0, token refresh under a row lock,
 * queries, reads, creates, updates and reports. Tokens are stored encrypted on `companies`.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

// Fallbacks if Intuit's discovery document can't be fetched.
const DEFAULT_ENDPOINTS = {
  authorization_endpoint: "https://appcenter.intuit.com/connect/oauth2",
  token_endpoint: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  revocation_endpoint: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
};
const DISCOVERY_URLS = {
  production: "https://developer.api.intuit.com/.well-known/openid_configuration",
  sandbox: "https://developer.api.intuit.com/.well-known/openid_sandbox_configuration",
};
const MINOR_VERSION = "75";
const SCOPE = "com.intuit.quickbooks.accounting";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set.`);
  return v;
}

export function qboEnvironment(): "sandbox" | "production" {
  return process.env.QBO_ENVIRONMENT === "production" ? "production" : "sandbox";
}

export function qboApiBase(): string {
  if (process.env.QBO_API_BASE) return process.env.QBO_API_BASE.replace(/\/$/, ""); // local testing only
  return qboEnvironment() === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com";
}

export function qboRedirectUri(origin?: string): string {
  if (process.env.QBO_REDIRECT_URI) return process.env.QBO_REDIRECT_URI;
  const base = (origin ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/api/qbo/callback`;
}

type Endpoints = typeof DEFAULT_ENDPOINTS;
let discovered: { at: number; env: string; endpoints: Endpoints } | null = null;

/**
 * OAuth endpoints from Intuit's discovery document (cached for a day), as Intuit recommends,
 * so a change on their side doesn't need a code change here. QBO_*_URL variables override
 * them for local testing only.
 */
export async function oauthEndpoints(): Promise<Endpoints> {
  const env = qboEnvironment();
  if (!discovered || discovered.env !== env || Date.now() - discovered.at > 24 * 3600_000) {
    let endpoints = DEFAULT_ENDPOINTS;
    try {
      const res = await fetch(DISCOVERY_URLS[env], { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const doc = await res.json();
        endpoints = {
          authorization_endpoint: doc.authorization_endpoint ?? DEFAULT_ENDPOINTS.authorization_endpoint,
          token_endpoint: doc.token_endpoint ?? DEFAULT_ENDPOINTS.token_endpoint,
          revocation_endpoint: doc.revocation_endpoint ?? DEFAULT_ENDPOINTS.revocation_endpoint,
        };
      }
    } catch {
      /* keep the defaults; try again next time */
    }
    discovered = { at: Date.now(), env, endpoints };
  }
  return {
    authorization_endpoint: process.env.QBO_AUTHORIZE_URL ?? discovered.endpoints.authorization_endpoint,
    token_endpoint: process.env.QBO_TOKEN_URL ?? discovered.endpoints.token_endpoint,
    revocation_endpoint: process.env.QBO_REVOKE_URL ?? discovered.endpoints.revocation_endpoint,
  };
}

export async function authorizeUrl(state: string, redirectUri: string): Promise<string> {
  const u = new URL((await oauthEndpoints()).authorization_endpoint);
  u.searchParams.set("client_id", env("QBO_CLIENT_ID"));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPE);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}

type TokenResponse = { access_token: string; refresh_token: string; expires_in: number; x_refresh_token_expires_in: number };

/** Intuit refused the grant: the refresh token expired, was revoked, or the code was already used. */
export class InvalidGrantError extends Error {}

const basicAuth = () => `Basic ${Buffer.from(`${env("QBO_CLIENT_ID")}:${env("QBO_CLIENT_SECRET")}`).toString("base64")}`;

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const basic = basicAuth().slice(6);
  const res = await fetch((await oauthEndpoints()).token_endpoint, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    if (/invalid_grant/.test(text)) throw new InvalidGrantError("Intuit no longer accepts this sign-in (invalid_grant).");
    throw new Error(`Intuit sign-in request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as TokenResponse;
}

/** Tell Intuit to cancel a token, so a disconnected company's sign-in can't be used anywhere. */
export async function revokeToken(token: string): Promise<void> {
  const res = await fetch((await oauthEndpoints()).revocation_endpoint, {
    method: "POST",
    headers: { Authorization: basicAuth(), Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok && res.status !== 400) throw new Error(`Intuit didn't confirm the disconnect (${res.status}).`);
}

export const exchangeCode = (code: string, redirectUri: string) =>
  tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });

export function tokenColumns(t: TokenResponse) {
  const now = Date.now();
  return {
    accessTokenEnc: encryptSecret(t.access_token),
    refreshTokenEnc: encryptSecret(t.refresh_token),
    accessTokenExpiresAt: new Date(now + (t.expires_in - 120) * 1000),
    refreshTokenExpiresAt: new Date(now + t.x_refresh_token_expires_in * 1000),
  };
}

function open(sealed: string, alias: string): string {
  try {
    return decryptSecret(sealed);
  } catch {
    throw new Error(`The saved QuickBooks sign-in for '${alias}' can't be read (TOKEN_ENCRYPTION_KEY changed?). Reconnect the company.`);
  }
}

async function accessTokenFor(companyId: string): Promise<{ token: string; realmId: string }> {
  const row = await db.query.companies.findFirst({ where: eq(companies.id, companyId) });
  if (!row) throw new Error("Company not found.");
  if (!row.refreshTokenEnc) throw new Error(`'${row.alias}' is disconnected. An admin needs to reconnect it.`);
  if (row.accessTokenEnc && row.accessTokenExpiresAt && row.accessTokenExpiresAt.getTime() > Date.now()) {
    return { token: open(row.accessTokenEnc, row.alias), realmId: row.realmId };
  }
  if (row.refreshTokenExpiresAt && row.refreshTokenExpiresAt.getTime() < Date.now()) {
    throw new Error(`The QuickBooks sign-in for '${row.alias}' has expired. An admin needs to reconnect it.`);
  }
  // Intuit rotates refresh tokens; lock the row so two requests never refresh with the same one.
  const refreshed = await db.transaction(async (tx) => {
    const locked = await tx.execute(sql`select access_token_enc, refresh_token_enc, access_token_expires_at, realm_id from companies where id = ${companyId} for update`);
    const r = locked.rows[0] as { access_token_enc: string | null; refresh_token_enc: string; access_token_expires_at: Date | null; realm_id: string };
    if (r.access_token_enc && r.access_token_expires_at && new Date(r.access_token_expires_at).getTime() > Date.now()) {
      return { token: open(r.access_token_enc, row.alias), realmId: r.realm_id };
    }
    try {
      const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: open(r.refresh_token_enc, row.alias) });
      await tx.update(companies).set(tokenColumns(t)).where(eq(companies.id, companyId));
      return { token: t.access_token, realmId: r.realm_id };
    } catch (e) {
      if (!(e instanceof InvalidGrantError)) throw e;
      // The sign-in is dead (expired or revoked in QuickBooks). Forget it so the company shows as
      // disconnected, and ask for a reconnect instead of retrying.
      await tx.update(companies).set({ accessTokenEnc: null, refreshTokenEnc: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null }).where(eq(companies.id, companyId));
      return null;
    }
  });
  if (!refreshed) throw new Error(`The QuickBooks sign-in for '${row.alias}' has expired or was revoked. An admin needs to reconnect it on the Companies page.`);
  return refreshed;
}

export class QboError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function faultMessage(fault: any): string | null {
  const errs = fault?.Error ?? fault?.error;
  if (!Array.isArray(errs) || !errs.length) return null;
  return errs
    .map((e: any) => {
      const m = e.Message ?? e.message ?? "";
      const d = e.Detail ?? e.detail ?? "";
      return d && d !== m ? `${m}: ${d}` : m;
    })
    .join("; ");
}

export type Entity = Record<string, any> & { Id: string };

export interface Qbo {
  query(statement: string): Promise<Entity[]>;
  read(entity: string, id: string): Promise<Entity>;
  create(entity: string, body: Record<string, unknown>): Promise<Entity>;
  update(entity: string, body: Record<string, unknown>): Promise<Entity>;
  report(name: string, params: Record<string, string>): Promise<any>;
  companyInfo(): Promise<Entity>;
  preferences(): Promise<any>;
}

export class QboClient implements Qbo {
  constructor(public companyId: string) {}

  async request(method: "GET" | "POST", path: string, body?: unknown, query: Record<string, string> = {}): Promise<any> {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const { token, realmId } = await accessTokenFor(this.companyId);
      const url = new URL(`${qboApiBase()}/v3/company/${realmId}/${path}`);
      for (const [k, v] of Object.entries({ ...query, minorversion: MINOR_VERSION })) url.searchParams.set(k, v);
      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      if (res.status === 401 && !refreshed) {
        await db.update(companies).set({ accessTokenExpiresAt: new Date(0) }).where(eq(companies.id, this.companyId));
        refreshed = true;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
        continue;
      }
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* not JSON */
      }
      const fault = json?.Fault ?? json?.fault;
      if (!res.ok || fault) {
        const tid = res.headers.get("intuit_tid");
        throw new QboError((faultMessage(fault) ?? `QuickBooks returned ${res.status}: ${text.slice(0, 300)}`) + (tid ? ` (intuit_tid ${tid})` : ""), res.status);
      }
      return json;
    }
  }

  async query(statement: string): Promise<Entity[]> {
    const out: Entity[] = [];
    for (let start = 1; ; start += 1000) {
      const json = await this.request("GET", "query", undefined, { query: `${statement} STARTPOSITION ${start} MAXRESULTS 1000` });
      const qr = json?.QueryResponse ?? {};
      const rows = (Object.values(qr).find(Array.isArray) ?? []) as Entity[];
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  }

  async read(entity: string, id: string): Promise<Entity> {
    return (await this.request("GET", `${entity.toLowerCase()}/${id}`))[entity];
  }

  async create(entity: string, body: Record<string, unknown>): Promise<Entity> {
    return (await this.request("POST", entity.toLowerCase(), body))[entity];
  }

  async update(entity: string, body: Record<string, unknown>): Promise<Entity> {
    return (await this.request("POST", entity.toLowerCase(), body))[entity];
  }

  report(name: string, params: Record<string, string>): Promise<any> {
    return this.request("GET", `reports/${name}`, undefined, params);
  }

  async companyInfo(): Promise<Entity> {
    const { realmId } = await accessTokenFor(this.companyId);
    return (await this.request("GET", `companyinfo/${realmId}`)).CompanyInfo;
  }

  async preferences(): Promise<any> {
    return (await this.request("GET", "preferences")).Preferences;
  }
}

export async function fetchCompanyName(realmId: string, accessToken: string): Promise<string | null> {
  const res = await fetch(`${qboApiBase()}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=${MINOR_VERSION}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json())?.CompanyInfo?.CompanyName ?? null;
}
