// Mirrors buildMeetingPath in toowix-web-app/src/lib/meeting-id.ts -- keep both in sync if the
// link shape ever changes (nginx's talk-proxy.conf.local bare-root route also matches this same
// twx-xxx-xxx-xxx shape).
const AUTO_GENERATED_ROOM_PATTERN = /^twx-[a-z]{3}-[a-z]{3}-[a-z]{3}$/;
const INSTANT_ROOM_PREFIX = 'instant-';

/**
 * Builds the room path for a meeting id, for server-generated links (invite/reminder/RSVP
 * emails, conversation-invite notifications): bare "/<id>" for our own auto-generated
 * twx-xxx-xxx-xxx slugs, "/instant/<id>" for the homepage's free instant meetings, and
 * "/meet/<id>" as the fallback for a user-typed custom slug.
 */
export function buildMeetingPath(roomSlug: string): string {
  const cleanId = String(roomSlug || '').trim().toLowerCase();

  if (cleanId.startsWith(INSTANT_ROOM_PREFIX)) {
    return `/instant/${cleanId}`;
  }
  if (AUTO_GENERATED_ROOM_PATTERN.test(cleanId)) {
    return `/${cleanId}`;
  }
  return `/meet/${cleanId}`;
}
