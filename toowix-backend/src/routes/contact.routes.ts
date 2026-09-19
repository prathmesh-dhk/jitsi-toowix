import { Router, Response } from 'express';
import mongoose from 'mongoose';
import { AuthenticatedRequest, verifyFirebaseToken } from '../middleware/auth';
import { Contact } from '../models/Contact';

const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_CONTACTS = 1000;

const ownerOf = (req: AuthenticatedRequest) => String((req.accountUser as any)?.id || '');
const present = (c: any) => ({ id: String(c._id), name: c.name, email: c.email });

// Every route is scoped to the signed-in user: a contact book is private to its owner.
router.use(verifyFirebaseToken);

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const contacts = await Contact.find({ ownerId: ownerOf(req) }).sort({ name: 1 }).limit(MAX_CONTACTS).lean();
    res.json({ contacts: contacts.map(present) });
  } catch {
    res.status(500).json({ error: 'Could not load contacts' });
  }
});

router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!name || name.length > 100) { res.status(400).json({ error: 'Enter a name (up to 100 characters).' }); return; }
    if (!EMAIL_RE.test(email) || email.length > 254) { res.status(400).json({ error: 'Enter a valid email address.' }); return; }
    const owner = ownerOf(req);
    if ((await Contact.countDocuments({ ownerId: owner })) >= MAX_CONTACTS) {
      res.status(400).json({ error: `Your contact book is full (${MAX_CONTACTS} contacts).` });
      return;
    }
    try {
      const contact = await Contact.create({ ownerId: owner, name, email });
      res.status(201).json({ contact: present(contact) });
    } catch (err: any) {
      if (err?.code === 11000) { res.status(409).json({ error: 'That email is already in your contact book.' }); return; }
      throw err;
    }
  } catch {
    res.status(500).json({ error: 'Could not save the contact' });
  }
});

router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) { res.status(404).json({ error: 'Contact not found' }); return; }
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!name || name.length > 100) { res.status(400).json({ error: 'Enter a name (up to 100 characters).' }); return; }
    if (!EMAIL_RE.test(email) || email.length > 254) { res.status(400).json({ error: 'Enter a valid email address.' }); return; }
    try {
      const contact = await Contact.findOneAndUpdate({ _id: req.params.id, ownerId: ownerOf(req) }, { $set: { name, email } }, { new: true });
      if (!contact) { res.status(404).json({ error: 'Contact not found' }); return; }
      res.json({ contact: present(contact) });
    } catch (err: any) {
      if (err?.code === 11000) { res.status(409).json({ error: 'That email is already in your contact book.' }); return; }
      throw err;
    }
  } catch {
    res.status(500).json({ error: 'Could not update the contact' });
  }
});

router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) { res.status(404).json({ error: 'Contact not found' }); return; }
    const result = await Contact.deleteOne({ _id: req.params.id, ownerId: ownerOf(req) });
    if (!result.deletedCount) { res.status(404).json({ error: 'Contact not found' }); return; }
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Could not delete the contact' });
  }
});

export default router;
