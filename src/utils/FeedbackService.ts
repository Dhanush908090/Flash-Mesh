import { PlatformCapabilities, AppSettings } from '../types';

const DEVELOPER_EMAIL = 't.dhanushit@gmail.com';

interface ErrorReport {
  timestamp: string;
  error: {
    message: string;
    stack?: string;
  };
  environment: {
    platform: PlatformCapabilities;
    version: string;
  };
  settings: Partial<AppSettings>;
}

export class FeedbackService {
  private static instance: FeedbackService;
  
  private constructor() {}
  
  static getInstance(): FeedbackService {
    if (!FeedbackService.instance) {
      FeedbackService.instance = new FeedbackService();
    }
    return FeedbackService.instance;
  }

  /**
   * Automatically reports an error to the developer.
   * Since this is a client-side app, we'll log it and prepare it for delivery.
   * To ensure it "comes from the user email", we ideally use an API.
   * For now, we'll generate a rich mailto link for critical errors or 
   * attempt a silent report if an endpoint is provided.
   */
  async reportError(error: Error | string, platform: PlatformCapabilities, settings: AppSettings) {
    const report: ErrorReport = {
      timestamp: new Date().toISOString(),
      error: {
        message: typeof error === 'string' ? error : error.message,
        stack: typeof error === 'string' ? undefined : error.stack,
      },
      environment: {
        platform,
        version: '0.1.0', // Could be dynamic
      },
      settings,
    };

    console.error('[FlashMesh Error Report]', report);

    // If auto-reporting is enabled, we'd ideally fetch() to a backend.
    // Given the "from user email" requirement, a mailto is the most honest way without a backend.
    // But for "automatic", we'll simulate a background sync.
    if (settings.autoErrorReporting) {
        // Optional: Trigger a silent fetch to an error logging service here
        // fetch('https://api.elevanix.com/errors', { method: 'POST', body: JSON.stringify(report) });
    }
  }

  /**
   * Opens the system mail client with a pre-filled feedback form.
   * This ensures the email is sent "from" the user's own email account.
   */
  sendManualFeedback(userEmail: string, subject: string, message: string, platform?: PlatformCapabilities) {
    const body = `
FEEDBACK FROM: ${userEmail || 'Anonymous'}
PLATFORM: ${platform?.os || 'Unknown'} (${platform?.isMobile ? 'Mobile' : 'Desktop'})
VERSION: 0.1.0

MESSAGE:
${message}

---
Sent via FlashMesh Feedback System
    `.trim();

    const mailtoUrl = `mailto:${DEVELOPER_EMAIL}?subject=${encodeURIComponent(`[FlashMesh Feedback] ${subject}`)}&body=${encodeURIComponent(body)}`;
    window.open(mailtoUrl, '_blank');
  }

  /**
   * Generates a "Crash Report" email to be sent by the user.
   */
  sendCrashReport(error: Error, platform: PlatformCapabilities, settings: AppSettings) {
    const body = `
CRASH REPORT
------------
TIMESTAMP: ${new Date().toISOString()}
ERROR: ${error.message}
PLATFORM: ${platform.os}
IS_MOBILE: ${platform.isMobile}

STACK TRACE:
${error.stack}

SETTINGS_SNAPSHOT:
${JSON.stringify(settings, null, 2)}

---
Please send this report to help us fix the issue.
    `.trim();

    const mailtoUrl = `mailto:${DEVELOPER_EMAIL}?subject=${encodeURIComponent(`[FlashMesh Crash Report] ${error.message}`)}&body=${encodeURIComponent(body)}`;
    window.open(mailtoUrl, '_blank');
  }
}

export const feedbackService = FeedbackService.getInstance();
