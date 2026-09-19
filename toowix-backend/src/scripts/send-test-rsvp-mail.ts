// Sends a real meeting-invite email (with Accept/Decline links) for RSVP flow testing.
// Usage: npx ts-node src/scripts/send-test-rsvp-mail.ts <recipient-email>
import { connectDatabase, disconnectDatabase } from '../db/connection';
import { Meeting } from '../models/Meeting';
import { User } from '../models/User';
import { EmailLog } from '../models/EmailLog';
import { sendEmailAsync } from '../email/sender';
import { emailConfig } from '../config/email';

const run = async (): Promise<void> => {
  const to = (process.argv[2] || '').trim().toLowerCase();

  if (!/.+@.+\..+/.test(to)) {
    throw new Error('Usage: send-test-rsvp-mail.ts <recipient-email>');
  }
  await connectDatabase();
  const user = await User.findOne({ email: to });

  if (!user) {
    throw new Error(`No Toowix user with email ${to} to act as the host`);
  }
  const roomSlug = `twx-rsv-${Math.random().toString(36).slice(2, 5)}-${Math.random().toString(36).slice(2, 5)}`;
  const scheduledAt = new Date(Date.now() + 60 * 60 * 1000);
  const meeting = await Meeting.create({
    companyId: user.companyId || null,
    createdBy: user._id,
    name: 'RSVP test meeting',
    roomSlug,
    type: 'Guest',
    scheduledAt,
    durationMinutes: 60,
    invitees: [ to ],
    rsvps: [ { email: to, status: 'pending' } ]
  });
  const link = (response: string) =>
    `${emailConfig.appUrl}/rsvp?meetingId=${meeting._id}&email=${encodeURIComponent(to)}&response=${response}`;

  const { logId } = await sendEmailAsync({
    to,
    templateName: 'E9_MEETING_INVITE',
    subject: 'Test: Toowix Meet invitation - Accept or Decline',
    templateVariables: {
      meeting_topic: meeting.name,
      host_name: user.fullName,
      date_time: scheduledAt.toLocaleString(),
      room_url: `${emailConfig.appUrl}/meet/${roomSlug}`,
      passcode: 'Not required',
      accept_url: link('accepted'),
      reject_url: link('declined')
    },
    metadata: { userId: String(user._id) }
  });

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const log: any = await EmailLog.findById(logId);

    if (log && log.status !== 'PENDING') {
      console.log(`Email status: ${log.status}${log.errorMessage ? ` (${log.errorMessage})` : ''}`);
      console.log(`Accept link: ${link('accepted')}`);
      console.log(`Meeting: ${emailConfig.appUrl}/meet/${roomSlug}`);
      break;
    }
  }
  await disconnectDatabase();
  process.exit(0);
};

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
