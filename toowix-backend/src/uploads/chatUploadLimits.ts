// A single shared limit across every chat attachment type (image, voice note, generic file) --
// these used to be three different numbers (3MB/5MB/10MB across chatImageStorage.ts,
// chatFileStorage.ts, chatAudioStorage.ts), which is exactly the kind of inconsistency that makes
// "why did this one fail but that one worked" confusing. Must stay in lockstep with the
// frontend's own MAX_CHAT_ATTACHMENT_BYTES (chatApi.ts) and the proxy's client_max_body_size,
// which has to be comfortably larger than this to account for base64 inflating the file by ~33%
// plus JSON overhead -- see talk-proxy.conf's own comment.
export const MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024;
