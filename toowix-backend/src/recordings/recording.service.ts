import fs from 'fs';
import { inspectRecording, resolveRecordingFilePath } from './media.service';
import { mayManageResource } from '../middleware/ownership';
import { getFirebaseAuth } from '../config/firebase';
import { User } from '../models/User';
import { Meeting } from '../models/Meeting';
import { Recording } from '../models/Recording';
import { RecordingHold } from '../models/RecordingHold';
import { Company } from '../models/Company';
import { notifyCompany, notifyUser } from '../notifications/notification.service';

// All business rules for recordings (list, start/stop session, Jibri ingest, rename, delete,
// fetch, stream preparation) live here as plain functions -- no `req`/`res` anywhere in this
// file. recording.controller.ts parses HTTP in, calls one of these, and sends the result back
// out. The one exception is prepareRecordingStream, whose caller still has to pipe bytes to
// `res` itself -- piping is irreducibly response-stream mechanics, the same class of exception
// as the SSE writers in meetings/lobby/lobby.realtime.ts.

export interface IServiceResult<T = any> {
  body: T;
  httpStatus: number;
}

export interface IViewer {
  companyId: string | null;
  email: string;
  id: string;
}

/**
 * GET /:id and /:id/stream are unauthenticated by design (a <video> tag can't attach an
 * Authorization header, and share links must work for logged-out recipients), so they can't
 * use verifyFirebaseToken. But that must never mean "anyone who guesses the ObjectId gets the
 * video" -- so both routes resolve an optional viewer (Authorization header, or ?token= for the
 * <video> element) and check it against the recording's own sharing model below.
 */
export async function resolveOptionalViewer(authHeader: string | undefined, queryToken: string | undefined): Promise<IViewer | null> {
  const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;
  if (!idToken) return null;
  try {
    const decoded = await getFirebaseAuth().verifyIdToken(idToken, true);
    const user = await User.findOne({ firebaseUid: decoded.uid });
    if (!user || user.status !== 'ACTIVE') return null;
    return { id: String(user._id), email: user.email.toLowerCase(), companyId: user.companyId ? String(user.companyId) : null };
  } catch {
    return null;
  }
}

/** allowShare is this app's explicit "make this a public link" flag; absent that, only the
 * owner, same-company members, or emails on sharedWith may view/stream the recording. */
function mayViewRecording(recording: any, viewer: IViewer | null): boolean {
  if (recording.allowShare === true) return true;
  if (!viewer) return false;
  if (String(recording.createdBy) === viewer.id) return true;
  if (viewer.companyId && recording.companyId && String(recording.companyId) === viewer.companyId) return true;
  if ((recording.sharedWith || []).includes(viewer.email)) return true;
  return false;
}

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;

const isFinalRelativeFile = (value: unknown, recordingSessionId: string): value is string => {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.startsWith('/') || value.startsWith('\\')) return false;
  const parts = value.replace(/\\/g, '/').split('/');
  return parts.length >= 2 && parts[parts.length - 2] === recordingSessionId && parts[parts.length - 1] === 'final.mp4'
    && !parts.includes('..');
};

async function resolveUser(firebaseUid: string | undefined) {
  if (!firebaseUid) return null;
  return User.findOne({ firebaseUid });
}

/**
 * Lists recordings visible to the caller (company-wide, or personal if standalone),
 * plus aggregate stats (count, total duration, total storage).
 * NOTE: there is no recording capture pipeline yet -- this simply reflects whatever
 * Recording documents actually exist, so it will legitimately return an empty list
 * until that infra (Jibri + storage) is built.
 */
export async function listRecordings(firebaseUid: string | undefined): Promise<IServiceResult> {
  try {
    const user = await resolveUser(firebaseUid);
    if (!user) {
      return { body: { error: 'User profile not found' }, httpStatus: 404 };
    }

    // Company members keep seeing every company recording (unchanged, existing behavior).
    // Standalone users (no company) only saw their own recordings before -- now they also
    // see recordings explicitly shared with their email via `sharedWith`, which is what
    // makes granular sharing actually visible instead of just stored.
    const filter = user.companyId
      ? { companyId: user.companyId }
      : { $or: [{ createdBy: user._id }, { sharedWith: user.email.toLowerCase() }] };

    const [ recordings, stats ] = await Promise.all([
      Recording.find(filter).populate('createdBy', 'fullName email').sort({ recordedAt: -1 }).limit(200),
      Recording.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalDurationMinutes: { $sum: '$durationMinutes' },
            totalSizeBytes: { $sum: '$sizeBytes' },
          },
        },
      ]),
    ]);

    const agg = stats[0] || { count: 0, totalDurationMinutes: 0, totalSizeBytes: 0 };

    return {
      body: {
        recordings,
        stats: { count: agg.count, totalDurationMinutes: agg.totalDurationMinutes, totalSizeBytes: agg.totalSizeBytes },
      },
      httpStatus: 200,
    };
  } catch (error: any) {
    console.error('[Recordings] Error listing recordings:', error.message);
    return { body: { error: 'Failed to fetch recordings' }, httpStatus: 500 };
  }
}

/**
 * Sent by the host's browser when a recording starts and stops (POST /session { roomSlug,
 * action: 'start' | 'stop' }). It (1) snapshots who owns the recording and (2) keeps the meeting
 * record alive until the recorder has finished, so a finished recording can always be attached to
 * its owner even if the host ended the meeting straight away.
 */
export async function startStopRecordingSession(accountUserId: string | undefined, roomSlugRaw: string, actionRaw: string): Promise<IServiceResult> {
  try {
    const roomSlug = roomSlugRaw.trim().toLowerCase();
    const action = actionRaw === 'stop' ? 'stop' : 'start';
    if (!/^[a-z0-9-]{3,100}$/.test(roomSlug)) {
      return { body: { error: 'Invalid room code' }, httpStatus: 400 };
    }
    const user = accountUserId ? await User.findById(accountUserId) : null;
    if (!user) {
      return { body: { error: 'Sign in required' }, httpStatus: 401 };
    }
    const meeting: any = await Meeting.findOne({ roomSlug });
    if (!meeting) {
      return { body: { error: 'Recording is available for meetings created from the dashboard.' }, httpStatus: 404 };
    }
    if (!mayManageResource(user, meeting)) {
      return { body: { error: 'Only the meeting host can record.' }, httpStatus: 403 };
    }

    const holdMs = action === 'start' ? 6 * 60 * 60 * 1000 : 3 * 60 * 60 * 1000;
    await Meeting.updateOne({ _id: meeting._id }, { $set: { recordingHoldUntil: new Date(Date.now() + holdMs) } });
    await RecordingHold.findOneAndUpdate(
      { roomSlug, meetingId: meeting._id },
      { $set: { companyId: meeting.companyId || null, createdBy: meeting.createdBy, name: meeting.name, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } },
      { upsert: true, setDefaultsOnInsert: true }
    );
    return { body: { success: true }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Recordings] Session hold error:', error.message);
    return { body: { error: 'Could not register the recording session' }, httpStatus: 500 };
  }
}

interface IIngestParams {
  fileUrl?: string;
  processedFile?: string;
  providedKey: string | undefined;
  recordedAt?: string;
  recordingSessionId?: string;
  relativeFile?: string;
  roomSlug?: string;
  sourceFile?: string;
  status?: string;
}

/**
 * Called by the Jibri finalize worker as it processes a local recording (POST /ingest). Not
 * user-authenticated -- Jibri isn't a logged-in user -- instead it's gated by a shared secret
 * checked against RECORDING_INGEST_KEY.
 *
 * roomSlug identifies which Meeting this belongs to, so companyId/createdBy/name are
 * resolved from the real meeting record rather than trusted from the caller.
 */
export async function ingestRecording(params: IIngestParams): Promise<IServiceResult> {
  try {
    if (!process.env.RECORDING_INGEST_KEY || params.providedKey !== process.env.RECORDING_INGEST_KEY) {
      return { body: { error: 'Invalid or missing ingest key' }, httpStatus: 401 };
    }

    const { roomSlug, fileUrl, status = 'Ready', recordedAt } = params;
    const relativeFile = params.relativeFile || fileUrl;
    const recordingSessionId = params.recordingSessionId || (typeof relativeFile === 'string' ? relativeFile.split('/')[0] : undefined);
    if (typeof recordingSessionId !== 'string' || !SESSION_ID_PATTERN.test(recordingSessionId) || !['Processing', 'Ready', 'Failed'].includes(status)) {
      return { body: { error: 'Valid recordingSessionId and status are required' }, httpStatus: 400 };
    }
    if (!roomSlug || typeof roomSlug !== 'string') {
      return { body: { error: 'roomSlug is required' }, httpStatus: 400 };
    }
    if (status === 'Ready' && (!isFinalRelativeFile(relativeFile, recordingSessionId) || !isFinalRelativeFile(fileUrl, recordingSessionId))) {
      return { body: { error: 'Completed recording must reference the session final.mp4 in the recording mount' }, httpStatus: 400 };
    }

    const slug = roomSlug.trim().toLowerCase();
    // Meeting.findOne (by roomSlug) and Recording.findOne (by recordingSessionId) read different
    // collections by different keys, and neither's result feeds into the other's query -- they're
    // the only pair of lookups in this function safe to fire together. Everything else below stays
    // exactly as conditionally sequential as before:
    //   - RecordingHold.findOne only runs when `meeting` comes back empty, so it genuinely depends
    //     on Meeting.findOne's result and can't be started before it resolves.
    //   - Company.findById only runs when the resolved meeting actually has a companyId. Firing it
    //     unconditionally just to parallelize would add a query (and a policy check) for requests
    //     that should never have been subject to one.
    //   - inspectRecording (the ffprobe + full ffmpeg decode, by far the slowest step here, with a
    //     10-minute timeout) deliberately still runs only after every rejection below it (missing
    //     meeting, disabled-by-policy, session-id conflict, already-Ready) has had its chance to
    //     return first. Starting that decode speculatively in parallel with the lookups above would
    //     waste the one genuinely expensive resource in this function on requests that end in a
    //     404/403/409 before ever needing the result.
    // (One observable difference from the strictly-sequential version: Recording.findOne now always
    // executes once per call, including on the "meeting not found" 404 path, where it previously
    // never ran. That's a single cheap indexed read on an uncommon error path, not a behavior change
    // in anything the caller can see -- the response and all writes are identical.)
    let [ meeting, recording ]: [ any, any ] = await Promise.all([
      Meeting.findOne({ roomSlug: slug }),
      Recording.findOne({ recordingSessionId }),
    ]);
    if (!meeting) {
      // The meeting record may already be gone (ended/expired) while the recorder was still
      // processing -- use the owner snapshot taken when recording started.
      const hold: any = await RecordingHold.findOne({ roomSlug: slug }).sort({ createdAt: -1 });
      if (hold) {
        meeting = { _id: hold.meetingId || hold._id, companyId: hold.companyId || null, createdBy: hold.createdBy, name: hold.name };
      }
    }
    if (!meeting) {
      return { body: { error: `No meeting found with roomSlug "${roomSlug}"` }, httpStatus: 404 };
    }

    if (meeting.companyId) {
      const company = await Company.findById(meeting.companyId).select('meetingPolicy limits status');
      if (!company || company.status !== 'ACTIVE' || company.meetingPolicy?.recordingEnabled === false || company.limits?.featureFlags?.recordingEnabled === false) {
        return { body: { error: 'Recording is disabled by company policy for this organization' }, httpStatus: 403 };
      }
    }

    if (recording && String(recording.meetingId) !== String(meeting._id)) {
      return { body: { error: 'Recording session belongs to another meeting' }, httpStatus: 409 };
    }
    if (recording?.status === 'Ready') {
      return { body: { recording }, httpStatus: 200 };
    }
    if (!recording) {
      try {
        recording = await Recording.create({ recordingSessionId, companyId: meeting.companyId || null,
          meetingId: meeting._id, createdBy: meeting.createdBy, name: meeting.name,
          recordedAt: recordedAt ? new Date(recordedAt) : new Date(), durationMinutes: 0, sizeBytes: 0, status: 'Processing',
          sourceFile: params.sourceFile || null, processedFile: params.processedFile || null,
          processingStartedAt: new Date() });
      } catch (error: any) {
        if (error.code === 11000) {
          return { body: { error: 'Recording finalization is already in progress; retry this session ID' }, httpStatus: 409 };
        }
        throw error;
      }
    }
    if (status === 'Processing') {
      await Recording.updateOne({ _id: recording._id, status: { $ne: 'Ready' } }, { $set: {
        status: 'Processing', sourceFile: params.sourceFile || recording.sourceFile || null,
        processedFile: params.processedFile || recording.processedFile || null,
        processingStartedAt: new Date(), allowDownload: false,
      }, $unset: { failureReason: 1, processingError: 1, processingCompletedAt: 1, fileUrl: 1 } });
      return { body: { recording: await Recording.findById(recording._id) }, httpStatus: 202 };
    }
    if (status === 'Failed') {
      const processingError = typeof (params as any).processingError === 'string' ? (params as any).processingError.slice(0, 2000) : 'Recorder reported failure';
      await Recording.updateOne({ _id: recording._id, status: { $ne: 'Ready' } }, { $set: {
        status: 'Failed', failureReason: processingError, processingError, processingCompletedAt: new Date(), allowDownload: false,
      }, $unset: { fileUrl: 1 } });
      return { body: { recording: await Recording.findById(recording._id) }, httpStatus: 200 };
    }
    try {
      const metadata = await inspectRecording(relativeFile!);
      const processedFile = isFinalRelativeFile(params.processedFile, recordingSessionId) ? params.processedFile : relativeFile;
      // CAS prevents late processing/failure retries from overwriting a finalized result.
      const ready = await Recording.findOneAndUpdate({ _id: recording._id, status: { $ne: 'Ready' } }, { $set: {
        durationSeconds: metadata.durationSeconds, durationMinutes: metadata.durationSeconds / 60,
        sizeBytes: metadata.sizeBytes, status: 'Ready', fileUrl: relativeFile, allowDownload: true,
        sourceFile: params.sourceFile || recording.sourceFile || null, processedFile,
        processingError: null, processingCompletedAt: new Date(), codec: metadata.codec,
        width: metadata.width, height: metadata.height,
      }, $unset: { failureReason: 1 } }, { new: true });
      if (!ready) {
        return { body: { recording: await Recording.findById(recording._id) }, httpStatus: 200 };
      }
      recording = ready;
    } catch {
      await Recording.updateOne({ _id: recording._id, status: { $ne: 'Ready' } }, { $set: {
        status: 'Failed', failureReason: 'Media validation failed; check final.mp4, recording mount and ffprobe/ffmpeg logs',
        processingError: 'Media validation failed', processingCompletedAt: new Date(), allowDownload: false,
      }, $unset: { fileUrl: 1 } });
      return { body: { error: 'Recording failed media validation', recordingSessionId }, httpStatus: 422 };
    }

    const notifyPayload = {
      category: 'RECORDINGS' as const,
      type: 'RECORDING_READY' as const,
      title: 'Recording is ready',
      description: `The recording for "${meeting.name}" is ready to view.`,
      relatedName: meeting.name,
      actionLabel: 'View' as const,
      actionUrl: `/dashboard?tab=recordings`,
    };
    if (meeting.companyId) {
      notifyCompany(meeting.companyId, notifyPayload);
    } else {
      notifyUser({ userId: meeting.createdBy, ...notifyPayload });
    }

    return { body: { recording }, httpStatus: 201 };
  } catch (error: any) {
    console.error('[Recordings] Error ingesting recording:', error.message);
    return { body: { error: 'Failed to ingest recording' }, httpStatus: 500 };
  }
}

interface IRenameParams {
  allowDownload?: boolean;
  allowShare?: boolean;
  folder?: string;
  name?: string;
  sharedWith?: unknown[];
}

/** Rename a recording. Owner (creator) or company admin only. */
export async function renameRecording(id: string, firebaseUid: string | undefined, params: IRenameParams): Promise<IServiceResult> {
  try {
    const user = await resolveUser(firebaseUid);
    if (!user) {
      return { body: { error: 'User profile not found' }, httpStatus: 404 };
    }

    const recording = await Recording.findById(id);
    if (!recording) {
      return { body: { error: 'Recording not found' }, httpStatus: 404 };
    }

    if (!mayManageResource(user, recording)) {
      return { body: { error: 'Only the owner or a company admin can rename this recording' }, httpStatus: 403 };
    }

    const { name, folder, allowDownload, allowShare, sharedWith } = params;
    if (name === undefined && folder === undefined && allowDownload === undefined && allowShare === undefined && sharedWith === undefined) {
      return { body: { error: 'At least one editable field is required' }, httpStatus: 400 };
    }

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return { body: { error: 'A valid recording name is required' }, httpStatus: 400 };
      }
      recording.name = name.trim();
    }
    if (folder !== undefined) recording.folder = String(folder).trim();
    if (allowDownload !== undefined) recording.allowDownload = Boolean(allowDownload);
    if (allowShare !== undefined) recording.allowShare = Boolean(allowShare);
    if (sharedWith !== undefined) {
      recording.sharedWith = Array.isArray(sharedWith)
        ? Array.from(new Set(sharedWith.map((e: any) => String(e).trim().toLowerCase()).filter((e: string) => /.+@.+\..+/.test(e))))
        : [];
    }
    await recording.save();
    return { body: { recording: await recording.populate('createdBy', 'fullName email') }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Recordings] Error renaming recording:', error.message);
    return { body: { error: 'Failed to rename recording' }, httpStatus: 500 };
  }
}

/** Delete a recording. Owner (creator) or company admin only. */
export async function deleteRecording(id: string, firebaseUid: string | undefined): Promise<IServiceResult> {
  try {
    const user = await resolveUser(firebaseUid);
    if (!user) {
      return { body: { error: 'User profile not found' }, httpStatus: 404 };
    }

    const recording = await Recording.findById(id);
    if (!recording) {
      return { body: { error: 'Recording not found' }, httpStatus: 404 };
    }

    if (!mayManageResource(user, recording)) {
      return { body: { error: 'Only the owner or a company admin can delete this recording' }, httpStatus: 403 };
    }

    await recording.deleteOne();
    return { body: { message: 'Recording deleted' }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Recordings] Error deleting recording:', error.message);
    return { body: { error: 'Failed to delete recording' }, httpStatus: 500 };
  }
}

/** Fetch a single recording by ID for details or standalone video playback. */
export async function getRecording(id: string, authHeader: string | undefined, queryToken: string | undefined): Promise<IServiceResult> {
  try {
    const recording = await Recording.findById(id).populate('createdBy', 'fullName email avatarUrl');
    if (!recording) {
      return { body: { error: 'Recording not found' }, httpStatus: 404 };
    }
    if (!mayViewRecording(recording, await resolveOptionalViewer(authHeader, queryToken))) {
      return { body: { error: 'Recording not found' }, httpStatus: 404 };
    }
    return { body: { recording }, httpStatus: 200 };
  } catch (error: any) {
    console.error('[Recordings] Error fetching single recording:', error.message);
    return { body: { error: 'Failed to fetch recording' }, httpStatus: 500 };
  }
}

export type IPrepareStreamResult =
  | { ok: true; filePath: string; size: number }
  | { ok: false; body: any; httpStatus: number };

/**
 * Validates and resolves everything needed to stream a recording's bytes (existence, viewer
 * authorization, safe on-disk path, file stat) WITHOUT touching `res` -- streaming the actual
 * bytes (including Range/206 handling) stays in recording.controller.ts, since piping a
 * ReadStream to a response is response-stream mechanics a plain service function can't do.
 */
export async function prepareRecordingStream(id: string, authHeader: string | undefined, queryToken: string | undefined): Promise<IPrepareStreamResult> {
  const recording = await Recording.findById(id);
  if (!recording || !recording.fileUrl || recording.status !== 'Ready') {
    return { ok: false, body: { error: 'Recording not available' }, httpStatus: 404 };
  }
  if (!mayViewRecording(recording, await resolveOptionalViewer(authHeader, queryToken))) {
    return { ok: false, body: { error: 'Recording not available' }, httpStatus: 404 };
  }

  let filePath: string;
  try {
    filePath = await resolveRecordingFilePath(recording.fileUrl);
  } catch {
    return { ok: false, body: { error: 'Recording file not found' }, httpStatus: 404 };
  }

  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) {
    return { ok: false, body: { error: 'Recording file not found' }, httpStatus: 404 };
  }

  return { ok: true, filePath, size: stat.size };
}
