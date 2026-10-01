import Link from "next/link";
import PublicPage from "@/components/PublicPage";

export const metadata = { title: "Disconnected" };

/** Intuit sends people here after they disconnect the app from inside QuickBooks. */
export default function Disconnected() {
  return (
    <PublicPage title="QuickBooks disconnected">
      <p>
        IES Connector no longer has access to that QuickBooks company. Nothing more will be read from or written to it.
      </p>
      <p>
        The record of past changes is kept for audit purposes. To use the company again, an administrator can reconnect it
        from the <Link href="/companies">Companies</Link> page.
      </p>
    </PublicPage>
  );
}
