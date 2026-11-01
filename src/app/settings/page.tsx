import Link from "next/link";
import { redirect } from "next/navigation";
import { ProfilePhotoForm } from "@/components/profile-photo-form";
import { updateProfileName } from "@/app/settings/actions";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<{ error?: string; notice?: string }>;

const errorMessages: Record<string, string> = {
  "profile-name": "Enter a name between 1 and 80 characters.",
  "profile-save": "Your profile name could not be saved. Try again.",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) {
    console.error("Settings authentication lookup failed:", authError.message);
    redirect("/sign-in?next=%2Fsettings");
  }
  if (!user) redirect("/sign-in?next=%2Fsettings");

  const { data: profileWithAvatar, error: profileError } = await supabase
    .from("profiles")
    .select("display_name, avatar_path")
    .eq("id", user.id)
    .maybeSingle();
  let avatarMigrationAvailable = !profileError;
  let displayName = profileWithAvatar?.display_name ?? "";
  const avatarPath = profileWithAvatar?.avatar_path ?? null;
  if (profileError && ["PGRST204", "42703"].includes(profileError.code)) {
    const fallbackProfile = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();
    if (fallbackProfile.error) {
      console.error("Settings profile lookup failed:", fallbackProfile.error.message);
      throw new Error("Your profile could not be loaded.");
    }
    displayName = fallbackProfile.data?.display_name ?? "";
    avatarMigrationAvailable = false;
  }
  if (profileError && avatarMigrationAvailable) {
    console.error("Settings profile lookup failed:", profileError.message);
    throw new Error("Your profile could not be loaded.");
  }
  if (profileError) {
    console.warn("Profile-photo migration is not available; photo controls are disabled.");
  }

  let avatarUrl: string | null = null;
  if (avatarPath) {
    const { data, error } = await supabase.storage
      .from("profile-avatars")
      .createSignedUrl(avatarPath, 3600);
    if (error) {
      console.error("Profile photo link could not be created:", error.message);
      throw new Error("Your profile photo could not be loaded.");
    }
    avatarUrl = data.signedUrl;
  }
  return (
    <main className="profile-settings-shell">
      <header className="profile-settings-header">
        <div>
          <div className="eyebrow">YOUR ACCOUNT</div>
          <h1>Profile settings</h1>
        </div>
        <Link className="button button-outline button-small" href="/">
          Back to dashboard
        </Link>
      </header>
      <section className="panel profile-settings-panel">
        <div className="eyebrow">YOUR PROFILE PHOTO</div>
        <h2>Profile picture</h2>
        <p className="muted">
          A photo helps people recognize you in your groups.
        </p>
        <ProfilePhotoForm
          displayName={displayName || "Member"}
          enabled={avatarMigrationAvailable}
          imageUrl={avatarUrl}
        />
      </section>
      <section className="panel profile-settings-panel">
        <div className="eyebrow">NAME SHOWN TO YOUR GROUPS</div>
        <h2>Your profile name</h2>
        <p className="muted">
          This is the name people see when you pay or split an expense.
        </p>
        {params.error && (
          <p aria-live="polite" className="form-message form-error" role="alert">
            {errorMessages[params.error] ?? "Your profile could not be updated."}
          </p>
        )}
        {params.notice === "profile-saved" && (
          <p aria-live="polite" className="form-message form-success" role="status">
            Your profile name was updated.
          </p>
        )}
        <form action={updateProfileName} className="stack-form profile-editor">
          <label>
            Profile name
            <input
              autoComplete="name"
              defaultValue={displayName}
              maxLength={80}
              name="displayName"
              placeholder="Your name"
              required
            />
          </label>
          <button className="button button-primary">Save profile name</button>
        </form>
      </section>
    </main>
  );
}