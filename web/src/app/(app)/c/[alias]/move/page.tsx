import PageHeader from "@/components/PageHeader";
import { RefreshButton } from "@/components/MappingEditor";
import { companyForUser, requireUser } from "@/lib/session";
import { accountOptions } from "@/lib/companyData";
import { prefillFrom } from "@/lib/jobs/prefill";
import MoveClient from "./MoveClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata = { title: "Move transactions" };

export default async function MovePage({ params, searchParams }: { params: { alias: string }; searchParams: { from?: string } }) {
  const user = await requireUser();
  const company = await companyForUser(user, params.alias);
  const { accounts, error } = await accountOptions(company);
  const prefill = await prefillFrom(user, company, searchParams.from, "move");
  return (
    <>
      <PageHeader title="Move transactions" subtitle="Switch existing transactions from old accounts to new ones, one at a time: every transaction in a date range, or only the ones you pick, each with its own new account if you like. Class, location, name, amount, date and memo stay exactly as they are." actions={<RefreshButton />} />
      {error ? <div className="banner-bad" role="alert">{error}</div> : <MoveClient alias={company.alias} accounts={accounts} prefill={prefill} />}
    </>
  );
}
