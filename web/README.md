# IES Connector (web)

The browser version of the QBO-IES-Connector tools, with user accounts. It runs on **Vercel** with a
**Neon** Postgres database.

## What's in it

**Tools for each company:**
- **Chart of accounts:** browse and export the chart, and create, update, inactivate or reactivate
  accounts in bulk from a CSV.
- **Balance transfer:** one journal entry moving several accounts into one, keeping each class,
  location and customer/vendor. A finished transfer can be reversed.
- **Move transactions:** switch existing transactions to a new account, one at a time.
- **Make inactive:** pick the accounts to retire. Balance sheet accounts must be at zero first.

**Multi-entity:**
- **Shared COA:** a checklist for Consolidated View, plus a read-only check that every entity has each
  shared account. Intuit has no public API for creating shared accounts, so that step stays manual.
- **Activity:** every prepared and confirmed change, with a CSV log you can download.

**Settings (admins only):**
- **Companies:** connect, reconnect, rename or disconnect each IES entity.
- **Users:** add people, set their role and the companies they can use, and reset passwords.
- **Audit log:** sign-ins, user and company changes, and confirmed jobs.

### Roles

| Role | Can do |
|---|---|
| Admin | Everything, on every company, plus users and companies |
| Operator | Prepare and confirm changes on the companies they've been given |
| Viewer | Look and prepare previews on their companies, but never confirm |

### How a change is made

1. **Prepare:** the tool reads QuickBooks and saves a preview of every item, marked Ready, Error or Skipped.
2. **Confirm:** an operator or admin types the company alias. With `REQUIRE_SECOND_APPROVER=true`, it
   must be someone other than the person who prepared it. Previews older than 4 hours must be prepared again.
3. **Run:** items are saved one at a time, in short steps, so large jobs don't hit Vercel's time limit.
   Keep the page open; reopening it carries on from where it stopped.
4. **Results:** each item's result is stored. Anything interrupted mid-save is marked Failed and never
   retried automatically, because it may already be in QuickBooks.

## Deploy to Vercel + Neon

1. **Neon:** create a project and copy its connection string, or add the Neon integration in Vercel,
   which sets `DATABASE_URL` for you.
2. **Vercel:** import the `QBO-IES-Connector` repo and set **Root Directory** to `web`.
3. **Environment variables:** add everything in `.env.example`. Generate the two secrets with
   `openssl rand -base64 32`:
   - `NEXTAUTH_SECRET`
   - `NEXTAUTH_URL` (your site address, e.g. `https://ies-connector.vercel.app`)
   - `TOKEN_ENCRYPTION_KEY` (keep a copy; changing it means reconnecting every company)
   - `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_ENVIRONMENT` (`sandbox` first, then `production`)
   - Optionally `REQUIRE_SECOND_APPROVER=true`
4. **Create the tables** from your computer, with `DATABASE_URL` in `web/.env`:
   ```bash
   cd web && npm install && npm run db:push
   ```
5. **Create the first admin:**
   ```bash
   npm run create-admin -- you@example.com "Your Name"
   ```
   It prints a temporary password. You choose your own at first sign-in.
6. **Intuit app:** under Keys & credentials, add the Redirect URI
   `https://<your-site>/api/qbo/callback`. The Companies page shows the exact address. For production,
   complete Intuit's production key questionnaire and use the production keys.
7. Sign in, open **Companies**, give each entity a short alias (e.g. `us-parent`) and connect it.

## Try it locally without Intuit

```bash
cd web
cp .env.example .env      # set DATABASE_URL to a local Postgres, and the two secrets
# point the app at the built-in fake QuickBooks:
#   QBO_API_BASE=http://localhost:3999
#   QBO_TOKEN_URL=http://localhost:3999/oauth2/v1/tokens/bearer
#   QBO_AUTHORIZE_URL=http://localhost:3999/connect/oauth2
#   QBO_CLIENT_ID=test  QBO_CLIENT_SECRET=test
npm install && npm run db:push && npm run create-admin -- you@example.com "You"
node scripts/fake-qbo.mjs &      # sample company with rent accounts, classes and transactions
npm run dev
```

## Security notes

- QuickBooks sign-in tokens are encrypted in the database (AES-256-GCM) with `TOKEN_ENCRYPTION_KEY`.
- Token refreshes happen under a database row lock, because Intuit rotates refresh tokens.
- Passwords are bcrypt-hashed.
- After 5 failed sign-ins, an account is locked for 15 minutes.
- New users and password resets get a one-time temporary password they must change.
- Role and active status are re-read from the database on every request, so deactivating someone
  takes effect at once.
- State-changing API calls reject requests from other sites, and the site sends no-framing headers.

## Development

```bash
npm test          # accounting rules (vitest)
npm run typecheck
npm run build
```
