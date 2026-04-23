import axios from "axios";
import { ENV } from "../config";

// ─────────────────────────────────────────────────────────────
//  Meta WhatsApp Cloud API  (free tier: 1000 conversations/month)
//
//  Setup (one-time, ~10 minutes):
//  1. Create a Meta Business account at business.facebook.com
//  2. Go to developers.facebook.com → create an app → add "WhatsApp" product
//  3. Get your Phone Number ID and generate a System User Access Token
//  4. The recipient must send you a message first (or use a template) to open a window
//  5. For a personal bot sending to yourself: send any message from your phone to the
//     test number, then your bot can reply for 24h (service conversation = free)
//
//  API docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages/text-messages
// ─────────────────────────────────────────────────────────────

const META_WA_URL = "https://graph.facebook.com/v25.0";
const MAX_LENGTH = 4096; // Meta Cloud API text message limit

/**
 * Split a long message into ≤4096 char chunks, breaking on newlines.
 * WhatsApp truncates silently — we send multiple messages instead.
 */
function chunkMessage(body: string): string[] {
  if (body.length <= MAX_LENGTH) return [body];
  const chunks: string[] = [];
  let start = 0;
  while (start < body.length) {
    let end = start + MAX_LENGTH;
    if (end < body.length) {
      const lastNewline = body.lastIndexOf("\n", end);
      if (lastNewline > start) end = lastNewline;
    }
    chunks.push(body.slice(start, end));
    start = end + 1;
  }
  return chunks;
}

export async function sendWhatsApp(body: string): Promise<void> {
  if (!ENV.WHATSAPP_ENABLED) {
    console.log("  ⚠ WhatsApp disabled");
    return;
  }
  if (!ENV.WHATSAPP_TOKEN || !ENV.WHATSAPP_PHONE_ID || !ENV.WHATSAPP_TO) {
    console.warn(
      "  ⚠ WhatsApp: missing WHATSAPP_TOKEN / WHATSAPP_PHONE_ID / WHATSAPP_TO"
    );
    return;
  }

  const chunks = chunkMessage(body);
  const url = `${META_WA_URL}/${ENV.WHATSAPP_PHONE_ID}/messages`;
  const headers = {
    Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}`,
    "Content-Type": "application/json",
  };

  for (let i = 0; i < chunks.length; i++) {
    await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: ENV.WHATSAPP_TO,
        type: "text",
        text: { body: chunks[i], preview_url: false },
      },
      { headers, timeout: 15_000 }
    );
    console.log(
      `  ✓ WhatsApp chunk ${i + 1}/${chunks.length} → ${ENV.WHATSAPP_TO}`
    );
    // Small delay between chunks to avoid rate limits
    if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 500));
  }
}
