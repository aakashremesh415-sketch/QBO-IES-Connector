import Link from "next/link";
import PublicPage, { operator } from "@/components/PublicPage";

export const metadata = { title: "Help and support" };
export const dynamic = "force-dynamic";

export default function Support() {
  const { email } = operator();
  return (
    <PublicPage title="Help and support">
      <p>
        For help with IES Connector, a change that didn&apos;t go as expected, or access to a company, contact{" "}
        {email ? <a href={`mailto:${email}`}>{email}</a> : "your administrator"}.
      </p>
      <h2>Make it quick to sort out</h2>
      <ul>
        <li>Open the job under <Link href="/jobs">Activity</Link> and use <b>Download log</b>. It lists every item, its result and QuickBooks&apos; own error message.</li>
        <li>QuickBooks errors include an <b>intuit_tid</b> reference. Intuit support can use it to find the exact request.</li>
        <li>Say which company (its alias) and roughly when it happened.</li>
      </ul>
      <h2>Common fixes</h2>
      <ul>
        <li><b>&ldquo;Needs to reconnect&rdquo;:</b> the QuickBooks sign-in expired or was cancelled. An admin can reconnect the company on the Companies page.</li>
        <li><b>Locked out:</b> after 5 wrong passwords, sign-in pauses for 15 minutes. An admin can also reset your password.</li>
        <li><b>A preview is too old:</b> previews expire after 4 hours. Prepare it again so it matches the books today.</li>
      </ul>
    </PublicPage>
  );
}
