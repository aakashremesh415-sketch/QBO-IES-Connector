import PageHeader from "@/components/PageHeader";
import { companyForUser, requireUser } from "@/lib/session";
import { accountOptions } from "@/lib/companyData";
import TransferClient from "./TransferClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata = { title: "Balance transfer" };

export default async function TransferPage({ params }: { params: { alias: string } }) {
  const user = await requireUser();
  const company = await companyForUser(user, params.alias);
  const { accounts, error } = await accountOptions(company);
  return (
    <>
      <PageHeader title="Balance transfer" subtitle="Move the balances of several accounts into one account with a single journal entry. Each class, location and customer/vendor is kept line by line." />
      {error ? <div className="banner-bad" role="alert">{error}</div> : <TransferClient alias={company.alias} accounts={accounts} today={new Date().toISOString().slice(0, 10)} />}
    </>
  );
}
