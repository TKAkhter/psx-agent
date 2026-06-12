import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import path from "path";
import { ENV } from "../config";

// ─────────────────────────────────────────────────────────────
//  Green API  (https://green-api.com)
//  Free tier: 1500 messages/month
//
//  Setup (~5 min):
//  1. Register at green-api.com → create instance → scan QR with WhatsApp
//  2. Copy Instance ID and Token from the dashboard
//  3. WHATSAPP_CHAT_ID format: 923001234567@c.us  (country code, no +)
//
//  API docs: https://green-api.com/en/docs/api/sending/SendFileByUpload/
// ─────────────────────────────────────────────────────────────

const BASE_URL = process.env.GREEN_API_URL ?? "https://7107.api.greenapi.com";

function buildApiUrl(method: string): string {
  return `${BASE_URL}/waInstance${ENV.WHATSAPP_INSTANCE_ID}/${method}/${ENV.WHATSAPP_TOKEN}`;
}

/**
 * Send a PDF file to WhatsApp via Green API sendFileByUpload.
 * The caption (short text summary) appears below the file in chat.
 */
export async function sendWhatsAppPdf(pdfPath: string, caption: string): Promise<void> {
  if (!ENV.WHATSAPP_ENABLED) { console.log("  ⚠ WhatsApp disabled"); return; }
  if (!ENV.WHATSAPP_INSTANCE_ID || !ENV.WHATSAPP_TOKEN || !ENV.WHATSAPP_CHAT_ID) {
    console.warn("  ⚠ WhatsApp: missing WHATSAPP_INSTANCE_ID / WHATSAPP_TOKEN / WHATSAPP_CHAT_ID");
    return;
  }
  if (!fs.existsSync(pdfPath)) {
    console.warn(`  ⚠ WhatsApp: PDF not found at ${pdfPath}`);
    return;
  }

  const fileName = path.basename(pdfPath);
  const form     = new FormData();
  form.append("chatId",   ENV.WHATSAPP_CHAT_ID);
  form.append("caption",  caption.slice(0, 1024));  // Green API caption limit
  form.append("fileName", fileName);
  form.append("file", fs.createReadStream(pdfPath), {
    filename:    fileName,
    contentType: "application/pdf",
  });

  const url = buildApiUrl("sendFileByUpload");
  const res = await axios.post(url, form, {
    headers: { ...form.getHeaders() },
    timeout: 60_000,  // PDF upload can be slow on first send
  });

  console.log(`  ✓ WhatsApp PDF → ${ENV.WHATSAPP_CHAT_ID} (id: ${res.data?.idMessage ?? "—"})`);
}

/**
 * Send a plain text message via Green API sendMessage.
 * Used as a fallback or for the brief summary text.
 */
export async function sendWhatsAppText(text: string): Promise<void> {
  if (!ENV.WHATSAPP_ENABLED) { console.log("  ⚠ WhatsApp disabled"); return; }
  if (!ENV.WHATSAPP_INSTANCE_ID || !ENV.WHATSAPP_TOKEN || !ENV.WHATSAPP_CHAT_ID) {
    console.warn("  ⚠ WhatsApp: missing credentials");
    return;
  }

  // Green API text limit is 4096 chars — split if needed
  const MAX  = 4000;
  const chunks: string[] = [];
  let   cur   = text;
  while (cur.length > MAX) {
    const cut = cur.lastIndexOf("\n", MAX);
    chunks.push(cut > 0 ? cur.slice(0, cut) : cur.slice(0, MAX));
    cur = cur.slice(cut > 0 ? cut + 1 : MAX);
  }
  chunks.push(cur);

  const url = buildApiUrl("sendMessage");
  for (let i = 0; i < chunks.length; i++) {
    await axios.post(url, { chatId: ENV.WHATSAPP_CHAT_ID, message: chunks[i] }, {
      headers: { "Content-Type": "application/json" },
      timeout: 15_000,
    });
    console.log(`  ✓ WhatsApp text chunk ${i + 1}/${chunks.length} → ${ENV.WHATSAPP_CHAT_ID}`);
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 500));
  }
}