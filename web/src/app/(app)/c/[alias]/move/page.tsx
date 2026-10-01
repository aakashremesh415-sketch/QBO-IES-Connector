import PageHeader from "@/components/PageHeader";
import { companyForUser, requireUser } from "@/lib/session";
import { accountOptions } from "@/lib/companyData";
import MoveClient from "./MoveClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata = { title: "Move transactions" };

export default async function MovePage({ params }: { params: { alias: string } }) {
  const user = await requireUser();
  const company = await companyForUser(user, params.alias);
  const { accounts, error } = await accountOptions(company);
  return (
    <>
      <PageHeader title="Move transactions" subtitle="Switch existing transactions from old accounts to a new one, one at a time. Class, location, name, amount, date and memo stay exactly as they are." />
      {error ? <div className="banner-bad" role="alert">{error}</div> : <MoveClient alias={company.alias} accounts={accounts} />}
    </>
  );
}
