import "server-only";

function providerConfig() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = process.env.WHATSAPP_GRAPH_API_VERSION;
  const language = process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? "en_US";
  if (
    !accessToken ||
    !phoneNumberId ||
    !apiVersion ||
    !/^v\d+\.\d+$/.test(apiVersion)
  ) {
    return null;
  }
  return { accessToken, phoneNumberId, apiVersion, language };
}

export function isWhatsAppProviderConfigured() {
  return Boolean(providerConfig());
}

export async function sendWhatsAppTemplate(
  phone: string,
  templateName: string,
  parameters: string[],
  authentication = false,
) {
  const config = providerConfig();
  if (!config) return { ok: false as const, reason: "provider-unconfigured" as const };

  const components: {
    type: string;
    parameters?: { type: string; text: string }[];
    sub_type?: string;
    index?: string;
  }[] = [
    {
      type: "body",
      parameters: parameters.map((text) => ({ type: "text", text })),
    },
  ];
  if (authentication) {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: parameters[0] }],
    });
  }

  let response: Response;
  try {
    response = await fetch(
      `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: phone.replace("+", ""),
          type: "template",
          template: {
            name: templateName,
            language: { code: config.language },
            components,
          },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch (error) {
    console.error("WhatsApp provider request failed:", error);
    return { ok: false as const, reason: "network" as const };
  }

  if (!response.ok) {
    console.error("WhatsApp provider rejected a template message:", response.status);
    return { ok: false as const, reason: "provider-rejected" as const };
  }

  let messageId: string | undefined;
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "messages" in body &&
      Array.isArray(body.messages) &&
      typeof body.messages[0]?.id === "string"
    ) {
      messageId = body.messages[0].id;
    }
  } catch (error) {
    console.error("WhatsApp provider success response could not be parsed:", error);
  }
  return { ok: true as const, messageId };
}
