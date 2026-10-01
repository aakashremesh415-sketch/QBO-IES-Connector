import PageHeader from "@/components/PageHeader";
import ActionForm from "@/components/ActionForm";
import { changeOwnPassword } from "@/lib/actions";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser({ allowPasswordChange: true });
  return (
    <>
      <PageHeader title="Your account" subtitle={`${user.email} · ${user.role.charAt(0) + user.role.slice(1).toLowerCase()}`} />
      {user.mustChangePassword && <div className="banner-warn mb-5">Choose your own password before using the tools.</div>}
      <section className="card card-pad max-w-lg">
        <h2 className="section-title mb-3">Change password</h2>
        <ActionForm action={changeOwnPassword} submitLabel="Change password">
          <label className="field">Current password<input className="input" id="current" name="current" type="password" autoComplete="current-password" required /></label>
          <label className="field">New password (at least 12 characters)<input className="input" id="next" name="next" type="password" autoComplete="new-password" minLength={12} required /></label>
          <label className="field">New password again<input className="input" id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required /></label>
        </ActionForm>
      </section>
    </>
  );
}
