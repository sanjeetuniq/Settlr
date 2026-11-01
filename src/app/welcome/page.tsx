import { LandingPage } from "@/components/landing-page";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;
  const inviteToken = invite && /^[0-9a-f]{64}$/.test(invite) ? invite : undefined;

  return (
    <LandingPage
      configured={isSupabaseConfigured()}
      inviteToken={inviteToken}
    />
  );
}
