import nodemailer from "nodemailer";
import fs from "fs";
import { ENV } from "../config";

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
 * Send email with PDF attached.
 * Falls back to plain-text body if pdfPath is not provided.
 */
export async function sendEmail(
  subject: string,
  textBody: string,
  pdfPath?: string
): Promise<void> {
  if (!ENV.EMAIL_ENABLED) {
    console.log("  ⚠ Email disabled");
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mailOptions: Record<string, any> = {
    from: `PSX Agent <${ENV.EMAIL_USER}>`,
    to: ENV.EMAIL_TO,
    subject,
    text: textBody,
    html: `<pre style="font-family:monospace;font-size:12px;">${textBody
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")}</pre>`,
  };

  if (pdfPath && fs.existsSync(pdfPath)) {
    mailOptions.attachments = [
      {
        filename: `psx-report.pdf`,
        path: pdfPath,
        contentType: "application/pdf",
      },
    ];
    console.log(`  ✓ Attaching PDF: ${pdfPath}`);
  }

  await getTransporter().sendMail(mailOptions);
  console.log(`  ✓ Email → ${ENV.EMAIL_TO}`);
}
