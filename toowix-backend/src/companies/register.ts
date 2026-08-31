import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { Company } from '../models/Company';
import { User } from '../models/User';
import { sendEmailAsync } from '../email/sender';

/**
 * POST /api/companies/register
 * Tue-BE-4: Register a new company workspace.
 * Creates company in PENDING status and assigns the user as COMPANY_ADMIN.
 */
export const registerCompanyHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const firebaseUid = req.firebaseUid;
  const email = req.firebaseEmail;
  const { name, slug: customSlug, logoUrl } = req.body;

  if (!firebaseUid || !email) {
    res.status(401).json({ error: 'Unauthorized: Invalid authentication token' });
    return;
  }

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Company name is required' });
    return;
  }

  try {
    // 1. Locate User in MongoDB
    const user = await User.findOne({ firebaseUid });

    if (!user) {
      res.status(404).json({ error: 'User profile not found. Please complete signup first.' });
      return;
    }

    if (user.companyId) {
      res.status(400).json({ error: 'User is already associated with a company workspace' });
      return;
    }

    // 2. Generate or sanitize slug
    let slug = customSlug
      ? customSlug
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '')
      : name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');

    // Ensure unique slug
    let existingCompany = await Company.findOne({ slug });
    if (existingCompany) {
      slug = `${slug}-${Math.floor(1000 + Math.random() * 9000)}`;
    }

    // 3. Create Company with PENDING status (Requires Super Admin approval)
    const company = await Company.create({
      name: name.trim(),
      slug,
      logoUrl: logoUrl || null,
      status: 'PENDING',
      plan: 'FREE',
      limits: {
        maxUsers: 50,
        maxMeetingDurationMinutes: 60,
        storageLimitBytes: 5368709120, // 5GB
        recordingRetentionDays: 30,
        featureFlags: {
          recordingEnabled: true,
          customBranding: false,
          sipDialIn: false,
          lobbyEnabled: true,
        },
      },
    });

    // 4. Update user role to COMPANY_ADMIN and link companyId
    user.companyId = company._id;
    user.role = 'COMPANY_ADMIN';
    await user.save();

    console.log(`[Company Registration] Company "${company.name}" registered (PENDING approval) by ${user.email}`);

    // 5. Dispatch E2 Registration Received email asynchronously
    sendEmailAsync({
      to: user.email,
      templateName: 'E2_REG_RECEIVED',
      subject: `Registration received for ${company.name} - Toowix Meet`,
      renderOptions: {
        title: 'Company Registration Received',
        preheader: `We've received your registration for ${company.name}`,
        content: `
          <p>Hello ${user.fullName},</p>
          <p>Thank you for registering <strong>${company.name}</strong> on Toowix Meet.</p>
          <p>Your workspace is currently <strong>awaiting review by the Toowix Super Admin team</strong>. Once approved, you will receive a notification email, and you will be able to access your full company meeting dashboard.</p>
        `,
        actionButton: {
          text: 'Check Registration Status',
          url: 'https://meet.toowix.com/login',
        },
      },
      metadata: {
        userId: user._id,
        companyId: company._id,
        ipAddress: req.ip,
      },
    });

    res.status(201).json({
      message: 'Company registration submitted successfully and is pending Super Admin approval',
      status: 'PENDING',
      company: {
        id: company._id,
        name: company.name,
        slug: company.slug,
        status: company.status,
        plan: company.plan,
      },
      user,
    });
  } catch (error: any) {
    console.error('[Company Registration] Error registering company:', error.message);
    res.status(500).json({ error: 'Internal server error registering company' });
  }
};
