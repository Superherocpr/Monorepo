/**
 * What's New Page
 * Route: /admin/whats-new
 * Called by: Admin sidebar nav (with an unread count) and the version label in the sidebar footer
 * Auth: any staff role (getAdminActor already rejects everyone else)
 * Staff-facing changelog: every feature and behavior change worth knowing about,
 * grouped by version and filtered to the entries the viewer's role can use.
 * Entries are written in content/changelog.ts. Opening the page marks them read.
 */

import { redirect } from "next/navigation";
import { getAdminActor } from "@/lib/auth/effective-role";
import { loadWhatsNewState } from "@/lib/whats-new";
import WhatsNewList from "../../_components/WhatsNewList";

export const metadata = { title: "What's New" };

/**
 * Server component: loads the entries visible to the viewer's effective role and
 * which of them are unread, then hands both to the client list.
 */
export default async function WhatsNewPage() {
  const actor = await getAdminActor();
  if (!actor) redirect("/admin");

  const { visible, unreadKeys } = await loadWhatsNewState(actor.user.id, actor.effectiveRole);

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900">What&apos;s New</h1>
      <p className="mt-1 mb-6 text-sm text-gray-600">
        New features and changes to the site, newest first. You are using{" "}
        <span className="font-mono">{process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"}</span>.
      </p>
      <WhatsNewList entries={visible} unreadKeys={unreadKeys} />
    </div>
  );
}
