import axios from "axios";
import FormData from "form-data";
import { ENV } from "../config";
import { log } from "../logger";

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

function buildApiUrl(method: string): string {
  return `${ENV.GREEN_API_URL}/waInstance${ENV.WHATSAPP_INSTANCE_ID}/${method}/${ENV.WHATSAPP_TOKEN}`;
}

/**
 * Send a PDF (as an in-memory Buffer) to WhatsApp via Green API
 * sendFileByUpload. No file is ever written to disk — the buffer
 * is streamed directly into the multipart upload. The caption
 * (short text summary) appears below the file in chat.
 */
export async function sendWhatsAppPdf(
  pdfBuffer: Buffer,
  fileName: string,
  caption: string
): Promise<void> {
  if (!ENV.WHATSAPP_ENABLED) {
    log.warn("WhatsApp disabled (WHATSAPP_ENABLED=false)");
    return;
  }
  if (!ENV.WHATSAPP_INSTANCE_ID || !ENV.WHATSAPP_TOKEN || !ENV.WHATSAPP_CHAT_ID) {
    log.warn("WhatsApp credentials missing", { missing: [!ENV.WHATSAPP_INSTANCE_ID && "WHATSAPP_INSTANCE_ID", !ENV.WHATSAPP_TOKEN && "WHATSAPP_TOKEN", !ENV.WHATSAPP_CHAT_ID && "WHATSAPP_CHAT_ID"].filter(Boolean).join(", ") });
    return;
  }

  const form = new FormData();
  form.append("chatId", ENV.WHATSAPP_CHAT_ID);
  form.append("caption", caption.slice(0, 1024)); // Green API caption limit
  form.append("fileName", fileName);
  form.append("file", pdfBuffer, {
    filename: fileName,
    contentType: "application/pdf",
  });

  const url = buildApiUrl("sendFileByUpload");
  const t0 = Date.now();
  log.info("WhatsApp: uploading PDF...", { chatId: ENV.WHATSAPP_CHAT_ID, file: fileName, kb: Math.round(pdfBuffer.length / 1024) });
  let res: any;
  try {
    res = await axios.post(url, form, {
      headers: { ...form.getHeaders() },
      timeout: 60_000,
    });
  } catch (err) {
    const e = err as { response?: { status?: number; data?: unknown }; code?: string; message?: string };
    log.error("WhatsApp PDF upload failed", {
      ms: Date.now() - t0,
      chatId: ENV.WHATSAPP_CHAT_ID,
      httpStatus: e?.response?.status,
      netCode: e?.code,
      message: e?.message,
      body: JSON.stringify(e?.response?.data ?? "").slice(0, 200),
      hint: e?.response?.status === 401 ? "Check WHATSAPP_TOKEN and WHATSAPP_INSTANCE_ID"
          : e?.response?.status === 466 ? "Green API instance not authorised -- re-scan QR code"
          : e?.code === "ECONNREFUSED" ? "Cannot reach GREEN_API_URL -- check GREEN_API_URL in .env"
          : "Check Green API dashboard for instance status",
    });
    throw err;
  }
  const msgId = res.data?.idMessage ?? res.data?.id ?? "—";
  log.info("WhatsApp PDF sent", { chatId: ENV.WHATSAPP_CHAT_ID, msgId, ms: Date.now() - t0, kb: Math.round(pdfBuffer.length / 1024) });
}

/**
 * Send a plain text message via Green API sendMessage.
 * Used for the brief summary text that accompanies the PDF.
 */
export async function sendWhatsAppText(text: string): Promise<void> {
  if (!ENV.WHATSAPP_ENABLED) {
    log.warn("WhatsApp disabled (WHATSAPP_ENABLED=false)");
    return;
  }
  if (!ENV.WHATSAPP_INSTANCE_ID || !ENV.WHATSAPP_TOKEN || !ENV.WHATSAPP_CHAT_ID) {
    log.warn("WhatsApp text: credentials missing");
    return;
  }

  // Green API text limit is 4096 chars — split if needed
  const MAX = 4000;
  const chunks: string[] = [];
  let cur = text;
  while (cur.length > MAX) {
    const cut = cur.lastIndexOf("\n", MAX);
    chunks.push(cut > 0 ? cur.slice(0, cut) : cur.slice(0, MAX));
    cur = cur.slice(cut > 0 ? cut + 1 : MAX);
  }
  chunks.push(cur);

  const url = buildApiUrl("sendMessage");
  for (let i = 0; i < chunks.length; i++) {
    try {
      await axios.post(
        url,
        { chatId: ENV.WHATSAPP_CHAT_ID, message: chunks[i] },
        { headers: { "Content-Type": "application/json" }, timeout: 15_000 }
      );
      log.info(`WhatsApp text chunk ${i + 1}/${chunks.length} sent`, { chatId: ENV.WHATSAPP_CHAT_ID });
    } catch (err) {
      const e = err as { response?: { status?: number; data?: unknown }; code?: string; message?: string };
      log.error(`WhatsApp text chunk ${i + 1}/${chunks.length} failed`, {
        httpStatus: e?.response?.status,
        message: e?.message,
        body: JSON.stringify(e?.response?.data ?? "").slice(0, 200),
      });
      throw err;
    }
    if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 500));
  }
}
