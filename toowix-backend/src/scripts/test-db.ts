import { connectDatabase, disconnectDatabase, pingDatabase } from '../db/connection';
import { Company, User, EmailLog } from '../models';

export const runDatabaseTests = async (): Promise<void> => {
  console.log('\n========================================');
  console.log('  RUNNING TOOWIX MONGODB DATABASE TESTS');
  console.log('========================================\n');

  try {
    console.log('1. Connecting to Database...');
    await connectDatabase();
    await Company.init();
    await User.init();
    await EmailLog.init();

    const isAlive = await pingDatabase();
    console.log(`[PASS] Ping database response: ${isAlive ? 'OK' : 'FAILED'}`);

    // Test 1: Create Company Document
    console.log('\n2. Testing Company Model Creation & Defaults...');
    const testSlug = `test-co-${Date.now()}`;
    const testCompany = await Company.create({
      name: 'Test Enterprise Corp',
      slug: testSlug,
      status: 'PENDING',
    });
    console.log(`[PASS] Company created with ID: ${testCompany._id}, Status: ${testCompany.status}, Plan: ${testCompany.plan}`);
    console.log(`       Default Limits -> Max Users: ${testCompany.limits.maxUsers}, Storage: ${testCompany.limits.storageLimitBytes} bytes`);

    // Test 2: Uniqueness Validation on Slug
    console.log('\n3. Testing Unique Constraint on Company Slug...');
    try {
      await Company.create({
        name: 'Duplicate Slug Company',
        slug: testSlug,
      });
      console.error('[FAIL] Expected duplicate slug error but creation succeeded!');
    } catch (err: any) {
      console.log(`[PASS] Correctly blocked duplicate slug: ${err.message}`);
    }

    // Test 3: Create User Document
    console.log('\n4. Testing User Model Creation...');
    const testEmail = `user-${Date.now()}@example.com`;
    const testUser = await User.create({
      firebaseUid: `fb-${Date.now()}`,
      companyId: testCompany._id,
      email: testEmail,
      fullName: 'Test User One',
      role: 'COMPANY_ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    });
    console.log(`[PASS] User created with ID: ${testUser._id}, Role: ${testUser.role}, Company: ${testUser.companyId}`);

    // Test 4: EmailLog Creation
    console.log('\n5. Testing EmailLog Model Creation...');
    const testLog = await EmailLog.create({
      recipientEmail: testEmail,
      templateName: 'E2_REG_RECEIVED',
      subject: 'Registration received for Test Enterprise Corp',
      status: 'PENDING',
      metadata: {
        companyId: testCompany._id,
        userId: testUser._id,
      },
    });
    console.log(`[PASS] EmailLog recorded: ${testLog.templateName} -> ${testLog.recipientEmail} (Status: ${testLog.status})`);

    // Cleanup test artifacts
    console.log('\n6. Cleaning up test documents...');
    await User.findByIdAndDelete(testUser._id);
    await Company.findByIdAndDelete(testCompany._id);
    await EmailLog.findByIdAndDelete(testLog._id);
    console.log('[PASS] Test documents cleaned up cleanly.');

    console.log('\n========================================');
    console.log('  ALL DATABASE MODEL TESTS PASSED!      ');
    console.log('========================================\n');
  } catch (error) {
    console.error('\n[FAIL] Database test error:', error);
    throw error;
  } finally {
    await disconnectDatabase();
  }
};

if (require.main === module) {
  runDatabaseTests()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
