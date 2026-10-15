// User-facing (not just debug-overlay) signal for when the portrait-crop fallback engages on the
// LOCAL participant's own camera (see portraitCropProcessor.ts). The crop is a real, visible loss
// of field of view -- the person should know their camera is being cropped and why, not just see
// it happen silently. A plain subscriber-list singleton, same shape as speakingStore.ts/
// galleryOrientationDebug.ts's own snapshot stores -- this is UI state read by exactly one small
// banner component, not something that needs React context or Redux.
export interface IPortraitCropNoticeState {
  // true once this session's local camera has been cropped at least once; stays true across a
  // camera-off/on toggle or device switch within the same call (the limitation is still present),
  // only reset by a fresh page load.
  active: boolean;
  dismissed: boolean;
}

const state: IPortraitCropNoticeState = { active: false, dismissed: false };
const subscribers = new Set<() => void>();

function notify(): void {
  subscribers.forEach((fn) => fn());
}

export function subscribePortraitCropNotice(fn: () => void): () => void {
  subscribers.add(fn);

  return () => subscribers.delete(fn);
}

export function getPortraitCropNoticeState(): IPortraitCropNoticeState {
  return state;
}

// Called from every local camera-acquisition call site once portraitCropped is known (see
// useJitsiMeeting.ts/useLibJitsiConference.ts). Idempotent -- a dismissed notice stays dismissed
// across a later device switch or camera-retry within the same call; re-showing it every time the
// phone merely toggles its camera would be noise, not information, for a limitation the person has
// already been told about this session.
export function reportPortraitCropped(cropped: boolean): void {
  if (!cropped || state.active) return;
  state.active = true;
  notify();
}

export function dismissPortraitCropNotice(): void {
  if (state.dismissed) return;
  state.dismissed = true;
  notify();
}
