import { PLAYBACK_STATUSES, SHARED_VIDEO } from '../sharedVideo/constants';

// Extracted from useJitsiMeeting.ts (Track 3, Phase 2, item 3): the room.on(...)/addCommandListener
// wiring that used to run inline inside the CONNECTION_ESTABLISHED handler. This is NOT a React
// hook and holds no state of its own -- it's a single function, called once at the exact point the
// inline code used to run, given the live `room`/`JitsiMeetJS` objects plus every ref/setter/helper
// the listeners read or write. All ~25 dependencies are passed explicitly in one object rather than
// threaded as positional params, so nothing is silently missing or stale; everything here is the
// SAME object identity (refs, setState functions) the caller already holds, not a copy.
//
// Deliberately NOT extracted: room.setDisplayName/setLocalParticipantProperty/room.join() right
// after the original listener block -- those start the join itself, a different concern from
// registering listeners, and still run in useJitsiMeeting.ts immediately after calling this.
//
// Confidence note (see the Track 3 report this was extracted under): everything here is typed `any`
// in the original code too, so TypeScript provides close to no safety net for a mistake in this
// move -- a wrong or missing dependency would compile cleanly while being wrong at runtime. This
// was verified by a careful line-by-line comparison against the original block, not by type-
// checking alone, and has not been exercised against a live Jitsi conference in this environment.

export interface IConferenceEventDeps {
  isStale: () => boolean;
  patchParticipant: (id: string, patch: Record<string, any>) => void;
  trackToStream: (track: any) => MediaStream | null;
  setSpeakingLevel: (id: string, level: number, holdMs?: number) => void;
  clearSpeaking: (id: string) => void;
  isSharingStatus: (status: string) => boolean;
  isDesktopTrackUsable: (track: any) => boolean;
  recomputeRemoteScreenShare: () => void;

  lastRemoteSpokeRef: { current: Record<string, number> };
  remoteDesktopTracksRef: { current: Record<string, any> };
  remoteNamesRef: { current: Record<string, string> };
  remoteAvatarsRef: { current: Record<string, string | null> };
  remoteSessionIdsRef: { current: Record<string, string> };
  localConferenceIdRef: { current: string | null };
  localSessionIdRef: { current: string };
  recordingSessionIdRef: { current: string | null };
  sharedVideoRef: { current: any };
  offerAnswerRecoveryRef: { current: { windowStartedAt: number; attempts: number } };
  offerAnswerRecoveryTimerRef: { current: ReturnType<typeof setTimeout> | null };
  onKickedRef: { current: (() => void) | undefined };

  setRemoteParticipants: (updater: (prev: Record<string, any>) => Record<string, any>) => void;
  setConnectionStats: (updater: (prev: Record<string, any>) => Record<string, any>) => void;
  setIsModerator: (value: boolean) => void;
  setLocalParticipantId: (id: string) => void;
  setJoined: (value: boolean) => void;
  setDominantSpeakerId: (id: string) => void;
  setRecording: (value: boolean) => void;
  setSharedVideo: (value: any) => void;
  setIsLocked: (value: boolean) => void;
  setError: (value: string | null) => void;
  setReconnectEpoch: (updater: (epoch: number) => number) => void;
}

// Matches the original isLocalParticipantEvent closure exactly -- moved here since it only needs
// `room` plus the two refs, both already passed into this function.
function makeIsLocalParticipantEvent(room: any, localConferenceIdRef: { current: string | null }, localSessionIdRef: { current: string }) {
  return (participantId: string | undefined, participant?: any) => {
    if (!participantId) {
      return true;
    }
    if (participantId === room.myUserId() || participantId === localConferenceIdRef.current) {
      return true;
    }

    // Matched by THIS TAB's own session id, not the JWT account id -- two tabs/devices
    // signed in as the same person share a JWT user id but must still show up as two
    // separate participant cards. A stale reconnect of THIS session carries the same
    // session id it always has, so it's still correctly filtered out here.
    const participantSessionId = participant?.getProperty?.('deviceSessionId');

    return Boolean(participantSessionId && participantSessionId === localSessionIdRef.current);
  };
}

export function registerConferenceEventListeners(room: any, JitsiMeetJS: any, deps: IConferenceEventDeps): void {
  const {
    isStale, patchParticipant, trackToStream, setSpeakingLevel, clearSpeaking, isSharingStatus,
    isDesktopTrackUsable, recomputeRemoteScreenShare,
    lastRemoteSpokeRef, remoteDesktopTracksRef, remoteNamesRef, remoteAvatarsRef, remoteSessionIdsRef, localConferenceIdRef,
    localSessionIdRef, recordingSessionIdRef, sharedVideoRef, offerAnswerRecoveryRef, offerAnswerRecoveryTimerRef,
    onKickedRef,
    setRemoteParticipants, setConnectionStats, setIsModerator, setLocalParticipantId, setJoined,
    setDominantSpeakerId, setRecording, setSharedVideo, setIsLocked, setError, setReconnectEpoch,
  } = deps;

  const isLocalParticipantEvent = makeIsLocalParticipantEvent(room, localConferenceIdRef, localSessionIdRef);

  room.on(JitsiMeetJS.events.conference.TRACK_ADDED, (track: any) => {
    if (track.isLocal()) {
      return;
    }
    const participantId = track.getParticipantId();
    const trackParticipant = room.getParticipantById(participantId);

    if (isLocalParticipantEvent(participantId, trackParticipant)) {
      return;
    }

    // Same hidden-Jibri guard as USER_JOINED -- a recorder track slipping through here
    // would still create a fake participant tile via patchParticipant's upsert.
    if (trackParticipant?.isHidden?.() || trackParticipant?.getBotType?.()) {
      return;
    }

    const type = track.getType();
    const videoType = typeof track.getVideoType === 'function' ? track.getVideoType() : 'camera';

    if (type === 'audio') {
      patchParticipant(participantId, { audioStream: trackToStream(track), muted: track.isMuted() });
      try {
        track.addEventListener(JitsiMeetJS.events.track.TRACK_AUDIO_LEVEL_CHANGED, (level: number) => {
          setSpeakingLevel(participantId, track.isMuted() ? 0 : level);
          // Someone whose audio is actually coming through is not muted -- correct a
          // stale "muted" flag instead of showing a muted mic on a talking person.
          if (level > 0.06) {
            lastRemoteSpokeRef.current[participantId] = Date.now();
            setRemoteParticipants((prev) => (
              prev[participantId]?.muted
                ? { ...prev, [participantId]: { ...prev[participantId], muted: false } }
                : prev
            ));
          }
        });
      } catch { /* audio levels unavailable */ }
    } else if (videoType === 'desktop') {
      // A desktop track that arrives already muted must not be shown as an active
      // presentation -- Jitsi can deliver a track in a muted state before the first
      // real frame, and registering it here would present a black/frozen tile until
      // (if ever) it unmutes.
      if (!track.isMuted() && isDesktopTrackUsable(track)) {
        remoteDesktopTracksRef.current[participantId] = track;
      }
      recomputeRemoteScreenShare();
    } else {
      patchParticipant(participantId, { stream: trackToStream(track), video: !track.isMuted() });
    }

    track.addEventListener(JitsiMeetJS.events.track.TRACK_MUTE_CHANGED, () => {
      if (type === 'audio') {
        patchParticipant(participantId, { muted: track.isMuted() });
      } else if (videoType === 'desktop') {
        // This is the real signal Jitsi uses to stop a screen share in many cases --
        // muting the existing desktop track rather than immediately removing it. This
        // listener used to ignore desktop entirely, which is why a stopped share left
        // remoteDesktopTracksRef (and therefore the remote presentation view) pointing
        // at a track that had stopped producing frames: the last frame froze on
        // screen and never cleared.
        if (track.isMuted() || !isDesktopTrackUsable(track)) {
          if (remoteDesktopTracksRef.current[participantId] === track) {
            delete remoteDesktopTracksRef.current[participantId];
          }
        } else {
          remoteDesktopTracksRef.current[participantId] = track;
        }
        recomputeRemoteScreenShare();
      } else {
        patchParticipant(participantId, { video: !track.isMuted() });
      }
    });
  });

  // Conference-level mute signal for remote audio: keeps the participant card badge in
  // lockstep with the participant's own mic toolbar state (muted <-> unmuted) even if
  // the per-track listener was attached to a since-replaced track.
  room.on(JitsiMeetJS.events.conference.TRACK_MUTE_CHANGED, (track: any) => {
    if (isStale() || !track || track.isLocal?.() || track.getType?.() !== 'audio') {
      return;
    }
    const participantId = track.getParticipantId?.();

    if (participantId) {
      patchParticipant(participantId, { muted: track.isMuted() });
    }
  });

  room.on(JitsiMeetJS.events.conference.TRACK_REMOVED, (track: any) => {
    if (track.isLocal()) {
      return;
    }
    const participantId = track.getParticipantId();
    const trackParticipant = room.getParticipantById(participantId);

    if (isLocalParticipantEvent(participantId, trackParticipant)) {
      return;
    }
    const type = track.getType();
    const videoType = typeof track.getVideoType === 'function' ? track.getVideoType() : 'camera';

    if (type === 'audio') {
      patchParticipant(participantId, { audioStream: null });
    } else if (videoType === 'desktop') {
      // Only delete if this is still the SAME track instance stored for this
      // participant. A late/stale TRACK_REMOVED for an old share (already superseded
      // by a newer desktop track added since) must not clear the current one out from
      // under it.
      if (remoteDesktopTracksRef.current[participantId] === track) {
        delete remoteDesktopTracksRef.current[participantId];
        recomputeRemoteScreenShare();
      }
    } else {
      patchParticipant(participantId, { stream: null, video: false });
    }
  });

  room.on(JitsiMeetJS.events.conference.USER_JOINED, (id: string, participant: any) => {
    // Jibri (the recording bot) joins the room as a real XMPP participant on the
    // server's hidden domain -- lib-jitsi-meet already flags it via isHidden()/
    // getBotType(), so skip it here or it shows up as a fake extra participant
    // the moment recording starts.
    if (participant?.isHidden?.() || participant?.getBotType?.()) {
      return;
    }
    // A reconnecting browser can receive presence for its prior Jitsi session before
    // the server times it out. It is still the same signed-in person, not somebody who
    // joined the meeting, so never let it create a tile/count/toast.
    if (isLocalParticipantEvent(id, participant)) {
      return;
    }

    const name = participant.getDisplayName() || 'Participant';
    const deviceSessionId = typeof participant.getProperty?.('deviceSessionId') === 'string'
      ? participant.getProperty('deviceSessionId')
      : null;
    // The JWT's context.user.avatar (see generateJitsiToken on the backend) is
    // propagated to every other participant as this "identity" -- it's the real
    // mechanism for remote avatars, not something lib-jitsi-meet exposes as a plain
    // getter. Only ever a short http(s) URL now (never a base64 blob -- see the JWT
    // fix), so no size concerns reading it back out here.
    const avatarUrl = participant.getIdentity?.()?.user?.avatar || null;

    remoteNamesRef.current[id] = name;
    remoteAvatarsRef.current[id] = avatarUrl;

    // Jitsi assigns a new participant id after a full browser reload, while the old presence can
    // remain until its connection times out. The per-tab device session id is intentionally kept
    // in sessionStorage by useJitsiMeeting, so matching it is an exact reconnect match. Do not
    // use a display-name match here: two real people can share a name and must never be merged.
    const staleIds = deviceSessionId
      ? Object.entries(remoteSessionIdsRef.current)
        .filter(([participantId, sessionId]) => participantId !== id && sessionId === deviceSessionId)
        .map(([participantId]) => participantId)
      : [];

    for (const staleId of staleIds) {
      delete remoteNamesRef.current[staleId];
      delete remoteAvatarsRef.current[staleId];
      delete remoteSessionIdsRef.current[staleId];
      delete remoteDesktopTracksRef.current[staleId];
      clearSpeaking(staleId);
    }
    if (staleIds.length > 0) {
      setRemoteParticipants((prev) => {
        const next = { ...prev };
        staleIds.forEach((staleId) => delete next[staleId]);
        return next;
      });
      setConnectionStats((prev) => {
        const next = { ...prev };
        staleIds.forEach((staleId) => delete next[staleId]);
        return next;
      });
    }
    if (deviceSessionId) remoteSessionIdsRef.current[id] = deviceSessionId;

    patchParticipant(id, {
      deviceSessionId,
      name,
      avatarUrl,
      isModerator: participant.getRole?.() === 'moderator'
    });
  });

  // A moderator promotion is applied by Jicofo/MUC and broadcast to every client.
  // Keep the roster and the local moderator controls in sync with that authoritative
  // conference event; do not optimistically mark a participant as a moderator.
  room.on(JitsiMeetJS.events.conference.USER_ROLE_CHANGED, (id: string, role: string) => {
    if (isStale()) {
      return;
    }
    const moderator = role === 'moderator';

    if (id === room.myUserId() || id === localConferenceIdRef.current) {
      setIsModerator(moderator);

      return;
    }
    patchParticipant(id, { isModerator: moderator });
  });

  room.on(JitsiMeetJS.events.conference.USER_LEFT, (id: string) => {
    clearSpeaking(id);
    delete remoteNamesRef.current[id];
    delete remoteAvatarsRef.current[id];
    delete remoteSessionIdsRef.current[id];
    delete remoteDesktopTracksRef.current[id];
    recomputeRemoteScreenShare();
    // connectionStats is keyed by participant id and only ever grown by the
    // cq.remote_stats_updated listener above -- with nothing pruning it here, anyone
    // who joined and later left stayed in the Participant stats modal forever under a
    // blank "Participant" row (their name lookup fails once they're gone), inflating
    // the apparent headcount past who's actually still on the call.
    setConnectionStats(prev => {
      if (!(id in prev)) {
        return prev;
      }
      const next = { ...prev };

      delete next[id];

      return next;
    });
    setRemoteParticipants(prev => {
      const next = { ...prev };

      delete next[id];

      return next;
    });
  });

  room.on(JitsiMeetJS.events.conference.CONFERENCE_JOINED, () => {
    if (isStale()) {
      return;
    }
    const ownConferenceId = room.myUserId();

    localConferenceIdRef.current = ownConferenceId;
    setLocalParticipantId(ownConferenceId);
    // Defensive cleanup for a self-presence event that arrived before
    // CONFERENCE_JOINED supplied the local Jitsi id.
    setRemoteParticipants((prev) => {
      if (!ownConferenceId || !(ownConferenceId in prev)) {
        return prev;
      }
      const next = { ...prev };

      delete next[ownConferenceId];

      return next;
    });
    setIsModerator(Boolean(room.isModerator?.()));
    setJoined(true);
  });

  // Native, JVB-computed dominant speaker -- fires with the local user's own id when
  // they're the loudest, matching localParticipantIdRef.current, so the caller can
  // tell "local" and "a specific remote participant" apart with a single id.
  room.on(JitsiMeetJS.events.conference.DOMINANT_SPEAKER_CHANGED, (id: string) => {
    if (isStale()) {
      return;
    }
    setDominantSpeakerId(id);
    // Fallback cue when per-track audio levels aren't delivered: hold ~2.5s.
    setSpeakingLevel(id, 1);
    setSpeakingLevel(id, 0, 2500);
    // Dominant-speaker detection is based on audio arriving at the bridge. If it says
    // a remote participant is speaking, an earlier track-level muted flag is stale;
    // never show a red muted badge on somebody who is actively speaking.
    if (id && id !== room.myUserId()) {
      lastRemoteSpokeRef.current[id] = Date.now();
      setRemoteParticipants((prev) => (
        prev[id]?.muted
          ? { ...prev, [id]: { ...prev[id], muted: false } }
          : prev
      ));
    }
  });

  // Real Jibri recording status -- rides XMPP presence, so every participant (not
  // just whoever clicked start) receives it, and it reflects Jibri's actual
  // confirmed state (on/off/pending/error), not an optimistic guess.
  room.on(JitsiMeetJS.events.conference.RECORDER_STATE_CHANGED, (session: any) => {
    if (isStale()) {
      return;
    }
    const status = session?.getStatus?.();

    if (status === 'on') {
      recordingSessionIdRef.current = session.getID();
      setRecording(true);
    } else if (status === 'off' || status === '') {
      recordingSessionIdRef.current = null;
      setRecording(false);
    }
    // 'pending' and other transitional statuses: leave `recording` as-is: not yet
    // confirmed on, and stopping too is more useful as "still recording until told
    // otherwise" than flickering the UI on every intermediate state.
  });

  // Real SHARED_VIDEO XMPP command, ported from jitsi-meet's shared-video middleware --
  // fires for every participant INCLUDING the sender (MUC presence commands echo back
  // to their own sender), so both "someone shared a video" and "I just shared one"
  // flow through this single listener, same as upstream.
  room.addCommandListener(SHARED_VIDEO, (data: { attributes: any; value: string }, from: string) => {
    if (isStale()) {
      return;
    }
    const { value, attributes } = data;
    const state = attributes?.state;
    const current = sharedVideoRef.current;

    // Someone else already owns an active share -- ignore a conflicting command from a
    // third party, matching upstream's ownerId guard.
    if (current?.ownerId && current.ownerId !== from) {
      return;
    }

    if (isSharingStatus(state)) {
      if (current?.videoUrl && current.videoUrl !== value) {
        return;
      }
      const next = {
        videoUrl: value,
        status: state,
        time: Number(attributes.time) || 0,
        ownerId: from,
        muted: attributes.muted === 'true' || attributes.muted === true,
        volume: attributes.volume !== undefined ? Number(attributes.volume) : undefined
      };

      sharedVideoRef.current = next;
      setSharedVideo(next);

      return;
    }

    if (state === PLAYBACK_STATUSES.STOPPED) {
      sharedVideoRef.current = null;
      setSharedVideo(null);
    }
  });

  // Real per-participant network quality -- lib-jitsi-meet computes this internally
  // (resolution/framerate/bitrate/packet loss/a 0-100 quality score) from actual RTP
  // stats, not something we compute ourselves. Raw string event names since these
  // aren't exposed on the public JitsiMeetJS.events namespace.
  room.on('cq.local_stats_updated', (stats: any) => {
    if (isStale()) {
      return;
    }
    setConnectionStats(prev => ({ ...prev, local: stats }));
  });
  room.on('cq.remote_stats_updated', (id: string, stats: any) => {
    if (isStale()) {
      return;
    }
    setConnectionStats(prev => ({ ...prev, [id]: stats }));
  });

  room.on(JitsiMeetJS.events.conference.LOCK_STATE_CHANGED, (locked: boolean) => {
    if (isStale()) {
      return;
    }
    setIsLocked(locked);
  });

  room.on(JitsiMeetJS.events.conference.CONFERENCE_FAILED, (errorType: string) => {
    if (isStale()) {
      return;
    }

    const normalizedError = String(errorType || '').toLowerCase();

    if (normalizedError.includes('offeranswerfailed')) {
      const now = Date.now();
      const recovery = offerAnswerRecoveryRef.current;

      if (now - recovery.windowStartedAt > 60_000) {
        recovery.windowStartedAt = now;
        recovery.attempts = 0;
      }

      if (recovery.attempts < 1 && !offerAnswerRecoveryTimerRef.current) {
        recovery.attempts += 1;
        setError('Refreshing the media connection…');
        offerAnswerRecoveryTimerRef.current = setTimeout(() => {
          offerAnswerRecoveryTimerRef.current = null;
          if (!isStale()) {
            setReconnectEpoch(epoch => epoch + 1);
          }
        }, 300);

        return;
      }
    }

    setError(`Conference failed: ${errorType}`);
  });

  room.on(JitsiMeetJS.events.conference.CONNECTION_INTERRUPTED, () => {
    if (isStale()) {
      return;
    }
    setError('Connection interrupted -- attempting to reconnect.');
  });
  room.on(JitsiMeetJS.events.conference.CONNECTION_RESTORED, () => {
    if (isStale()) {
      return;
    }
    setError(null);
  });

  // Fires with no participant argument when the LOCAL user is the one force-removed
  // by a moderator -- the moderator-kick admin feature this replaces relied on.
  room.on(JitsiMeetJS.events.conference.KICKED, (participant: any) => {
    if (!participant) {
      onKickedRef.current?.();
    }
  });
}
