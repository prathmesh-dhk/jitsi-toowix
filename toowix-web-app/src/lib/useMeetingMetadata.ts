import { useCallback, useEffect, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { auth } from './firebase';
import { getMeetingUrl } from './meeting-id';
import { ensureLibJitsiMeetLoaded } from './jitsi/ensureLibJitsiMeetLoaded';

// P1-8 fix (2G/3G performance plan, "Refactor MeetingRoomPage.tsx without changing behavior"):
// first extraction out of that ~9,800-line file -- the meeting-metadata lookup concern
// (useMeetingMetadata in the plan's own suggested module list). Moved verbatim, no behavior
// change: same two-request shape (P1-5's probe-skip logic included), same script-preload effect,
// same derived isFreeInstantMeeting/freeInstantExpiresAt/shareableMeetingUrl values. setMeetingInfo
// and meetingInfoRef are both still written to from MeetingRoomPage's own admission/join flow
// (a real, POST-driven refinement of the same meeting document this hook GETs), so this hook
// exposes them rather than trying to own that write exclusively -- splitting that cross-cutting
// write out cleanly is a separate, later extraction (useMeetingAdmission in the plan's list), not
// this one.

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000';

export interface IMeetingInfo {
  type: string;
  organizerId: string;
  organizerName: string;
  description: string | null;
  inviteRestricted: boolean;
  accessAllowed: boolean;
  autoRecording: boolean;
  recordingEnabled: boolean;
  cancelled: boolean;
  expired: boolean;
  expiresAt: string | null;
  passwordRequired: boolean;
  locked?: boolean;
  requireLobbyPolicy: boolean;
  allowScreenShare: boolean;
  micLockEnabled: boolean;
  // True only for a meeting created from the dashboard (instant or "schedule for later") --
  // has a saved conversation on the backend. False for an ad-hoc room (the public homepage's
  // free instant meeting, or any bare room code), whose chat is never persisted.
  persisted?: boolean;
  // Server-computed (see lobby.service.ts's freeInstantFirstSeenAt): null for a persisted
  // meeting, otherwise the one shared 2-hour-cap target every participant in an ad-hoc room
  // reads directly from their own admission response -- no client broadcast involved.
  freeInstantExpiresAt?: number | null;
  // True for any meeting meant to be joined right now rather than at a scheduled future time --
  // covers both an ad-hoc free room AND a persisted dashboard "instant meeting" (see
  // lobby.service.ts's own isInstant field). Deliberately broader than persisted/
  // isFreeInstantMeeting below, which must stay narrow to the ad-hoc, 2-hour-capped case only.
  isInstant?: boolean;
  // Soft, non-blocking signal (see lobby.service.ts's adHocEndedAt comment): true only for a
  // brief window after an ad-hoc room's "end for everyone" -- lets the prejoin screen show an
  // honest "this will start a new meeting" notice. Unlike `ended`/`endReason`, this never routes
  // away from the lobby; the link stays exactly as reusable as before once the window passes.
  recentlyEndedForEveryone?: boolean;
}

// Backend half of this split lives in lobby.service.ts / admission.ts -- isUnavailableMeetingResponse's
// own message-pattern matching exists because the backend doesn't (yet) return a single closed
// enum for every unavailable case. resolvePrejoinEndedDestination's own explicit `reason`/
// `endReason` field is the newer, precise mechanism; this is the fallback for everything else
// (cancelled, not found, etc.). Both are used by MeetingRoomPage's own admission/join flow too
// (a POST, not this hook's GET), so they're exported rather than kept private to this file.
export function resolvePrejoinEndedDestination(data: any): '/meeting-ended' | '/meeting-link-expired' | null {
  // Three real shapes reach this: the POST admission/knock error body (`{ error, reason }`), the
  // unwrapped `meeting` object from a GET metadata lookup (`{ ended, endReason, ... }`), and
  // (defensively) the full outer GET response wrapper (`{ meeting: { endReason } }`) in case a
  // future caller passes that instead of already unwrapping it.
  const reason = data?.reason ?? data?.endReason ?? data?.meeting?.endReason;

  if (reason === 'LINK_EXPIRED') return '/meeting-link-expired';
  if (reason === 'HOST_ENDED' || reason === 'DURATION_LIMIT') return '/meeting-ended';

  return null;
}

// These responses mean that the URL cannot be used to enter a meeting. Keep access-policy
// failures (for example, a valid private meeting that requires sign-in) in the lobby so the
// user can act on them; only unavailable links belong on the expired-link page.
export function isUnavailableMeetingResponse(status: number, message?: string): boolean {
  return status === 400 || status === 404 || status === 410
    || (status === 403 && /\b(cancelled|ended|not found)\b/i.test(message || ''));
}

export interface IUseMeetingMetadataOptions {
  roomId: string;
  isFromConversation: boolean;
  navigate: NavigateFunction;
  setAdmissionError: (message: string) => void;
}

export function useMeetingMetadata({ roomId, isFromConversation, navigate, setAdmissionError }: IUseMeetingMetadataOptions) {
  const [meetingInfo, setMeetingInfo] = useState<IMeetingInfo | null>(null);
  const meetingInfoRef = useRef(meetingInfo);

  // Free/unauthenticated instant meeting -- capped at 2 hours, like a free-tier call limit.
  // Real reported bug: the countdown timer never showed up for anyone except the one browser tab
  // that actually clicked the homepage's "New Meeting" button. Two wrong signals were tried and
  // both broke for the exact same reason -- they only describe how the CREATOR'S OWN tab got
  // here, not something every participant shares:
  //   1. location.state.freeInstantMeeting -- only set by that one `navigate()` call; a guest
  //      who opens the meeting from a shared link lands here with empty location.state.
  //   2. location.pathname.startsWith('/instant/') -- the creator's own tab does land on that
  //      route, but the share-link this app hands out for that SAME meeting does not: the
  //      room id is the plain twx-xxx-xxx-xxx shape with no "instant-" prefix, so
  //      buildMeetingPath (meeting-id.ts) resolves it to the bare "/<roomId>" route
  //      (BareRoomRoute) for every guest who actually uses that link, not "/instant/<roomId>".
  // meetingInfo.persisted is the one piece of information that is actually identical for every
  // participant regardless of which URL shape got them here: the backend already computes it
  // from whether this room has a real Meeting document (see lobby.service.ts's own `persisted:
  // !!meeting`), true for a dashboard-created meeting and false for every kind of ad-hoc room --
  // this app's "free instant meeting" tier by definition. `meetingInfo != null` guards against
  // this reading true for the first render or two before the real admission response has come
  // back, when it would otherwise default to true for every meeting type.
  const isFreeInstantMeeting = meetingInfo != null && meetingInfo.persisted !== true;
  // Server-computed (see lobby.service.ts's freeInstantFirstSeenAt) and already identical for
  // every participant the moment their own admission response includes it -- no broadcast, no
  // moderator-only special case, no dependence on how long the realtime signal buffer happens to
  // retain things. Replaces an earlier, fragile design further down this file's history: the
  // moderator broadcast a locally-computed value once over the signal channel, which worked only
  // as long as a later joiner's subscription still found it in that buffer by the time they
  // connected -- not a safe assumption for a value that must stay correct for up to 2 hours.
  const freeInstantExpiresAt = meetingInfo?.freeInstantExpiresAt ?? null;
  // Real reported bug: an instant meeting's own invite link (copy link, share modal, embed
  // modal, "Your meeting's ready" dialog) never actually read "/instant/<roomId>" -- getMeetingUrl
  // builds the URL from buildMeetingPath's generic ID-shape rules (meeting-id.ts), which can't
  // tell an instant meeting apart from any other twx-xxx-xxx-xxx room by shape alone, so it
  // always resolved to the bare "/<roomId>" path regardless. meetingInfo.isInstant is a backend
  // fact covering BOTH the ad-hoc free case and a persisted dashboard "instant meeting" (unlike
  // isFreeInstantMeeting above, which must stay narrow to only the ad-hoc, 2-hour-capped case),
  // so it's the right thing to branch on here.
  const shareableMeetingUrl = meetingInfo?.isInstant
    ? `${window.location.origin}/instant/${roomId}`
    : getMeetingUrl(roomId);

  // Used only for the initial meeting-info lookup below: attaches a bearer token when signed in,
  // regardless of the participation choice, so that lookup can tell us the meeting's organizerId
  // (needed by MeetingRoomPage's own host-detection effect) and correctly waive the password for
  // the host, without that alone committing anyone to joining as their account.
  const getInfoLookupHeaders = useCallback(async (): Promise<Record<string, string>> => {
    await auth.authStateReady();
    if (!auth.currentUser) return {};
    try {
      return {
        Authorization: `Bearer ${await auth.currentUser.getIdToken()}`,
        'X-Toowix-Session': localStorage.getItem('toowix_session_token') || '',
      };
    } catch {
      return {};
    }
  }, []);

  // Pure env read with no dependencies -- used by the preload effect below, and duplicated
  // (identically) in MeetingRoomPage.tsx for its own, unrelated uses of the same constant.
  const jitsiDomain = import.meta.env.VITE_JITSI_DOMAIN || 'talk.toowix.com';

  // Fetch meeting metadata
  useEffect(() => {
    if (window.location.search && !isFromConversation) window.history.replaceState(window.history.state, '', window.location.pathname);
    let active = true;
    setMeetingInfo(null);
    meetingInfoRef.current = null;
    setAdmissionError('');
    // Existence checks must not wait for Firebase's auth restoration on a slow mobile link.
    // Real reported delay: meetingInfo used to be set ONLY from the second, authenticated fetch
    // below, which is gated behind `await auth.authStateReady()` -- Firebase restoring its local
    // auth state, which can genuinely take a few hundred ms or more on a slow connection. The
    // page sat blank/loading that whole time even though this FIRST, unauthenticated probe (which
    // already has to run immediately, to fast-detect an ended/expired meeting) returns the exact
    // same meeting document for everyone, guest or signed-in -- auth only adds organizerId-
    // dependent extras (host password waiver, etc.), which the second fetch still applies when it
    // resolves. Populating meetingInfo from THIS response too means the lobby screen shows real
    // data as soon as the fast, auth-independent request completes, not after Firebase as well.
    const probeController = new AbortController();
    const meetingLookupUrl = `${BACKEND_URL}/api/meetings/room/${encodeURIComponent(roomId)}${isFromConversation ? '?fromConversation=1' : ''}`;

    // `authoritative` mirrors the original two call sites' own behavior: the fast unauthenticated
    // probe only fills meetingInfo if nothing has set it yet (never clobbers a result the
    // authenticated fetch already applied), while the authenticated fetch is the final word and
    // always applies its own data -- it alone can carry organizer-only extras (host password
    // waiver, etc.) that must override whatever the plain probe saw.
    const handleLookupResponse = (response: Response, data: any, authoritative: boolean) => {
      if (!active) return;
      if (response.ok && data.meeting && (authoritative || !meetingInfoRef.current)) {
        setMeetingInfo(data.meeting);
        meetingInfoRef.current = data.meeting;
      }
      if (isFromConversation) return;
      const endedDestination = resolvePrejoinEndedDestination(data.meeting);

      if (endedDestination) {
        navigate(endedDestination, endedDestination === '/meeting-ended'
          ? { replace: true, state: { roomId, reason: 'This meeting has ended.' } }
          : { replace: true });
      } else if (isUnavailableMeetingResponse(response.status, data.error) || data.meeting?.expired || data.meeting?.cancelled) {
        navigate('/meeting-link-expired', { replace: true });
      }
    };

    // P1-5 fix (2G/3G performance plan): this room's metadata used to always be fetched TWICE --
    // once unauthenticated (for a fast, auth-independent first paint, see the comment this
    // replaces) and once again with an auth header, even though the backend returns the exact
    // same meeting document either way (auth only adds organizer-only extras like the host's
    // password waiver). For a guest -- the common case for any public meeting link -- those two
    // requests are byte-identical. `auth.currentUser` is a synchronous Firebase SDK read (no
    // network/IndexedDB wait): if a session is already restored (e.g. navigating here from the
    // dashboard within the same tab, not a fresh page load), skip the unauthenticated probe
    // entirely and go straight to the one real (authenticated) request below. A cold page load
    // where Firebase hasn't restored its session yet still can't know this synchronously, so it
    // still probes first for fast perceived load -- the async block below then skips its OWN
    // duplicate request if that probe already succeeded and turns out to have been a guest after
    // all (the single most common outcome on a cold load of a public link).
    const sessionAlreadyRestored = Boolean(auth.currentUser);
    const probePromise = sessionAlreadyRestored
      ? Promise.resolve(null)
      : fetch(meetingLookupUrl, { signal: probeController.signal }).then(async response => {
        const data = await response.json();

        handleLookupResponse(response, data, false);

        return { ok: response.ok };
      }).catch(() => null);

    (async () => {
      try {
        await auth.authStateReady();
        // React StrictMode (dev only) mounts this effect twice, tearing the first instance down
        // immediately -- that teardown aborts the probe above, but without this check the torn-
        // down instance would still fall through and fire a real, un-aborted authenticated fetch
        // below (an aborted probe resolves probeResult to null via its own .catch, which reads
        // exactly like "no answer yet", not "already cancelled"). Confirmed live: visible as a
        // genuine third network request in a request-capture trace. Bailing out here the instant
        // the effect is already cleaned up closes that gap -- a real roomId/dep change mid-flight
        // gets the same protection, not just a StrictMode-specific patch.
        if (!active) return;
        const probeResult = sessionAlreadyRestored ? null : await probePromise;

        if (!active) return;
        // Guest whose probe above already got a real answer: the authenticated request would be
        // the identical URL with empty headers (no bearer token to add) -- skip the redundant
        // round trip and keep the probe's result.
        if (!auth.currentUser && probeResult?.ok) {
          return;
        }
        // Shares the probe's own AbortController -- a cleanup that fires while this request is
        // still in flight now actually cancels it at the network level, instead of only letting
        // handleLookupResponse's `active` check discard an already-completed response.
        const response = await fetch(meetingLookupUrl, { headers: await getInfoLookupHeaders(), signal: probeController.signal });
        const data = await response.json();

        if (!response.ok) {
          if (active && !isFromConversation && isUnavailableMeetingResponse(response.status, data.error)) {
            navigate('/meeting-link-expired', { replace: true });
            return;
          }
          throw new Error(data.error || 'Meeting lookup failed');
        }
        handleLookupResponse(response, data, true);
      } catch (error) {
        if (active) setAdmissionError(error instanceof Error ? error.message : 'Meeting lookup failed');
      }
    })();
    return () => {
      active = false;
      probeController.abort();
    };
  }, [roomId, getInfoLookupHeaders, navigate, isFromConversation, setAdmissionError]);

  // Real reported delay: Jitsi's own JS libraries only started downloading after the Join
  // click, even though the person may have already been sitting on the lobby screen (reading
  // the meeting name, typing their display name) for seconds doing nothing network-intensive.
  // Preloading here, as soon as the lobby screen has something real to show, means the scripts
  // are typically already cached by the time handleJoinMeeting's own ensureLibJitsiMeetLoaded
  // call runs -- that later call is UNCHANGED and still the real source of truth (so a person who
  // clicks Join before this preload finishes still joins correctly, just without the head start).
  // Fire-and-forget: a slow or failed preload must never block the lobby screen from rendering,
  // so no loading state is tied to this at all, and the catch below is only to keep an unhandled
  // rejection out of the console (the real join flow's own error handling still applies if the
  // script genuinely can't load). Guarded by a ref, not included in meetingInfo's own dependency
  // array, so a later patch to the SAME meeting (e.g. passwordRequired flipping true) can't
  // trigger a second, redundant call -- though scriptLoadPromise's own memoization would no-op it
  // anyway.
  const jitsiScriptsPreloadStartedRef = useRef(false);
  useEffect(() => {
    if (jitsiScriptsPreloadStartedRef.current) return;
    if (!meetingInfo || meetingInfo.cancelled || (!isFromConversation && meetingInfo.expired)) return;
    jitsiScriptsPreloadStartedRef.current = true;
    void ensureLibJitsiMeetLoaded(jitsiDomain).catch(() => {
      // Swallowed deliberately -- this is a head start, not a requirement. The real join flow's
      // own ensureLibJitsiMeetLoaded call (inside useJitsiMeeting's connect effect) will retry
      // and surface a real error through its normal error handling if the script truly can't load.
    });
  }, [meetingInfo, isFromConversation, jitsiDomain]);

  return {
    meetingInfo,
    setMeetingInfo,
    meetingInfoRef,
    isFreeInstantMeeting,
    freeInstantExpiresAt,
    shareableMeetingUrl,
  };
}
