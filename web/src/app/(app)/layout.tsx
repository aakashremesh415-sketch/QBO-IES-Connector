import { cookies, headers } from "next/headers";
import Shell from "@/components/Shell";
import { companiesFor, requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser({ allowPasswordChange: true });
  const companies = await companiesFor(user);
  const remembered = headers().get("x-company-alias") ?? cookies().get("company")?.value ?? null;
  const alias = companies.find((c) => c.alias === remembered)?.alias ?? companies[0]?.alias ?? null;
  return (
    <Shell
      alias={alias}
      isAdmin={user.role === "ADMIN"}
      companies={companies.map((c) => ({ alias: c.alias, name: c.companyName ?? c.alias, environment: c.environment }))}
      userName={user.name}
      role={user.role}
    >
      {children}
    </Shell>
  );
}
