import nodemailer from 'nodemailer';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import type { DeliveryLog } from '../types';

function createTransport() {
  if (CONFIG.EMAIL_PROVIDER === 'sendgrid') {
    return nodemailer.createTransport({
      host: 'smtp.sendgrid.net', port: 587,
      auth: { user: 'apikey', pass: CONFIG.SENDGRID_API_KEY },
    });
  }
  // smtp / ses-smtp
  return nodemailer.createTransport({
    host: CONFIG.SMTP_HOST, port: CONFIG.SMTP_PORT,
    secure: CONFIG.SMTP_PORT === 465,
    auth: { user: CONFIG.SMTP_USER, pass: CONFIG.SMTP_PASS },
  });
}

export async function sendEmailWithPdf(
  subject:    string,
  bodyText:   string,
  pdfBuffer:  Buffer,
  filename:   string,
): Promise<DeliveryLog> {
  const transport = createTransport();
  try {
    const info = await transport.sendMail({
      from:    CONFIG.EMAIL_FROM,
      to:      CONFIG.EMAIL_TO,
      subject,
      text:    bodyText,
      html:    `<pre style="font-family:sans-serif;white-space:pre-wrap">${bodyText}</pre>`,
      attachments: [{
        filename,
        content:     pdfBuffer,
        contentType: 'application/pdf',
      }],
    });
    logger.info({ messageId: info.messageId }, 'Email sent');
    return { channel: 'email', status: 'sent', timestamp: new Date(), messageId: info.messageId, attempts: 1 };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'Email failed');
    return { channel: 'email', status: 'failed', timestamp: new Date(), error, attempts: 1 };
  } finally {
    transport.close();
  }
}
