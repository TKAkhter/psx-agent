import nodemailer from "nodemailer";
import { ENV } from "../config";
import { log } from "../logger";

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: ENV.EMAIL_USER, pass: ENV.EMAIL_PASS },
    });
  }
  return transporter;
}

/**
 * Sends the PSX report as an email with the PDF attached.
 * `bodyText` is a brief plain-text summary shown in the email body
 * (the full report lives in the attached PDF, generated in-memory
 * by pdf-generator.ts and never written to disk by this function).
 */
export async function sendEmail(
  subject: string,
  bodyText: string,
  pdfBuffer: Buffer,
  pdfFileName: string
): Promise<void> {
  if (!ENV.EMAIL_ENABLED) {
    log.warn("Email disabled (EMAIL_ENABLED=false)");
    return;
  }
  const t0 = Date.now();
  log.info("Sending email...", { to: ENV.EMAIL_TO, subject, pdfFile: pdfFileName });
  try {
    await getTransporter().sendMail({
    from: `PSX Agent <${ENV.EMAIL_USER}>`,
    to: ENV.EMAIL_TO,
    subject,
    text: bodyText,
    html: `<pre style="font-family:inherit;white-space:pre-wrap;">${bodyText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")}</pre><p>Full report attached as PDF.</p>`,
    attachments: [
      {
        filename: pdfFileName,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });
  } catch (err) {
    const e = err as { code?: string; responseCode?: number; message?: string };
    log.error("Email send failed", {
      ms: Date.now() - t0,
      to: ENV.EMAIL_TO,
      code: e?.code,
      smtpCode: e?.responseCode,
      message: e?.message,
      hint: e?.message?.includes("Invalid login") ? "Check EMAIL_USER / EMAIL_PASS (use App Password for Gmail)"
          : e?.message?.includes("ECONNREFUSED") ? "SMTP connection refused -- check network"
          : e?.message?.includes("self signed") ? "SSL cert error -- check email server config"
          : "Check EMAIL_USER, EMAIL_PASS, EMAIL_TO in .env",
    });
    throw err;
  }
  log.info("Email sent", { to: ENV.EMAIL_TO, subject, pdfFile: pdfFileName, pdfKb: Math.round(pdfBuffer.length / 1024) });
}
