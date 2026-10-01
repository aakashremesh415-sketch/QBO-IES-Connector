import PublicPage, { operator } from "@/components/PublicPage";

export const metadata = { title: "Privacy policy" };
export const dynamic = "force-dynamic";

export default function Privacy() {
  const { name, email } = operator();
  return (
    <PublicPage title="Privacy policy" updated="October 1, 2026">
      <p>
        IES Connector is a private tool run by {name} for its own staff and clients. It connects to QuickBooks Online and
        Intuit Enterprise Suite companies to make chart of accounts changes, post journal entries and reclassify transactions.
        This policy explains what information it handles and how.
      </p>

      <h2>Information we handle</h2>
      <ul>
        <li><b>User accounts:</b> name, email address, role, a hashed password (never the password itself), sign-in times and failed sign-in counts.</li>
        <li><b>QuickBooks connections:</b> the company ID and name, and the sign-in tokens Intuit issues when an administrator connects a company. Tokens are encrypted before they are stored.</li>
        <li><b>Accounting data:</b> chart of accounts, classes, locations, customer and vendor names, ledger lines and transactions read from QuickBooks to prepare a change. Only what a change needs is stored: the preview, each item&apos;s result and the QuickBooks IDs of what was created or edited.</li>
        <li><b>Activity records:</b> who prepared and confirmed each change and when, plus an audit log of sign-ins and settings changes.</li>
      </ul>

      <h2>How it&apos;s used</h2>
      <p>
        Only to provide the tool: showing previews, saving the changes an authorized user confirms, and keeping a record of
        what was done. We don&apos;t sell or rent information, use it for advertising, or share it with third parties except
        the service providers below.
      </p>

      <h2>Where it&apos;s stored</h2>
      <p>
        The application is hosted on Vercel and its database on Neon (PostgreSQL). Both encrypt data in transit, and sign-in
        tokens are additionally encrypted with AES-256-GCM. QuickBooks data stays in QuickBooks; this tool reads and writes it
        through Intuit&apos;s official API.
      </p>

      <h2>Who can see it</h2>
      <p>
        Only signed-in users, limited by role and by the companies an administrator has given them. Administrators can see the
        audit log.
      </p>

      <h2>Keeping and deleting information</h2>
      <ul>
        <li>Disconnecting a company deletes its saved sign-in tokens straight away. The record of past changes is kept for audit purposes.</li>
        <li>You can also disconnect the app from inside QuickBooks, which stops all access immediately.</li>
        <li>An administrator can deactivate a user at any time. To have your account or a company&apos;s records deleted, contact us below.</li>
      </ul>

      <h2>Contact</h2>
      <p>
        Questions or requests: {email ? <a href={`mailto:${email}`}>{email}</a> : "contact your administrator"}.
      </p>
    </PublicPage>
  );
}
