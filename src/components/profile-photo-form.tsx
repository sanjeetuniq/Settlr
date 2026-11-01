"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ProfileAvatar } from "@/components/profile-avatar";

export function ProfilePhotoForm({
  displayName,
  enabled,
  imageUrl,
}: {
  displayName: string;
  enabled: boolean;
  imageUrl: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setMessage("");
    setIsError(false);
    try {
      const response = await fetch("/api/profile/avatar", {
        method: "POST",
        body: new FormData(form),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        setMessage(result.error ?? "The profile photo could not be uploaded.");
        setIsError(true);
        return;
      }
      form.reset();
      setMessage("Your profile photo was updated.");
      router.refresh();
    } catch (error) {
      console.error("Profile photo request failed:", error);
      setMessage("The profile photo could not be uploaded. Check your connection and try again.");
      setIsError(true);
    } finally {
      setPending(false);
    }
  }

  async function removePhoto() {
    setPending(true);
    setMessage("");
    setIsError(false);
    try {
      const response = await fetch("/api/profile/avatar", { method: "DELETE" });
      const result = await response.json() as { error?: string; detached?: boolean };
      if (!response.ok) {
        if (result.detached) router.refresh();
        setMessage(result.error ?? "The profile photo could not be removed.");
        setIsError(true);
        return;
      }
      setMessage("Your profile photo was removed.");
      router.refresh();
    } catch (error) {
      console.error("Profile photo removal request failed:", error);
      setMessage("The profile photo could not be removed. Check your connection and try again.");
      setIsError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="profile-photo-editor">
      <ProfileAvatar
        className="avatar-current profile-settings-avatar"
        imageUrl={imageUrl}
        initials={displayName.slice(0, 1).toUpperCase()}
      />
      {enabled ? (
        <div className="profile-photo-controls">
          <form className="profile-photo-form" onSubmit={submit}>
            <label>
              Profile picture
              <input
                accept="image/png,image/jpeg,image/webp"
                disabled={pending}
                name="photo"
                required
                type="file"
              />
              <small>PNG, JPEG, or WebP · up to 2 MB · visible only to you and group members</small>
            </label>
            <button className="button button-outline button-small" disabled={pending} type="submit">
              {pending ? "Saving…" : "Upload photo"}
            </button>
          </form>
          {imageUrl && (
            <button
              className="button button-text button-small"
              disabled={pending}
              onClick={removePhoto}
              type="button"
            >
              Remove photo
            </button>
          )}
        </div>
      ) : (
        <p className="muted profile-photo-unavailable">
          Apply the profile-photo migration to enable profile pictures.
        </p>
      )}
      {message && (
        <p aria-live="polite" className={`form-message ${isError ? "form-error" : "form-success"}`} role={isError ? "alert" : "status"}>
          {message}
        </p>
      )}
    </div>
  );
}
