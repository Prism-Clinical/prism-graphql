import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST || 'localhost';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@prism-clinical.com';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const ADMIN_APP_URL = process.env.ADMIN_APP_URL || 'http://localhost:3001';

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: SMTP_USER && SMTP_PASS ? {
    user: SMTP_USER,
    pass: SMTP_PASS,
  } : undefined,
});

export async function sendVerificationEmail(
  email: string,
  token: string,
  userType: 'ADMIN' | 'PROVIDER',
  firstName: string
): Promise<boolean> {
  const baseUrl = userType === 'ADMIN' ? ADMIN_APP_URL : APP_URL;
  const verifyUrl = `${baseUrl}/verify-email?token=${token}`;

  const mailOptions = {
    from: FROM_EMAIL,
    to: email,
    subject: 'Verify your Prism account',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a365d;">Welcome to Prism, ${firstName}!</h2>
        <p>Thank you for signing up. Please verify your email address by clicking the button below:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verifyUrl}" 
             style="background-color: #3182ce; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Verify Email Address
          </a>
        </div>
        <p>Or copy and paste this link into your browser:</p>
        <p style="color: #4a5568; word-break: break-all;">${verifyUrl}</p>
        <p style="color: #718096; font-size: 14px;">This link will expire in 24 hours.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
        <p style="color: #a0aec0; font-size: 12px;">If you didn't create an account with Prism, you can safely ignore this email.</p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('Failed to send verification email:', error);
    return false;
  }
}

export async function sendPasswordResetEmail(
  email: string,
  token: string,
  userType: 'ADMIN' | 'PROVIDER',
  firstName: string
): Promise<boolean> {
  const baseUrl = userType === 'ADMIN' ? ADMIN_APP_URL : APP_URL;
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;

  const mailOptions = {
    from: FROM_EMAIL,
    to: email,
    subject: 'Reset your Prism password',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a365d;">Password Reset Request</h2>
        <p>Hi ${firstName},</p>
        <p>We received a request to reset your password. Click the button below to create a new password:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" 
             style="background-color: #3182ce; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Reset Password
          </a>
        </div>
        <p>Or copy and paste this link into your browser:</p>
        <p style="color: #4a5568; word-break: break-all;">${resetUrl}</p>
        <p style="color: #718096; font-size: 14px;">This link will expire in 1 hour.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
        <p style="color: #a0aec0; font-size: 12px;">If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    return false;
  }
}

export async function sendProviderApprovalNotification(
  email: string,
  firstName: string,
  approved: boolean,
  notes?: string
): Promise<boolean> {
  const mailOptions = {
    from: FROM_EMAIL,
    to: email,
    subject: approved ? 'Your Prism account has been approved!' : 'Update on your Prism account application',
    html: approved ? `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #38a169;">Welcome to Prism, ${firstName}!</h2>
        <p>Great news! Your account has been approved by our admin team.</p>
        <p>You can now log in to Prism and start using the platform:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${APP_URL}/login" 
             style="background-color: #38a169; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Log In to Prism
          </a>
        </div>
        <p style="color: #718096; font-size: 14px;">If you have any questions, please contact our support team.</p>
      </div>
    ` : `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #c53030;">Account Application Update</h2>
        <p>Hi ${firstName},</p>
        <p>We've reviewed your Prism account application and unfortunately we cannot approve it at this time.</p>
        ${notes ? `<p><strong>Reason:</strong> ${notes}</p>` : ''}
        <p>If you believe this was a mistake or have questions, please contact our support team.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
        <p style="color: #a0aec0; font-size: 12px;">Prism Clinical</p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('Failed to send approval notification:', error);
    return false;
  }
}

export async function sendNewApprovalRequestNotification(
  adminEmails: string[],
  providerName: string,
  providerEmail: string,
  institution: string
): Promise<boolean> {
  const mailOptions = {
    from: FROM_EMAIL,
    to: adminEmails,
    subject: 'New Provider Registration Pending Approval',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a365d;">New Provider Registration</h2>
        <p>A new provider has registered and is awaiting approval:</p>
        <ul style="color: #4a5568;">
          <li><strong>Name:</strong> ${providerName}</li>
          <li><strong>Email:</strong> ${providerEmail}</li>
          <li><strong>Institution:</strong> ${institution}</li>
        </ul>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${ADMIN_APP_URL}/provider-approvals" 
             style="background-color: #3182ce; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Review Application
          </a>
        </div>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('Failed to send approval request notification:', error);
    return false;
  }
}
