-- Load on the participant VirtualHost only (not the service/focus VirtualHost).
-- Deny unauthorized Jibri start IQs before Jicofo sees them; UI hiding is not authorization.
local st = require 'util.stanza';
local function authorize_recording(event)
    local stanza, session = event.stanza, event.origin;
    local jibri = stanza:get_child('jibri', 'http://jitsi.org/protocol/jibri');
    if not jibri or string.lower(jibri.attr.action or '') ~= 'start' then return; end
    local features = session.jitsi_meet_context_features or {};
    local user = session.jitsi_meet_context_user or {};
    if not session.auth_token or features.recording ~= true or user.moderator ~= true then
        session.send(st.error_reply(stanza, 'auth', 'forbidden', 'Recording is not authorized'));
        return true;
    end
end
module:hook('pre-iq/full', authorize_recording, 100);
module:hook('pre-iq/bare', authorize_recording, 100);
module:hook('pre-iq/host', authorize_recording, 100);
