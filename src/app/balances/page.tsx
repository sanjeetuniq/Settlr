import Link from "next/link";
import { redirect } from "next/navigation";
import { SettlementCelebration } from "@/components/settlement-celebration";
import { SettlementForm } from "@/components/settlement-form";
import { ProfileAvatar } from "@/components/profile-avatar";
import { createClient } from "@/lib/supabase/server";
import {
  formatMoney,
  getBalanceDetails,
  getSettlementParties,
  simplifyBalances,
} from "@/lib/money";

type SearchParams = Promise<{
  direction?: string;
  error?: string;
  group?: string;
  notice?: string;
  celebration?: string;
}>;

export default async function BalancesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  if (params.direction !== "owe" && params.direction !== "owed") redirect("/");
  const direction = params.direction;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) {
    console.error("Balance details authentication lookup failed:", authError.message);
    redirect("/sign-in");
  }
  if (!user) redirect("/sign-in");

  const { data: memberships, error: membershipsError } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", user.id);
  if (membershipsError) {
    console.error("Balance details membership lookup failed:", membershipsError.message);
    throw new Error("Your group balances could not be loaded.");
  }
  const groupIds = memberships.map((membership) => membership.group_id);
  let groups: { id: string; name: string; currency: string }[] = [];
  if (groupIds.length > 0) {
    const { data, error } = await supabase
      .from("groups")
      .select("id, name, currency")
      .in("id", groupIds)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("Balance details group lookup failed:", error.message);
      throw new Error("Your groups could not be loaded.");
    }
    groups = data;
  }

  const groupsWithTransfers = await Promise.all(
    groups.map(async (group) => {
      const { data, error } = await supabase.rpc("group_balances", {
        p_group_id: group.id,
      });
      if (error) {
        console.error(`Balance lookup failed for ${group.name}:`, error.message);
        throw new Error(`Balances for ${group.name} could not be loaded.`);
      }
      return {
        group_id: group.id,
        group_name: group.name,
        currency: group.currency,
        transfers: simplifyBalances(data),
      };
    }),
  );

  const details = getBalanceDetails(groupsWithTransfers, user.id, direction);
  const celebrationGroup = groupsWithTransfers.find(
    (group) => group.group_id === params.group,
  );
  const celebrateSettlement =
    params.notice === "settlement-recorded" &&
    Boolean(params.celebration) &&
    (celebrationGroup
      ? celebrationGroup.transfers.length === 0
      : groupsWithTransfers.every((group) => group.transfers.length === 0));
  const counterpartIds = Array.from(new Set(details.map((item) => item.counterpart_id)));
  let namesById = new Map<string, string>();
  const avatarUrlsById = new Map<string, string>();
  if (counterpartIds.length > 0) {
    const profileResult = await supabase
      .from("profiles")
      .select("id, display_name, avatar_path")
      .in("id", counterpartIds);
    let profiles: {
      id: string;
      display_name: string;
      avatar_path: string | null;
    }[];
    let avatarMigrationAvailable = true;
    if (profileResult.error && ["PGRST204", "42703"].includes(profileResult.error.code)) {
      avatarMigrationAvailable = false;
      const fallbackProfiles = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", counterpartIds);
      if (fallbackProfiles.error) {
        console.error("Balance details profile lookup failed:", fallbackProfiles.error.message);
        throw new Error("Group member names could not be loaded.");
      }
      profiles = (fallbackProfiles.data ?? []).map((profile) => ({
        ...profile,
        avatar_path: null,
      }));
    } else {
      if (profileResult.error) {
        console.error("Balance details profile lookup failed:", profileResult.error.message);
        throw new Error("Group member names could not be loaded.");
      }
      profiles = profileResult.data ?? [];
    }
    namesById = new Map(
      counterpartIds.map((id) => [
        id,
        profiles.find((profile) => profile.id === id)?.display_name || "Member",
      ]),
    );
    if (avatarMigrationAvailable) {
      const avatarProfiles = profiles.filter(
        (profile): profile is typeof profile & { avatar_path: string } =>
          profile.avatar_path !== null,
      );
      const avatarLinks = await Promise.all(
        avatarProfiles.map(async (profile) => {
          const { data: signedUrl, error: signingError } = await supabase.storage
            .from("profile-avatars")
            .createSignedUrl(profile.avatar_path, 3600);
          if (signingError) {
            console.error("Balance profile photo link could not be created:", signingError.message);
            throw new Error("A group member profile photo could not be loaded.");
          }
          return [profile.id, signedUrl.signedUrl] as const;
        }),
      );
      for (const [profileId, signedUrl] of avatarLinks) {
        avatarUrlsById.set(profileId, signedUrl);
      }
    }
  }

  const title = direction === "owe" ? "You owe" : "Owed to you";

  return (
    <main className="balance-details-shell">
      <SettlementCelebration
        celebrationId={celebrateSettlement ? params.celebration : undefined}
      />
      <header className="balance-details-header">
        <div>
          <div className="eyebrow">BALANCE DETAILS</div>
          <h1>{title}</h1>
          <p>Amounts are shown with the person and group they belong to.</p>
        </div>
        <Link className="button button-outline button-small" href="/">
          Back to dashboard
        </Link>
      </header>

      <section aria-label={`${title} by group`} className="panel balance-details-panel">
        {params.notice === "settlement-recorded" && (
          <p aria-live="polite" className="form-message form-success" role="status">
            Settlement recorded. The balances below show what remains in each group.
          </p>
        )}
        {params.error && (
          <p aria-live="polite" className="form-message form-error" role="alert">
            {params.error === "settlement-details"
              ? "Enter a valid settlement amount."
              : "Settlement could not be recorded. Refresh the balances and try again."}
          </p>
        )}
        {details.length > 0 ? (
          <div className="balance-detail-list">
            {details.map((item) => {
              const counterpart = namesById.get(item.counterpart_id) ?? "Member";
              const { from_user_id, to_user_id } = getSettlementParties(
                user.id,
                item.counterpart_id,
                direction,
              );
              return (
                <article
                  className="balance-detail-row"
                  key={`${item.group_id}-${item.counterpart_id}`}
                >
                  <ProfileAvatar
                    className="avatar-color-2"
                    imageUrl={avatarUrlsById.get(item.counterpart_id) ?? null}
                    initials={counterpart.slice(0, 1).toUpperCase()}
                  />
                  <div className="balance-detail-person">
                    <strong>
                      {direction === "owe"
                        ? `You owe ${counterpart}`
                        : `${counterpart} owes you`}
                    </strong>
                    <span>{item.group_name}</span>
                  </div>
                  <strong className="balance-detail-amount">
                    {formatMoney(item.amount_minor, item.currency)}
                  </strong>
                  <details className="balance-settlement">
                    <summary className="button button-outline button-small">
                      Settle
                    </summary>
                    <SettlementForm
                      amountMinor={item.amount_minor}
                      currency={item.currency}
                      fromUserId={from_user_id}
                      groupId={item.group_id}
                      toUserId={to_user_id}
                    />
                  </details>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="balance-details-empty">
            <span className="settled-check">✓</span>
            <strong>{direction === "owe" ? "You don’t owe anyone." : "Nobody owes you right now."}</strong>
            <span>Your balances are clear across your groups.</span>
          </div>
        )}
      </section>
    </main>
  );
}
