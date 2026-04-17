"use strict";
const nodemailer = require("nodemailer");
const { ENV } = require("../config");

let transporter = null;

function getTransporter() {
    if (!transporter) {
        transporter = nodemailer.createTransport({
            service: "gmail",
            auth: { user: ENV.EMAIL_USER, pass: ENV.EMAIL_PASS },
        });
    }
    return transporter;
}

async function sendEmail(subject, htmlBody, textFallback) {
    if (!ENV.EMAIL_ENABLED) { console.log("  ⚠ Email disabled"); return; }
    await getTransporter().sendMail({
        from: `PSX Agent <${ENV.EMAIL_USER}>`,
        to: ENV.EMAIL_TO,
        subject,
        html: htmlBody,
        text: textFallback || "",
    });
    console.log(`  ✓ Email → ${ENV.EMAIL_TO}`);
}

module.exports = { sendEmail };