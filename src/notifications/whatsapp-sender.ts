/**
 * WhatsApp sender via Green-API (https://green-api.com)
 * Sends the PSX PDF report as a file message to a WhatsApp number.
 *
 * Green-API endpoint used:
 *   POST https://{apiUrl}/waInstance{idInstance}/sendFileByUpload/{apiTokenInstance}
 *
 * The PDF buffer is attached as multipart/form-data with content-type application/pdf.
 * A text message with the analysis summary is sent first via sendMessage endpoint.
 */
import FormData from 'form-data';
import axios from 'axios';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import type { DeliveryLog } from '../types';

// ─── Green API helpers ────────────────────────────────────────────────────────

function baseUrl(): string {
  return `${CONFIG.GREEN_API_URL}/waInstance${CONFIG.GREEN_API_INSTANCE_ID}`;
}

function token(): string {
  return CONFIG.GREEN_API_TOKEN;
}

async function sendTextMessage(chatId: string, message: string): Promise<string> {
  const url = `${baseUrl()}/sendMessage/${token()}`;
  const { data } = await axios.post<{ idMessage: string }>(url, {
    chatId,
    message,
  }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 30_000,
  });
  return data.idMessage;
}

async function sendPdfFile(
  chatId:    string,
  pdfBuffer: Buffer,
  filename:  string,
  caption:   string,
): Promise<string> {
  const url = `${baseUrl()}/sendFileByUpload/${token()}`;

  const form = new FormData();
  form.append('chatId', chatId);
  form.append('fileName', filename);
  form.append('caption', caption);
  form.append('file', pdfBuffer, {
    filename,
    contentType: 'application/pdf',
    knownLength: pdfBuffer.length,
  });

  const { data } = await axios.post<{ idMessage: string }>(url, form, {
    headers: {
      ...form.getHeaders(),
    },
    timeout: 60_000,   // PDF upload can take longer
    maxContentLength: 50 * 1024 * 1024,  // 50 MB max
  });

  return data.idMessage;
}

// ─── Public export ────────────────────────────────────────────────────────────

export async function sendWhatsAppWithPdf(
  summary:   string,
  pdfBuffer: Buffer,
  filename:  string,
): Promise<DeliveryLog> {
  // chatId format: <countrycode><number>@c.us  e.g. 923001234567@c.us
  const chatId = CONFIG.WHATSAPP_CHAT_ID;

  try {
    // Step 1: Send text summary first so it appears above the PDF
    await sendTextMessage(chatId, summary);
    logger.debug({ chatId }, 'WhatsApp text summary sent');

    // Step 2: Send PDF file
    const caption = `📊 PSX Analysis Report — ${filename}`;
    const msgId   = await sendPdfFile(chatId, pdfBuffer, filename, caption);

    logger.info({ msgId, chatId, filename }, 'WhatsApp PDF sent via Green-API');
    return {
      channel:   'whatsapp',
      status:    'sent',
      timestamp: new Date(),
      messageId: msgId,
      attempts:  1,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ err, chatId }, 'WhatsApp Green-API send failed');
    return {
      channel:   'whatsapp',
      status:    'failed',
      timestamp: new Date(),
      error,
      attempts:  1,
    };
  }
}
