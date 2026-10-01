# QBO-IES-Connector

> **Prefer a browser?** The [`web/`](web/README.md) folder has the same tools as a web app with user
> accounts and roles, styled like QuickBooks Online, ready for Vercel + Neon.

Command-line tools for bulk chart of accounts work in **Intuit Enterprise Suite (IES)** and QuickBooks
Online, through Intuit's QuickBooks Online Accounting API.

| Command | What it does |
|---|---|
| `accounts-export` | Save a company's chart of accounts to CSV |
| `accounts-apply` | Create, update, inactivate or reactivate many accounts from one CSV |
| `accounts-inactivate` | Make accounts inactive (refuses any balance sheet account that still has a balance) |
| `shared-checklist` / `shared-verify` | Help with the IES shared chart of accounts (see below) |
| `transfer-balance` | **One** journal entry moving the balances of several accounts into one account, line by line per class, location and customer/vendor |
| `move-transactions` | Switch existing transactions from old accounts to a new one, one transaction at a time |
| `reverse-je` | Post a reversing entry for a journal entry, if something needs undoing |

**Safety:** every command that writes shows a full preview and changes nothing unless you add
`--execute`. Then it shows the environment and company and asks you to type the company alias back.
Every write is logged to a CSV in `logs/`.

---

## 1. Setup

You need Python 3.10+.

```bash
git clone https://github.com/aakashremesh415-sketch/QBO-IES-Connector.git
cd QBO-IES-Connector
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # then edit .env
```

### Intuit app and production keys

1. In the [Intuit Developer portal](https://developer.intuit.com/), open your app (scope: **Accounting**).
2. **Try it on a sandbox company first.** Use the *Development* keys with `QBO_ENVIRONMENT=sandbox`.
3. For your real IES companies, open **Keys & credentials → Production** and complete Intuit's production
   questionnaire. It asks for app details, plus privacy policy and terms URLs. Then use the *Production*
   keys with `QBO_ENVIRONMENT=production`.
4. Under the redirect URIs for the keys you're using, add exactly the address in `QBO_REDIRECT_URI`. The
   default, `https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl`, works without running a web
   server: you just copy the address from your browser bar after signing in.
5. The person signing in must be an admin of the company.

### Sign in to each company (each IES entity is its own company)

```bash
python -m ies_tools auth --alias us-parent
python -m ies_tools auth --alias uk-entity
python -m ies_tools companies
```

Tokens are saved in `tokens.json`. Keep that file private: it gives access to your books, and it's
git-ignored. Sign-ins last about 100 days.

---

## 2. Chart of accounts in bulk

```bash
python -m ies_tools accounts-export --company us-parent --out coa.csv
python -m ies_tools accounts-apply  --company us-parent --file my_plan.csv            # preview
python -m ies_tools accounts-apply  --company us-parent --file my_plan.csv --execute  # do it
```

Plan columns (see `templates/accounts_plan.csv`):

| Column | Meaning |
|---|---|
| `action` | `create`, `update`, `inactivate` or `reactivate` |
| `account` | Existing account to change: full name (`Parent:Child`), account number, or `id:123`. Leave blank for `create`. |
| `name` | New name (create), or the new name to rename to (update) |
| `acct_num`, `description` | Optional |
| `account_type` | Required for create, e.g. `Expense`, `Bank`, `Other Current Asset`, `Income` |
| `detail_type` | Intuit's detail type code, e.g. `Utilities`, `RentOrLeaseOfBuildings`. Optional. |
| `parent` | Parent account to make it a sub-account. It may be created earlier in the same file. Use `(top level)` to move it out from under a parent. |

For updates, blank cells mean "leave as is". Rows are checked before anything is written; errors are
listed per row. Add `--skip-errors` to apply only the good rows.

### Make accounts inactive later

```bash
python -m ies_tools accounts-inactivate --company us-parent --account "Old Rent 1;Old Rent 2"
python -m ies_tools accounts-inactivate --company us-parent --file templates/inactivate_accounts.csv --execute
```

Checks before inactivating:
- A balance sheet account (asset, liability, equity) must have a zero balance. Move it first with
  `transfer-balance`. Income and expense accounts can be inactivated with their history in place.
- Sub-accounts must be inactive already or in the same run. They're done before their parent.

---

## 3. Shared chart of accounts (Consolidated View)

IES's **shared chart of accounts** is managed by the parent company administrator in **Consolidated
View**: create the account, select **Share with companies**, tick the companies. **Intuit has no public
API for this step**, so it can't be scripted. Creating the same account separately in each entity
through the API would give you unlinked copies that clash with the shared accounts. These two commands
make the manual step quick and reliable instead:

```bash
# 1. Turn your spreadsheet into a step-by-step checklist with tick boxes
python -m ies_tools shared-checklist --file templates/shared_accounts.csv --out checklist.md

# 2. Afterwards, confirm every entity really has each shared account (and the right number)
python -m ies_tools shared-verify --file templates/shared_accounts.csv
```

`share_with` lists the companies by the aliases you used with `auth`, separated by `;`.

Once accounts are shared, they appear in each entity's chart of accounts. The other commands
(transfer, move, inactivate) then work on them in each entity. Some shared-account changes may only be
allowed from Consolidated View. If QuickBooks rejects one, the error is shown and logged; make that
change in Consolidated View.

---

## 4. Move balances into one account with ONE journal entry

Example: combine five old accounts into a new one, keeping each class:

```bash
python -m ies_tools transfer-balance --company us-parent \
  --from "Old Rent 1;Old Rent 2;Old Rent 3;Old Rent 4;Old Rent 5" \
  --to "Rent Expense - Combined" \
  --as-of 2026-09-30 --doc-number RECLASS-0930 --memo "Combine rent accounts"
```

Add `--execute` when the preview looks right.

How the amounts are worked out:
- The tool reads the **General Ledger** for each source account up to `--as-of`, and splits the balance
  by **class**, **location**, and (for A/R and A/P) **customer/vendor**.
  - **Balance sheet accounts:** all history up to that date.
  - **Income/expense accounts:** fiscal year to date, from the start month in your company settings. Use
    `--pl-start` to override.
- For each piece, it reverses that amount out of the old account and puts it into the new account with
  the same class, location and name. Lines going to the new account are combined per class.
- It checks the entry balances, and for balance sheet accounts compares the totals with QuickBooks' own
  account balances.
- The entry is dated `--as-of` unless you give `--date`.

**Want to type the amounts yourself?** Use `--amounts-file` (see `templates/transfer_amounts.csv`).
`amount` is the balance in the account's normal direction: a normal balance is a positive number.

Refused, with an explanation:
- Sub-accounts not listed (each must be its own `--from`).
- A/R or A/P balances going to a different type of account, or without a customer/vendor.
- Foreign-currency accounts.
- An inactive destination.

Warnings: transfers between different account classifications, and bank or credit card accounts (the
entry shows in their register).

Undo: `python -m ies_tools reverse-je --company us-parent --id <Id> --date 2026-10-01 --execute`

---

## 5. Move transactions one at a time

Use this when you want the history itself to sit under the new account, instead of one summary entry:

```bash
python -m ies_tools move-transactions --company us-parent \
  --from "Old Rent 1;Old Rent 2" --to "Rent Expense - Combined" \
  --start 2026-01-01 --end 2026-09-30 --limit 5     # preview the first 5
```

Then run it again with `--execute`. Try it with `--limit 5` first.

Each transaction is read, its lines on the old accounts are switched to the new account, and it's saved
back. Class, location, customer/vendor, amount, date and memo stay unchanged.

Skipped and listed with the reason:
- **Reconciled** transactions. Add `--include-reconciled` to move them anyway; this changes your
  reconciliation.
- Types the API can't edit, such as payroll.
- Lines whose account comes from a **product/service item** (invoices, sales receipts). Change the item's
  income account instead.
- Anything that fails (for example, a **closed books** period). It's logged with QuickBooks' message.

---

## Limits to know

- This uses Intuit's public QuickBooks Online Accounting API, which IES runs on. IES-only features
  without a public API (the shared COA setting, consolidated eliminations) are not automated.
- Multi-currency accounts are not supported by `transfer-balance`.
- Intuit's API limits (about 500 requests/minute per company) are handled with automatic retries.

## Development

```bash
pip install pytest
python -m pytest
```
