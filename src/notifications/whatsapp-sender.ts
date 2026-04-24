import twilio from 'twilio';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import type { DeliveryLog } from '../types';

export async function sendWhatsApp(message: string): Promise<DeliveryLog> {
  if (CONFIG.WHATSAPP_PROVIDER !== 'twilio') {
    return {
      channel: 'whatsapp', status: 'failed', timestamp: new Date(),
      error: 'Only Twilio WhatsApp provider is currently implemented', attempts: 1,
    };
  }

  const client = twilio(CONFIG.TWILIO_ACCOUNT_SID, CONFIG.TWILIO_AUTH_TOKEN);

  try {
    const msg = await client.messages.create({
      from: CONFIG.TWILIO_WHATSAPP_FROM,
      to: `whatsapp:${CONFIG.WHATSAPP_TO}`,
      body: message,
    });

    logger.info({ sid: msg.sid }, 'WhatsApp message sent');
    return {
      channel: 'whatsapp', status: 'sent', timestamp: new Date(),
      messageId: msg.sid, attempts: 1,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'WhatsApp send failed');
    return { channel: 'whatsapp', status: 'failed', timestamp: new Date(), error, attempts: 1 };
  }
}
