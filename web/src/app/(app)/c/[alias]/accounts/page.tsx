import PageHeader from "@/components/PageHeader";
import { RefreshButton } from "@/components/MappingEditor";
import { companyForUser, requireUser } from "@/lib/session";
import { accountOptions } from "@/lib/companyData";
import AccountsClient from "./AccountsClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata = { title: "Chart of accounts" };

export default async function AccountsPage({ params }: { params: { alias: string } }) {
  const user = await requireUser();
  const company = await companyForUser(user, params.alias);
  const { accounts, error } = await accountOptions(company);
  return (
    <>
      <PageHeader
        title="Chart of accounts"
        subtitle="Create, edit, inactivate and reactivate accounts in bulk from a spreadsheet. Every row is checked first; nothing changes until it's confirmed."
        actions={<><RefreshButton /><a className="btn-secondary" href={`/api/c/${encodeURIComponent(company.alias)}/accounts.csv`}>Export to CSV</a></>}
      />
      {error ? <div className="banner-bad" role="alert">{error}</div> : <AccountsClient alias={company.alias} accounts={accounts} />}
    </>
  );
}
