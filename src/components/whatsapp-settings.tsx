"use client";

import { useActionState } from "react";
import {
  requestWhatsAppCode,
  saveWhatsAppPreferences,
  verifyWhatsAppCode,
  type WhatsAppActionState,
} from "@/app/notifications/whatsapp-actions";
import { PendingButton } from "@/components/pending-button";

const initialState: WhatsAppActionState = {};

export function WhatsAppSettings({
  available,
  unavailableMessage,
  phone,
  verified,
  providerConfigured,
  optedIn,
  alerts,
}: {
  available: boolean;
  unavailableMessage?: string;
  phone: string | null;
  verified: boolean;
  providerConfigured: boolean;
  optedIn: boolean;
  alerts: {
    expenses: boolean;
    invitations: boolean;
    reminders: boolean;
    settlements: boolean;
  };
}) {
  const [requestState, requestAction, requestPending] = useActionState(
    requestWhatsAppCode,
    initialState,
  );
  const [verifyState, verifyAction, verifyPending] = useActionState(
    verifyWhatsAppCode,
    initialState,
  );
  const [preferencesState, preferencesAction, preferencesPending] = useActionState(
    saveWhatsAppPreferences,
    initialState,
  );

  if (!available) {
    return (
      <section aria-labelledby="whatsapp-heading" className="panel whatsapp-panel">
        <div className="eyebrow">OPTIONAL ALERTS</div>
        <h2 id="whatsapp-heading">WhatsApp notifications</h2>
        <p className="muted">
          {unavailableMessage ??
            "Apply the WhatsApp migration and configure the server-only Meta Cloud API settings to enable verified, opt-in alerts."}
        </p>
      </section>
    );
  }

  const message =
    preferencesState.error ??
    preferencesState.success ??
    verifyState.error ??
    verifyState.success ??
    requestState.error ??
    requestState.success;
  const isError = Boolean(
    preferencesState.error || verifyState.error || requestState.error,
  );

  return (
    <section aria-labelledby="whatsapp-heading" className="panel whatsapp-panel">
      <div className="eyebrow">OPTIONAL ALERTS</div>
      <h2 id="whatsapp-heading">WhatsApp notifications</h2>
      <p className="muted">
        Choose activity alerts for your verified number. Messages are brief and never include balances or payment amounts.
      </p>
      {!verified ? (
        <>
          {!providerConfigured && (
            <p className="form-message form-error">
              Meta WhatsApp settings are not configured yet. Contact{" "}
              <a href="mailto:helpdesk_settlr@gmail.com">helpdesk_settlr@gmail.com</a>.
            </p>
          )}
          <form action={requestAction} className="whatsapp-phone-form">
            <label>
              WhatsApp number in international format
              <input
                autoComplete="tel"
                defaultValue={requestState.phone ?? phone ?? ""}
                inputMode="tel"
                maxLength={16}
                name="phone"
                placeholder="+14155550123"
                required
                type="tel"
              />
            </label>
            <PendingButton
              className="button button-outline button-small"
              disabled={requestPending || !providerConfigured}
              pendingLabel="Sending code…"
            >
              Send verification code
            </PendingButton>
          </form>
          {requestState.success && requestState.phone && (
            <form action={verifyAction} className="whatsapp-verify-form">
              <label>
                Six-digit code sent to {requestState.phone}
                <input
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  minLength={6}
                  name="code"
                  pattern="[0-9]{6}"
                  required
                />
              </label>
              <PendingButton
                className="button button-primary button-small"
                disabled={verifyPending}
                pendingLabel="Verifying…"
              >
                Verify number
              </PendingButton>
            </form>
          )}
        </>
      ) : (
        <>
          {!providerConfigured && (
            <p className="form-message form-error">
              Meta WhatsApp delivery is not configured. You can turn off existing alerts here; new opt-ins are disabled.
              {" "}
              <a href="mailto:helpdesk_settlr@gmail.com">Contact support</a>.
            </p>
          )}
          <p className="verified-phone">
            <span aria-hidden="true">✓</span> Verified: {phone}
          </p>
          <form action={preferencesAction} className="whatsapp-preferences-form">
            <fieldset>
              <legend>Activity you want to hear about</legend>
              <label><input defaultChecked={alerts.expenses} name="expenseAlerts" type="checkbox" /> Expense activity</label>
              <label><input defaultChecked={alerts.invitations} name="invitationAlerts" type="checkbox" /> People joining your groups</label>
              <label><input defaultChecked={alerts.reminders} name="reminderAlerts" type="checkbox" /> In-app reminders</label>
              <label><input defaultChecked={alerts.settlements} name="settlementAlerts" type="checkbox" /> Settlement updates</label>
            </fieldset>
            <label className="whatsapp-opt-in">
              <input
                defaultChecked={optedIn}
                disabled={!providerConfigured && !optedIn}
                name="optIn"
                type="checkbox"
              />
              Enable WhatsApp notifications for the selected activity.
            </label>
            <label className="whatsapp-consent">
              <input defaultChecked={optedIn} name="consent" type="checkbox" />
              I agree to receive the selected SETTLR WhatsApp notifications. I can turn them off here at any time.
            </label>
            <PendingButton
              className="button button-primary button-small"
              disabled={preferencesPending}
              pendingLabel="Saving…"
            >
              Save preferences
            </PendingButton>
          </form>
        </>
      )}
      {message && (
        <p aria-live="polite" className={`form-message ${isError ? "form-error" : "form-success"}`}>
          {message}
        </p>
      )}
      <small className="whatsapp-support">
        Questions? <a href="mailto:helpdesk_settlr@gmail.com">helpdesk_settlr@gmail.com</a>
      </small>
    </section>
  );
}
