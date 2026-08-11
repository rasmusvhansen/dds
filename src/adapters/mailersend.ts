import { EmailParams, MailerSend, Recipient, Sender } from 'mailersend';
import type { EmailConfig } from '../config.ts';
import { formatIssueBody, formatIssueSubject } from '../email/issue-summary.ts';
import type { RunIssueSummary } from '../email/issue-summary.ts';
import type { IssueEmailClient } from '../ports/issue-email-client.ts';

export interface MailerSendEmailService {
  readonly email: {
    send(params: EmailParams): Promise<unknown>;
  };
}

export type MailerSendFactory = (apiKey: string) => MailerSendEmailService;

export class MailerSendIssueEmailClient implements IssueEmailClient {
  private readonly mailerSend: MailerSendEmailService;
  private readonly config: EmailConfig;

  public constructor(
    config: EmailConfig,
    factory: MailerSendFactory = (apiKey) => new MailerSend({ apiKey })
  ) {
    this.config = config;
    this.mailerSend = factory(config.apiKey);
  }

  public async sendSummary(summary: RunIssueSummary): Promise<void> {
    const sender = this.config.fromName
      ? new Sender(this.config.fromEmail, this.config.fromName)
      : new Sender(this.config.fromEmail);
    const subject = formatIssueSubject(summary);
    const body = formatIssueBody(summary);

    let sendFailed = false;
    let firstError: unknown;
    for (const email of this.config.toEmails) {
      const params = new EmailParams()
        .setFrom(sender)
        .setTo([new Recipient(email)])
        .setSubject(subject)
        .setText(body);

      try {
        await this.mailerSend.email.send(params);
      } catch (error) {
        if (!sendFailed) {
          sendFailed = true;
          firstError = error;
        }
      }
    }

    if (sendFailed) {
      throw firstError;
    }
  }
}
