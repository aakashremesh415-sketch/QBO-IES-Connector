import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "IES Connector", template: "%s · IES Connector" },
  description: "Bulk chart of accounts and journal tools for Intuit Enterprise Suite",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
