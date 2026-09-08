-- Load on the main conference MUC component, with token_verification and token_affiliation.
-- Only verified token context is consulted. Enable allow_empty_token=false on main VirtualHost.
local st = require 'util.stanza';
local util = module:require 'util';

module:hook('muc-occupant-pre-join', function(event)
    local session, room, occupant = event.origin, event.room, event.occupant;
    if util.is_admin(occupant.bare_jid) or util.is_healthcheck_room(room.jid) then return; end
    if not session.auth_token or not session.jitsi_meet_context_user then
        session.send(st.error_reply(event.stanza, 'auth', 'not-authorized', 'Admission token required'));
        return true;
    end
    local policy = session.jitsi_meet_context_room or {};
    if policy.lobby == true then
        room._data.toowix_lobby_required = true;
    end
    if not room._data.toowix_lobby_required then return; end
    if not room:get_members_only() or not room._data.lobbyroom then
        prosody.events.fire_event('create-lobby-room', { room = room; });
    end
    if not room:get_members_only() or not room._data.lobbyroom then
        session.send(st.error_reply(event.stanza, 'cancel', 'service-unavailable', 'Required lobby unavailable'));
        return true;
    end
    -- A verified host must be able to enter before any guests, to admit them.
    if session.jitsi_meet_context_user.moderator == true then
        room:set_affiliation(true, occupant.bare_jid, 'owner');
        occupant.role = 'moderator';
    end
end, 98); -- after token verification (99), before affiliation and lobby admission

-- Enforced lobby cannot be disabled with a room configuration IQ.
module:hook('muc-config-submitted', function(event)
    if event.room._data.toowix_lobby_required then
        event.fields['muc#roomconfig_membersonly'] = true;
    end
end, 100);
