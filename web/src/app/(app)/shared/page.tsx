import PageHeader from "@/components/PageHeader";
import { companiesFor, requireUser } from "@/lib/session";
import SharedClient from "./SharedClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shared COA" };

export default async function SharedPage() {
  const user = await requireUser();
  const list = await companiesFor(user);
  return (
    <>
      <PageHeader
        title="Shared chart of accounts"
        subtitle="Intuit has no public API for creating shared accounts or for 'Share with companies', so that step is done in Intuit Enterprise Suite by the parent company administrator. This page turns your spreadsheet into a checklist, then checks every company to confirm each account arrived."
      />
      <SharedClient aliases={list.map((c) => c.alias)} />
    </>
  );
}
