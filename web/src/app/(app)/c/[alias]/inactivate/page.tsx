import PageHeader from "@/components/PageHeader";
import { companyForUser, requireUser } from "@/lib/session";
import { accountOptions } from "@/lib/companyData";
import InactivateClient from "./InactivateClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata = { title: "Make inactive" };

export default async function InactivatePage({ params }: { params: { alias: string } }) {
  const user = await requireUser();
  const company = await companyForUser(user, params.alias);
  const { accounts, error } = await accountOptions(company);
  return (
    <>
      <PageHeader title="Make accounts inactive" subtitle="Tick the accounts to retire. Balance sheet accounts must be at zero first, so run a balance transfer before this. Income and expense accounts keep their history in reports." />
      {error ? <div className="banner-bad" role="alert">{error}</div> : <InactivateClient alias={company.alias} accounts={accounts.filter((a) => a.active)} />}
    </>
  );
}
