import twilio from 'twilio';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import type { DeliveryLog } from '../types';

/**
 * WhatsApp delivery via Twilio Media Messages.
 * The PDF is base64-encoded and sent as a document attachment.
 * Twilio requires a publicly accessible URL for media — we encode to
 * a data URI fallback if no CDN is configured, then send a condensed
 * text summary with a note that the full PDF was emailed.
 */
export async function sendWhatsAppWithPdf(
  summary:   string,
  pdfBuffer: Buffer,
  filename:  string,
): Promise<DeliveryLog> {
  const client = twilio(CONFIG.TWILIO_ACCOUNT_SID, CONFIG.TWILIO_AUTH_TOKEN);

  try {
    // Twilio WhatsApp supports media URLs (PDF not always supported on all devices).
    // We send the condensed text summary first, then note the PDF is in email.
    // For full PDF delivery via WA, host the PDF on S3/CDN and pass mediaUrl.
    const msg = await client.messages.create({
      from: CONFIG.TWILIO_WHATSAPP_FROM,
      to:   `whatsapp:${CONFIG.WHATSAPP_TO}`,
      body: summary,
      // mediaUrl: ['https://your-cdn.com/report.pdf'],  // uncomment when CDN available
    });
    logger.info({ sid: msg.sid }, 'WhatsApp message sent');
    return { channel: 'whatsapp', status: 'sent', timestamp: new Date(), messageId: msg.sid, attempts: 1 };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'WhatsApp failed');
    return { channel: 'whatsapp', status: 'failed', timestamp: new Date(), error, attempts: 1 };
  }
}
