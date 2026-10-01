import PublicPage, { operator } from "@/components/PublicPage";

export const metadata = { title: "Terms of use" };
export const dynamic = "force-dynamic";

export default function Terms() {
  const { name, email } = operator();
  return (
    <PublicPage title="End-user license agreement" updated="October 1, 2026">
      <p>
        These terms cover your use of Entity Connector, a private tool run by {name}. By signing in or connecting a QuickBooks
        company, you agree to them.
      </p>

      <h2>Who may use it</h2>
      <p>
        Only people given an account by an administrator. Keep your password private. You&apos;re responsible for what is done
        under your account. Access can be changed or removed at any time.
      </p>

      <h2>What it does</h2>
      <p>
        The tool reads data from QuickBooks Online and Intuit Enterprise Suite companies and, when an authorized user confirms
        a change, writes changes back: chart of accounts changes, journal entries and transaction reclassifications.
      </p>

      <h2>Your responsibilities</h2>
      <ul>
        <li>Only connect companies you are authorized to manage.</li>
        <li>Review every preview before confirming. Confirmed changes are saved to your books.</li>
        <li>Check results and keep your own backups and review procedures. The tool records what it did, but accounting decisions remain yours.</li>
      </ul>

      <h2>No warranty</h2>
      <p>
        The tool is provided &ldquo;as is&rdquo;, without warranties of any kind. It depends on Intuit&apos;s services, which
        may change or be unavailable. To the extent the law allows, {name} is not liable for indirect or consequential losses,
        or for losses caused by changes a user confirmed.
      </p>

      <h2>QuickBooks</h2>
      <p>
        QuickBooks and Intuit Enterprise Suite are trademarks of Intuit Inc. This tool is not made or endorsed by Intuit. Your
        use of QuickBooks remains subject to Intuit&apos;s own terms.
      </p>

      <h2>Ending use</h2>
      <p>
        You can stop at any time by disconnecting the app in QuickBooks or asking an administrator to remove your access. We
        may suspend or end access to protect the security of the service or your data.
      </p>

      <h2>Changes and contact</h2>
      <p>
        We may update these terms; the date above shows the latest version. Questions:{" "}
        {email ? <a href={`mailto:${email}`}>{email}</a> : "contact your administrator"}.
      </p>
    </PublicPage>
  );
}
