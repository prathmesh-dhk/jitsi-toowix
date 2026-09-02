import mongoose, { Document, Model, Schema, Types } from 'mongoose';

export type TeamInviteRole = 'COMPANY_ADMIN' | 'HOST' | 'MEMBER';

export interface ITeamInvite {
  companyId: Types.ObjectId;
  invitedBy: Types.ObjectId;
  reportsTo?: Types.ObjectId | null;
  fullName: string;
  email: string;
  role: TeamInviteRole;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITeamInviteDocument extends ITeamInvite, Document {}

const TeamInviteSchema = new Schema<ITeamInviteDocument>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reportsTo: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    fullName: { type: String, required: true, trim: true, maxlength: 255 },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: ['COMPANY_ADMIN', 'HOST', 'MEMBER'], default: 'MEMBER' },
    expiresAt: { type: Date, required: true, index: true },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_, ret: any) => {
        ret.id = ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

TeamInviteSchema.index({ companyId: 1, email: 1 }, { unique: true });

export const TeamInvite: Model<ITeamInviteDocument> =
  mongoose.models.TeamInvite || mongoose.model<ITeamInviteDocument>('TeamInvite', TeamInviteSchema);
