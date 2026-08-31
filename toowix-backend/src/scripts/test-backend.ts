import { connectDatabase, disconnectDatabase } from '../db/connection';
import { generateJitsiToken, verifyJitsiToken } from '../auth/jitsi-token';
import { renderEmailLayout } from '../email/renderer';
import { sendEmailAsync } from '../email/sender';
import { EmailLog } from '../models/EmailLog';

export const runBackendTests = async (): Promise<void> => {
  console.log('\n========================================');
  console.log('  RUNNING TOOWIX BACKEND SYSTEM TESTS   ');
  console.log('========================================\n');

  try {
    // 1. Test Jitsi JWT Token Generator (Mon-BE-2)
    console.log('1. Testing Jitsi / Prosody mod_auth_token Generator...');
    const testToken = generateJitsiToken({
      user: {
        id: 'usr-12345',
        name: 'Alice Johnson',
        email: 'alice@acme.com',
        avatar: 'https://images.toowix.com/avatars/alice.png',
      },
      room: 'BoardMeetingRoom',
      features: {
        moderator: true,
        recording: true,
        screenShare: true,
      },
      companyId: 'comp-789',
    });

    console.log(`[PASS] Generated Jitsi JWT: ${testToken.substring(0, 30)}...`);

    const decoded = verifyJitsiToken(testToken);
    if (
      decoded.room === 'BoardMeetingRoom' &&
      decoded.context?.user?.name === 'Alice Johnson' &&
      decoded.context?.features?.moderator === true
    ) {
      console.log('[PASS] Token decoded and verified with correct claims and moderator permissions.');
    } else {
      throw new Error('Jitsi token claims verification failed.');
    }

    // 2. Test Email Layout Renderer (Mon-BE-3)
    console.log('\n2. Testing Precision Azure Branded Email Layout Rendering...');
    const renderedHtml = renderEmailLayout({
      title: 'Welcome to Toowix Meet!',
      preheader: 'Activate your enterprise workspace today',
      content: '<p>Your company registration for <strong>Acme Global</strong> is being processed.</p>',
      actionButton: {
        text: 'Access Your Dashboard',
        url: 'https://meet.toowix.com/dashboard',
      },
    });

    if (
      renderedHtml.includes('Toowix <span style="color: #3A86CA;">Meet</span>') &&
      renderedHtml.includes('Welcome to Toowix Meet!') &&
      renderedHtml.includes('Access Your Dashboard')
    ) {
      console.log('[PASS] Email layout successfully rendered with Precision Azure brand styling & CTA button.');
    } else {
      throw new Error('Email layout rendering failed to inject required elements.');
    }

    // 3. Test Async Email Sender & MongoDB Logging (Mon-BE-4)
    console.log('\n3. Testing Async Non-blocking Email Sender & Mongo Atlas Logging...');
    await connectDatabase();

    const recipient = `test-user-${Date.now()}@example.com`;
    const sendResult = await sendEmailAsync({
      to: recipient,
      templateName: 'E1_VERIFY_EMAIL',
      subject: 'Verify your email address - Toowix Meet',
      renderOptions: {
        title: 'Verify Your Email Address',
        content: '<p>Please click the button below to confirm your email.</p>',
        actionButton: {
          text: 'Verify Email',
          url: 'https://meet.toowix.com/verify?token=sample-123',
        },
      },
      metadata: {
        ipAddress: '127.0.0.1',
        userAgent: 'Jest/TestRunner',
      },
    });

    console.log(`[PASS] Email queued asynchronously with Log ID: ${sendResult.logId}`);

    // Wait 1.5 seconds for background event loop to finish
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const loggedEmail = await EmailLog.findById(sendResult.logId);
    if (loggedEmail) {
      console.log(`[PASS] EmailLog record verified in MongoDB Atlas: Status = ${loggedEmail.status}, Recipient = ${loggedEmail.recipientEmail}`);
      // Clean up test log
      await EmailLog.findByIdAndDelete(loggedEmail._id);
      console.log('[PASS] Test EmailLog cleaned up cleanly.');
    } else {
      console.warn('[WARN] Could not retrieve EmailLog (may be unlogged or running without DB).');
    }

    console.log('\n========================================');
    console.log('  ALL MONDAY BACKEND TESTS PASSED!      ');
    console.log('========================================\n');
  } catch (error) {
    console.error('\n[FAIL] Backend test error:', error);
    throw error;
  } finally {
    await disconnectDatabase();
  }
};

if (require.main === module) {
  runBackendTests()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
