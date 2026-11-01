"use client";

import { useActionState, useRef, useState } from "react";
import {
  createInvite,
  inviteExistingPeople,
  searchInvitePeople,
  sendEmailInvite,
  revokeInvite,
  type EmailInviteState,
  type InviteState,
  type PeopleSearchState,
} from "@/app/groups/actions";
import { PendingButton } from "@/components/pending-button";

export function InviteForm({
  groupId,
  activeInvites,
  phoneSearchAvailable,
}: {
  groupId: string;
  activeInvites: { id: string; expires_at: string }[];
  phoneSearchAvailable: boolean;
}) {
  const [section, setSection] = useState<"search" | "email" | "link">("search");
  const [searchState, searchAction, searchPending] = useActionState(
    searchInvitePeople,
    {} as PeopleSearchState,
  );
  const [emailState, emailAction, emailPending] = useActionState(
    sendEmailInvite,
    {} as EmailInviteState,
  );
  const [linkState, linkAction, linkPending] = useActionState(
    createInvite,
    {} as InviteState,
  );
  const [copyMessage, setCopyMessage] = useState("");
  const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
  const linkInput = useRef<HTMLInputElement>(null);

  return (
    <details className="invite-management">
      <summary className="button button-outline button-small">＋ Invite people</summary>
      <div className="invite-popover">
        <div className="invite-tabs" aria-label="Invitation methods">
          <button
            aria-pressed={section === "search"}
            className={section === "search" ? "invite-tab active" : "invite-tab"}
            onClick={() => setSection("search")}
            type="button"
          >
            Find a person
          </button>
          <button
            aria-pressed={section === "email"}
            className={section === "email" ? "invite-tab active" : "invite-tab"}
            onClick={() => setSection("email")}
            type="button"
          >
            Email invite
          </button>
          <button
            aria-pressed={section === "link"}
            className={section === "link" ? "invite-tab active" : "invite-tab"}
            onClick={() => setSection("link")}
            type="button"
          >
            Share a link
          </button>
        </div>

        {section === "search" && (
          <div className="invite-section">
            <p className="invite-explainer">
              {phoneSearchAvailable
                ? "Search by name, exact email, or an exact verified mobile number. People must opt in to phone search; their number stays private."
                : "Find a SETTLR user by name or exact email. Apply the phone-search migration to enable mobile-number lookup."}
            </p>
            <form
              action={searchAction}
              className="invite-search-form"
              onSubmit={() => setSelectedPeople([])}
            >
              <input name="groupId" type="hidden" value={groupId} />
              <label>
                {phoneSearchAvailable ? "Name, email, or mobile" : "Name or email"}
                <input
                  autoComplete="off"
                  defaultValue={searchState.query}
                  maxLength={254}
                  minLength={2}
                  name="query"
                  placeholder={phoneSearchAvailable ? "Name, email, or +14155550123" : "Search people"}
                  required
                />
              </label>
              <PendingButton className="button button-outline button-small" disabled={searchPending} pendingLabel="Searching…">
                Search
              </PendingButton>
            </form>
            {searchState.error && (
              <p aria-live="polite" className="form-message form-error">{searchState.error}</p>
            )}
            {searchState.people && (
              searchState.people.length > 0 ? (
                <form action={inviteExistingPeople} className="invite-people-form">
                  <input name="groupId" type="hidden" value={groupId} />
                  <div className="invite-people-results" aria-live="polite">
                    {searchState.people.map((person) => (
                      <label className="invite-person-row" key={person.id}>
                        {!person.is_member && (
                          <input
                            checked={selectedPeople.includes(person.id)}
                            className="invite-person-checkbox"
                            name="userId"
                            onChange={(event) => {
                              setSelectedPeople((current) =>
                                event.target.checked
                                  ? [...current, person.id]
                                  : current.filter((id) => id !== person.id),
                              );
                            }}
                            type="checkbox"
                            value={person.id}
                          />
                        )}
                        <span className="invite-person-name">
                          <strong>{person.display_name}</strong>
                          {person.email && <small>{person.email}</small>}
                        </span>
                        {person.is_member && (
                          <span className="invite-already-added">Already in group</span>
                        )}
                      </label>
                    ))}
                  </div>
                  {searchState.people.some((person) => !person.is_member) && (
                    <PendingButton
                      className="button button-primary button-small invite-add-selected"
                      disabled={selectedPeople.length === 0}
                      pendingLabel="Adding…"
                    >
                      Add {selectedPeople.length || ""} selected
                    </PendingButton>
                  )}
                </form>
              ) : (
                <p aria-live="polite" className="invite-explainer">
                  No matching SETTLR users. Use Email invite to invite this person to join.
                </p>
              )
            )}
          </div>
        )}

        {section === "email" && (
          <div className="invite-section">
            <p className="invite-explainer">
              Send a seven-day invitation to a new address. If they already use SETTLR, their account is added directly.
            </p>
            <form action={emailAction} className="invite-search-form">
              <input name="groupId" type="hidden" value={groupId} />
              <label>
                Email address
                <input
                  autoComplete="email"
                  defaultValue={emailState.email}
                  maxLength={254}
                  name="email"
                  placeholder="friend@example.com"
                  required
                  type="email"
                />
              </label>
              <PendingButton className="button button-primary button-small" disabled={emailPending} pendingLabel="Sending…">
                Send invite
              </PendingButton>
            </form>
            {emailState.error && (
              <p aria-live="polite" className="form-message form-error">{emailState.error}</p>
            )}
            {emailState.success && (
              <p aria-live="polite" className="form-message form-success">{emailState.success}</p>
            )}
          </div>
        )}

        {section === "link" && (
          <div className="invite-section">
            <p className="invite-explainer">Create a private invitation link that expires in seven days.</p>
            {!linkState.link && (
              <form action={linkAction}>
                <input name="groupId" type="hidden" value={groupId} />
                <PendingButton className="button button-outline button-small" disabled={linkPending} pendingLabel="Creating link…">
                  Create invite link
                </PendingButton>
              </form>
            )}
            {linkState.error && <p className="form-message form-error">{linkState.error}</p>}
            {linkState.link && (
              <div className="invite-link-field">
                <input
                  aria-label="Group invitation link"
                  onFocus={(event) => event.currentTarget.select()}
                  ref={linkInput}
                  readOnly
                  value={linkState.link}
                />
                <button
                  className="button button-outline button-small"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(linkState.link ?? "");
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
          </div>
        )}

        {activeInvites.length > 0 && (
          <div className="active-invites">
            {activeInvites.map((invite) => (
              <form action={revokeInvite} key={invite.id}>
                <input name="groupId" type="hidden" value={groupId} />
                <input name="inviteId" type="hidden" value={invite.id} />
                <span>Link expires {new Date(invite.expires_at).toLocaleDateString("en-IN")}</span>
                <PendingButton ariaLabel="Revoke invite link" className="button button-text button-small" pendingLabel="…">Revoke</PendingButton>
              </form>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
