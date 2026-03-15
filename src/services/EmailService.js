const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

/**
 * EmailService - Verwaltung von Email-Accounts und Versand
 * 
 * Unterstützte Anbieter:
 * - Gmail (OAuth2)
 * - Outlook/Hotmail
 * - Custom SMTP
 * - Mailgun (API)
 * - SendGrid (API)
 */
class EmailService {
  constructor(config) {
    this.accountsDir = config.accountsDir;
    this.accounts = new Map();
    this.transporters = new Map();
  }

  async initialize() {
    console.log('Initializing Email Service...');
    await fs.mkdir(this.accountsDir, { recursive: true });
    await this.loadAccounts();
    console.log(`Email Service initialized with ${this.accounts.size} accounts`);
  }

  // ==================== ACCOUNT MANAGEMENT ====================

  async createAccount(config) {
    const {
      provider,
      email,
      displayName,
      credentials
    } = config;

    const accountId = Buffer.from(email).toString('base64');
    
    const account = {
      id: accountId,
      provider,
      email,
      displayName: displayName || email,
      credentials,
      created: new Date().toISOString(),
      enabled: true
    };

    // Speichere Account
    const accountPath = path.join(this.accountsDir, `${accountId}.json`);
    await fs.writeFile(accountPath, JSON.stringify(account, null, 2), 'utf-8');

    // Erstelle Transporter
    await this.createTransporter(account);

    this.accounts.set(accountId, account);
    
    console.log(`Email account created: ${email} (${provider})`);
    
    return account;
  }

  async loadAccounts() {
    try {
      const files = await fs.readdir(this.accountsDir);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const accountPath = path.join(this.accountsDir, file);
          const accountData = await fs.readFile(accountPath, 'utf-8');
          const account = JSON.parse(accountData);
          
          if (account.enabled) {
            await this.createTransporter(account);
            this.accounts.set(account.id, account);
          }
        }
      }
    } catch (error) {
      console.error('Error loading email accounts:', error);
    }
  }

  // ==================== TRANSPORTER CREATION ====================

  async createTransporter(account) {
    let transporter;

    switch (account.provider) {
      case 'gmail':
        transporter = await this.createGmailTransporter(account);
        break;
      case 'outlook':
        transporter = this.createOutlookTransporter(account);
        break;
      case 'smtp':
        transporter = this.createSMTPTransporter(account);
        break;
      case 'mailgun':
        transporter = this.createMailgunTransporter(account);
        break;
      case 'sendgrid':
        transporter = this.createSendGridTransporter(account);
        break;
      default:
        throw new Error(`Unknown email provider: ${account.provider}`);
    }

    this.transporters.set(account.id, transporter);
    return transporter;
  }

  // ==================== GMAIL ====================

  async createGmailTransporter(account) {
    const oauth2Client = new google.auth.OAuth2(
      account.credentials.clientId,
      account.credentials.clientSecret,
      account.credentials.redirectUri
    );

    oauth2Client.setCredentials({
      refresh_token: account.credentials.refreshToken
    });

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: account.email,
        clientId: account.credentials.clientId,
        clientSecret: account.credentials.clientSecret,
        refreshToken: account.credentials.refreshToken,
        accessToken: await oauth2Client.getAccessToken()
      }
    });

    return transporter;
  }

  // Gmail OAuth Setup Helper
  async setupGmailOAuth() {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      'http://localhost:3000/oauth/callback'
    );

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://mail.google.com/',
        'https://www.googleapis.com/auth/gmail.send'
      ]
    });

    return {
      authUrl,
      oauth2Client
    };
  }

  async handleGmailOAuthCallback(code) {
    const { oauth2Client } = await this.setupGmailOAuth();
    const { tokens } = await oauth2Client.getToken(code);
    return tokens.refresh_token;
  }

  // ==================== OUTLOOK ====================

  createOutlookTransporter(account) {
    return nodemailer.createTransport({
      service: 'hotmail',
      auth: {
        user: account.email,
        pass: account.credentials.password
      }
    });
  }

  // ==================== CUSTOM SMTP ====================

  createSMTPTransporter(account) {
    return nodemailer.createTransport({
      host: account.credentials.host,
      port: account.credentials.port || 587,
      secure: account.credentials.secure || false,
      auth: {
        user: account.credentials.username || account.email,
        pass: account.credentials.password
      }
    });
  }

  // ==================== MAILGUN ====================

  createMailgunTransporter(account) {
    return {
      sendMail: async (mailOptions) => {
        const response = await axios.post(
          `https://api.mailgun.net/v3/${account.credentials.domain}/messages`,
          {
            from: mailOptions.from || account.email,
            to: mailOptions.to,
            subject: mailOptions.subject,
            text: mailOptions.text,
            html: mailOptions.html
          },
          {
            auth: {
              username: 'api',
              password: account.credentials.apiKey
            }
          }
        );
        return response.data;
      }
    };
  }

  // ==================== SENDGRID ====================

  createSendGridTransporter(account) {
    return {
      sendMail: async (mailOptions) => {
        const response = await axios.post(
          'https://api.sendgrid.com/v3/mail/send',
          {
            personalizations: [{
              to: [{ email: mailOptions.to }]
            }],
            from: { email: mailOptions.from || account.email },
            subject: mailOptions.subject,
            content: [{
              type: 'text/html',
              value: mailOptions.html || mailOptions.text
            }]
          },
          {
            headers: {
              'Authorization': `Bearer ${account.credentials.apiKey}`,
              'Content-Type': 'application/json'
            }
          }
        );
        return response.data;
      }
    };
  }

  // ==================== EMAIL SENDING ====================

  async sendEmail(config) {
    const {
      accountId,
      to,
      subject,
      text,
      html,
      attachments = []
    } = config;

    const transporter = this.transporters.get(accountId);
    if (!transporter) {
      throw new Error(`Email account not found: ${accountId}`);
    }

    const account = this.accounts.get(accountId);

    const mailOptions = {
      from: `${account.displayName} <${account.email}>`,
      to,
      subject,
      text,
      html,
      attachments
    };

    console.log(`Sending email from ${account.email} to ${to}`);

    try {
      const result = await transporter.sendMail(mailOptions);
      console.log('Email sent successfully:', result.messageId);
      return {
        success: true,
        messageId: result.messageId
      };
    } catch (error) {
      console.error('Error sending email:', error);
      throw error;
    }
  }

  // ==================== EMAIL RECEIVING (IMAP) ====================

  async setupIMAP(accountId) {
    const account = this.accounts.get(accountId);
    
    const Imap = require('imap');
    const { simpleParser } = require('mailparser');

    const imap = new Imap({
      user: account.email,
      password: account.credentials.password,
      host: account.credentials.imapHost || 'imap.gmail.com',
      port: account.credentials.imapPort || 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }
    });

    return new Promise((resolve, reject) => {
      imap.once('ready', () => {
        console.log('IMAP connection ready');
        resolve(imap);
      });

      imap.once('error', reject);
      imap.connect();
    });
  }

  async receiveEmails(accountId, options = {}) {
    const imap = await this.setupIMAP(accountId);
    const { mailbox = 'INBOX', limit = 10 } = options;

    return new Promise((resolve, reject) => {
      imap.openBox(mailbox, false, (err, box) => {
        if (err) return reject(err);

        const searchCriteria = ['UNSEEN'];
        const fetchOptions = { bodies: '', markSeen: false };

        imap.search(searchCriteria, (err, results) => {
          if (err) return reject(err);

          if (results.length === 0) {
            imap.end();
            return resolve([]);
          }

          const emails = [];
          const fetch = imap.fetch(results.slice(0, limit), fetchOptions);

          fetch.on('message', (msg) => {
            msg.on('body', (stream) => {
              simpleParser(stream, (err, parsed) => {
                if (err) return;
                emails.push({
                  from: parsed.from.text,
                  subject: parsed.subject,
                  text: parsed.text,
                  html: parsed.html,
                  date: parsed.date
                });
              });
            });
          });

          fetch.once('end', () => {
            imap.end();
            resolve(emails);
          });
        });
      });
    });
  }

  // ==================== AUTO-REGISTRATION ====================

  async autoRegister(service, accountId) {
    // Johnny kann sich automatisch bei Services registrieren
    const account = this.accounts.get(accountId);
    
    console.log(`Auto-registering ${account.email} at ${service}`);

    const registrationStrategies = {
      'github': this.registerGitHub.bind(this),
      'gitlab': this.registerGitLab.bind(this),
      'generic': this.registerGeneric.bind(this)
    };

    const strategy = registrationStrategies[service] || registrationStrategies.generic;
    return await strategy(account);
  }

  async registerGitHub(account) {
    // Automatische GitHub-Registrierung
    // (Würde Puppeteer oder ähnliches verwenden)
    return {
      success: false,
      message: 'GitHub registration requires manual verification'
    };
  }

  async registerGeneric(account) {
    return {
      success: false,
      message: 'Generic registration not implemented'
    };
  }

  // ==================== MANAGEMENT ====================

  async listAccounts() {
    return Array.from(this.accounts.values()).map(a => ({
      id: a.id,
      provider: a.provider,
      email: a.email,
      displayName: a.displayName,
      enabled: a.enabled,
      created: a.created
    }));
  }

  async deleteAccount(accountId) {
    const account = this.accounts.get(accountId);
    if (account) {
      const accountPath = path.join(this.accountsDir, `${accountId}.json`);
      await fs.unlink(accountPath);
      this.accounts.delete(accountId);
      this.transporters.delete(accountId);
    }
  }

  async testAccount(accountId) {
    try {
      await this.sendEmail({
        accountId,
        to: this.accounts.get(accountId).email,
        subject: 'Test Email from Johnny',
        text: 'This is a test email to verify your email account configuration.'
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = EmailService;
