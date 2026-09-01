import { renderDedicatedTemplate } from '../email/renderer';
import { EmailTemplateName } from '../models/EmailLog';

const templatesToTest: { name: EmailTemplateName; vars: Record<string, any> }[] = [
  {
    name: 'E1_VERIFY_EMAIL',
    vars: { name: 'Jane Doe', verification_url: 'https://meet.toowix.com/verify-email?token=xyz' },
  },
  {
    name: 'E2_REG_RECEIVED',
    vars: { admin_name: 'Alex Admin', company_name: 'Acme Corp', slug: 'acme' },
  },
  {
    name: 'E3_REG_APPROVED',
    vars: {
      admin_name: 'Alex Admin',
      company_name: 'Acme Corp',
      workspace_url: 'https://acme.meet.toowix.com',
      login_url: 'https://acme.meet.toowix.com/login',
    },
  },
  {
    name: 'E4_REG_REJECTED',
    vars: {
      admin_name: 'Alex Admin',
      company_name: 'Acme Corp',
      rejection_reason: 'Domain ownership could not be verified.',
      support_email: 'support@toowix.com',
    },
  },
  {
    name: 'E5_USER_SIGNIN',
    vars: {
      name: 'Jane Doe',
      email: 'jane@acme.com',
      device: 'Chrome 128 on macOS Sequoia',
      ip_address: '192.168.1.1',
      location: 'San Francisco, CA, USA',
      timestamp: 'Sep 1, 2026 3:30 PM UTC',
      secure_account_url: 'https://meet.toowix.com/forgot-password',
    },
  },
  {
    name: 'E6_ADMIN_SIGNIN',
    vars: {
      admin_name: 'Alex Admin',
      email: 'admin@acme.com',
      ip_address: '192.168.1.1',
      role: 'SUPER_ADMIN',
      timestamp: 'Sep 1, 2026 3:30 PM UTC',
      active_sessions_url: 'https://meet.toowix.com/admin/sessions',
    },
  },
  {
    name: 'E7_PASSWORD_RESET',
    vars: { name: 'Jane Doe', reset_url: 'https://meet.toowix.com/reset-password?token=abc' },
  },
  {
    name: 'E8_INVITE_MEMBER',
    vars: {
      inviter_name: 'Alex Admin',
      company_name: 'Acme Corp',
      role: 'Host',
      invite_url: 'https://meet.toowix.com/accept-invite?token=123',
    },
  },
  {
    name: 'E9_MEETING_INVITE',
    vars: {
      host_name: 'Alex Admin',
      meeting_topic: 'Q3 Product Strategy Review',
      date_time: 'Thursday, Sep 3, 2026 at 2:00 PM EST',
      room_url: 'https://meet.toowix.com/meet/q3-strategy',
      passcode: '948271',
    },
  },
  {
    name: 'E10_2FA_ENABLED',
    vars: { name: 'Jane Doe', timestamp: 'Sep 1, 2026 3:30 PM UTC' },
  },
];

console.log('Testing rendering of all 10 Email Templates...\n');
let allPassed = true;

for (const t of templatesToTest) {
  try {
    const html = renderDedicatedTemplate(t.name, t.vars);
    if (!html || !html.includes('Toowix')) {
      throw new Error('Render output missing brand content');
    }
    console.log(`[PASS] Template: ${t.name} (HTML size: ${html.length} bytes)`);
  } catch (err: any) {
    console.error(`[FAIL] Template: ${t.name} -> ${err.message}`);
    allPassed = false;
  }
}

if (allPassed) {
  console.log('\n[SUCCESS] All 10 Toowix Meet email templates rendered successfully with 0 errors!');
  process.exit(0);
} else {
  process.exit(1);
}
