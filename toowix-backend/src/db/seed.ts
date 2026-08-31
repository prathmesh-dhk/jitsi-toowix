import { connectDatabase, disconnectDatabase } from './connection';
import { User } from '../models';
import dotenv from 'dotenv';
dotenv.config();

export const seedSuperAdmin = async (): Promise<void> => {
  try {
    await connectDatabase();

    const adminEmail = (process.env.SUPER_ADMIN_EMAIL || 'admin@toowix.com').toLowerCase().trim();
    const adminUid = process.env.SUPER_ADMIN_FIREBASE_UID || 'super-admin-root';
    const adminName = process.env.SUPER_ADMIN_NAME || 'Toowix Super Admin';

    const existingAdmin = await User.findOne({
      $or: [{ role: 'SUPER_ADMIN' }, { email: adminEmail }, { firebaseUid: adminUid }],
    });

    if (existingAdmin) {
      console.log(`[Seed] Super Admin already exists: ${existingAdmin.email} (UID: ${existingAdmin.firebaseUid}). Skipping creation.`);
      return;
    }

    const superAdmin = await User.create({
      firebaseUid: adminUid,
      email: adminEmail,
      fullName: adminName,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      companyId: null,
      twoFactor: {
        isEnabled: false,
      },
    });

    console.log(`[Seed] Super Admin created successfully: ${superAdmin.email} (ID: ${superAdmin._id})`);
  } catch (error) {
    console.error('[Seed] Error seeding Super Admin:', error);
    throw error;
  }
};

// Run directly if called via CLI
if (require.main === module) {
  seedSuperAdmin()
    .then(async () => {
      await disconnectDatabase();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error(err);
      await disconnectDatabase();
      process.exit(1);
    });
}
