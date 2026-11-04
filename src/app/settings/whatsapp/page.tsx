import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { WhatsAppSettings } from "@/components/whatsapp-settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Preference = {
  phone_e164: string | null;
  phone_verified_at: string | null;
  phone_discoverable: boolean;
  opted_in_at: string | null;
  expense_alerts: boolean;
  invitation_alerts: boolean;
  reminder_alerts: boolean;
  settlement_alerts: boolean;
};

export default async function WhatsAppPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) redirect("/sign-in?next=%2Fsettings%2Fwhatsapp");

  let available = false;
  let phoneSearchAvailable = false;
  let unavailableMessage: string | undefined;
  let preference: Preference | null = null;
  if (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createAdminClient();
    const result = await admin
      .from("whatsapp_preferences")
      .select("phone_e164, phone_verified_at, phone_discoverable, opted_in_at, expense_alerts, invitation_alerts, reminder_alerts, settlement_alerts")
      .eq("user_id", user.id)
      .maybeSingle();
    let preferenceData = result.data;
    let preferenceError = result.error;
    if (preferenceError && ["PGRST204", "42703"].includes(preferenceError.code)) {
      phoneSearchAvailable = false;
      const fallback = await admin
        .from("whatsapp_preferences")
        .select("phone_e164, phone_verified_at, opted_in_at, expense_alerts, invitation_alerts, reminder_alerts, settlement_alerts")
        .eq("user_id", user.id)
        .maybeSingle();
      preferenceData = fallback.data
        ? { ...fallback.data, phone_discoverable: false }
        : null;
      preferenceError = fallback.error;
    } else {
      phoneSearchAvailable = !preferenceError;
    }

    if (preferenceError && !["PGRST205", "42P01"].includes(preferenceError.code)) {
      console.error("WhatsApp preferences query failed:", preferenceError.message);
      unavailableMessage = "WhatsApp preferences are temporarily unavailable.";
    } else if (!preferenceError) {
      available = true;
      preference = preferenceData;
    }
  }

  return (
    <AppShell activePage="whatsapp" groupId={params.group}>
      <section className="welcome-banner">
        <div className="welcome-copy">
          <div className="eyebrow">OPTIONAL ALERTS</div>
          <h1>WhatsApp notifications</h1>
          <p>Manage your opt-in alerts separately from in-app settlement notifications.</p>
        </div>
      </section>
      <WhatsAppSettings
        alerts={{
          expenses: preference?.expense_alerts ?? true,
          invitations: preference?.invitation_alerts ?? true,
          reminders: preference?.reminder_alerts ?? true,
          settlements: preference?.settlement_alerts ?? true,
        }}
        available={available}
        unavailableMessage={unavailableMessage}
        optedIn={Boolean(preference?.opted_in_at)}
        phone={preference?.phone_e164 ?? null}
        phoneDiscoverable={preference?.phone_discoverable ?? false}
        phoneSearchAvailable={phoneSearchAvailable}
        providerConfigured={Boolean(
          process.env.WHATSAPP_ACCESS_TOKEN &&
          process.env.WHATSAPP_PHONE_NUMBER_ID &&
          /^v\d+\.\d+$/.test(process.env.WHATSAPP_GRAPH_API_VERSION ?? "") &&
          process.env.WHATSAPP_OTP_TEMPLATE_NAME &&
          process.env.WHATSAPP_ACTIVITY_TEMPLATE_NAME
        )}
        verified={Boolean(preference?.phone_verified_at)}
      />
      <footer className="app-footer">
        <span>SETTLR · SETTLES SETTLEMENTS IN STYLE 😉</span>
      </footer>
    </AppShell>
  );
}
