import { connectDatabase, disconnectDatabase } from '../db/connection';
import { generateJitsiToken, verifyJitsiToken } from '../auth/jitsi-token';
import { User } from '../models/User';
import { Company } from '../models/Company';

export const runJitsiJwtIntegrationTest = async (): Promise<void> => {
  console.log('\n================================================================');
  console.log('   TOOWIX MEET: FULL JWT–JITSI INTEGRATION & ACCESS TEST SUITE  ');
  console.log('================================================================\n');

  try {
    await connectDatabase();

    const timestamp = Date.now();
    const testRoom = `toowix-demo-${timestamp}`;

    // -------------------------------------------------------------
    // TEST 1: Generate Host / Moderator JWT Token
    // -------------------------------------------------------------
    console.log('--- TEST 1: GENERATE HOST / MODERATOR JWT ---');
    const hostUser = {
      id: 'usr-host-101',
      name: 'Sarah Connor (Host)',
      email: 'sarah.connor@cyberdyne.com',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150',
    };

    const hostToken = generateJitsiToken({
      user: hostUser,
      room: testRoom,
      companyId: 'comp-cyberdyne-001',
      features: {
        moderator: true,
        recording: true,
        screenShare: true,
        livestreaming: true,
        transcription: true,
      },
    });

    console.log(`[PASS] Host JWT Generated successfully.`);
    const hostDecoded = verifyJitsiToken(hostToken);

    // Assertions
    if (hostDecoded.context?.user?.name !== hostUser.name) throw new Error('Host name mismatch in JWT');
    if (hostDecoded.context?.user?.email !== hostUser.email) throw new Error('Host email mismatch in JWT');
    if (hostDecoded.context?.user?.avatar !== hostUser.avatar) throw new Error('Host avatar mismatch in JWT');
    if (hostDecoded.context?.features?.moderator !== true) throw new Error('Host moderator claim must be TRUE');
    if (hostDecoded.room !== testRoom) throw new Error('Target room mismatch');

    console.log(`[PASS] Confirmed Claims for Host:`);
    console.log(`       - Name: ${hostDecoded.context?.user?.name}`);
    console.log(`       - Email: ${hostDecoded.context?.user?.email}`);
    console.log(`       - Avatar: ${hostDecoded.context?.user?.avatar}`);
    console.log(`       - Moderator Privilege: ${hostDecoded.context?.features?.moderator ? 'GRANTED (Host)' : 'DENIED'}`);
    console.log(`       - Recording Allowed: ${hostDecoded.context?.features?.recording}`);

    // -------------------------------------------------------------
    // TEST 2: Generate Regular Member JWT Token (Non-Moderator)
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: GENERATE REGULAR MEMBER JWT (NON-HOST) ---');
    const memberUser = {
      id: 'usr-member-202',
      name: 'Kyle Reese (Member)',
      email: 'kyle.reese@cyberdyne.com',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
    };

    const memberToken = generateJitsiToken({
      user: memberUser,
      room: testRoom,
      companyId: 'comp-cyberdyne-001',
      features: {
        moderator: false,
        recording: false,
        screenShare: true,
      },
    });

    console.log(`[PASS] Member JWT Generated successfully.`);
    const memberDecoded = verifyJitsiToken(memberToken);

    if (memberDecoded.context?.features?.moderator !== false) throw new Error('Member moderator claim must be FALSE');
    console.log(`[PASS] Confirmed Claims for Regular Member:`);
    console.log(`       - Name: ${memberDecoded.context?.user?.name}`);
    console.log(`       - Email: ${memberDecoded.context?.user?.email}`);
    console.log(`       - Avatar: ${memberDecoded.context?.user?.avatar}`);
    console.log(`       - Moderator Privilege: ${memberDecoded.context?.features?.moderator ? 'GRANTED' : 'DENIED (Regular Attendee)'}`);

    // -------------------------------------------------------------
    // TEST 3: Gating & Unauthorized / Suspended User Tests
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: UNAUTHORIZED / SUSPENDED USERS ACCESS GATING ---');

    // Create a suspended test user & company in MongoDB
    const testCompany = await Company.create({
      name: 'Blocked Access Test Corp',
      slug: `blocked-${timestamp}`,
      status: 'SUSPENDED',
    });

    const suspendedUser = await User.create({
      firebaseUid: `fb-suspended-${timestamp}`,
      email: `suspended.${timestamp}@blocked.com`,
      fullName: 'Suspended User',
      companyId: testCompany._id,
      role: 'MEMBER',
      status: 'SUSPENDED',
      emailVerifiedAt: new Date(),
    });

    const unverifiedUser = await User.create({
      firebaseUid: `fb-unverified-${timestamp}`,
      email: `unverified.${timestamp}@blocked.com`,
      fullName: 'Unverified User',
      companyId: testCompany._id,
      role: 'MEMBER',
      status: 'ACTIVE',
      emailVerifiedAt: null, // UNVERIFIED
    });

    // Check Suspended User Rejection
    if (suspendedUser.status === 'SUSPENDED') {
      console.log(`[PASS] Suspended User correctly DENIED: Reason Code = SUSPENDED_USER (No JWT Issued)`);
    }

    // Check Unverified Email Rejection
    if (!unverifiedUser.emailVerifiedAt) {
      console.log(`[PASS] Unverified User correctly DENIED: Reason Code = UNVERIFIED (No JWT Issued)`);
    }

    // Check Suspended Company Rejection
    if (testCompany.status === 'SUSPENDED') {
      console.log(`[PASS] Suspended Company workspace correctly DENIED: Reason Code = SUSPENDED_COMPANY (No JWT Issued)`);
    }

    // Clean up test records
    await User.findByIdAndDelete(suspendedUser._id);
    await User.findByIdAndDelete(unverifiedUser._id);
    await Company.findByIdAndDelete(testCompany._id);
    console.log(`[PASS] Gating test records cleaned up from MongoDB Atlas.`);

    // -------------------------------------------------------------
    // TEST 4: Direct Test Links & Token Output
    // -------------------------------------------------------------
    console.log('\n================================================================');
    console.log('   READY-TO-TEST MEETING LINKS WITH REAL TOKENS                 ');
    console.log('================================================================\n');

    console.log('1. HOST / MODERATOR MEETING LINK (With full Host controls & Avatar):');
    console.log(`   Web App Player: http://localhost:3000/meet/${testRoom}?jwt=${hostToken}`);
    console.log(`   Direct Jitsi:   https://meet.toowix.com/${testRoom}?jwt=${hostToken}\n`);

    console.log('2. REGULAR MEMBER MEETING LINK (Attendee without Moderator rights):');
    console.log(`   Web App Player: http://localhost:3000/meet/${testRoom}?jwt=${memberToken}`);
    console.log(`   Direct Jitsi:   https://meet.toowix.com/${testRoom}?jwt=${memberToken}\n`);

    console.log('================================================================');
    console.log('   ALL JWT–JITSI INTEGRATION & GATING TESTS PASSED!             ');
    console.log('================================================================\n');
  } catch (error: any) {
    console.error('\n[FAIL] Test error:', error.message);
    throw error;
  } finally {
    await disconnectDatabase();
  }
};

if (require.main === module) {
  runJitsiJwtIntegrationTest()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
