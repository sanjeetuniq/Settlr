"use client";

import { useActionState, useRef, useState } from "react";
import { createInvite, revokeInvite, type InviteState } from "@/app/groups/actions";

export function InviteForm({
  groupId,
  activeInvites,
}: {
  groupId: string;
  activeInvites: { id: string; expires_at: string }[];
}) {
  const initialState: InviteState = {};
  const [state, action, pending] = useActionState(createInvite, initialState);
  const [copyMessage, setCopyMessage] = useState("");
  const linkInput = useRef<HTMLInputElement>(null);

  return (
    <div className="invite-management">
      <form action={action} className="invite-form">
        <input name="groupId" type="hidden" value={groupId} />
        <button className="button button-outline" disabled={pending}>
          {pending ? "Creating link…" : "＋ Invite friends"}
        </button>
        {state.error && <p className="form-message form-error">{state.error}</p>}
        {state.link && (
          <div className="invite-link-field">
            <span>Copy this link · expires in 7 days</span>
            <input
              aria-label="Group invitation link"
              onFocus={(event) => event.currentTarget.select()}
              ref={linkInput}
              readOnly
              value={state.link}
            />
            <button
              className="button button-outline button-small"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(state.link ?? "");
                  setCopyMessage("Invite link copied.");
                } catch {
                  linkInput.current?.select();
                  setCopyMessage("Select the link and copy it.");
                }
              }}
              type="button"
            >
              Copy link
            </button>
            {copyMessage && <span className="copy-message">{copyMessage}</span>}
          </div>
        )}
      </form>
      {activeInvites.length > 0 && (
        <div className="active-invites">
          {activeInvites.map((invite) => (
            <form action={revokeInvite} key={invite.id}>
              <input name="groupId" type="hidden" value={groupId} />
              <input name="inviteId" type="hidden" value={invite.id} />
              <span>Link expires {new Date(invite.expires_at).toLocaleDateString("en-IN")}</span>
              <button aria-label="Revoke invite link" title="Revoke invite link">Revoke</button>
            </form>
          ))}
        </div>
      )}
    </div>
  );
}
