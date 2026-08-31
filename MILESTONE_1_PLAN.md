# Milestone 1: Jitsi Base Setup & White-Labeling Plan (Toowix Meet)

## 1. Overview & Objective
Establish a stable, fully branded **Toowix Meet** meeting engine running at **`meet.toowix.com`**.
This milestone delivers the core video conferencing infrastructure, customized branding, host controls, in-meeting collaboration tools, and verified cross-platform compatibility.

---

## 2. Milestone 1 Requirements Breakdown

| Requirement | Category | Current Status in Codebase | Action Needed |
| :--- | :--- | :--- | :--- |
| **Toowix Branding Always Visible** | Branding | Jitsi Defaults | Replace logos, title, watermark, favicon, and brand colors |
| **Deploy Latest Stable Jitsi** | Infrastructure | Source ready | Configure Nginx, Prosody, Jicofo, JVB on target server |
| **Configure `meet.toowix.com`** | Infrastructure | Localhost dev | Point DNS A/AAAA records & configure web host headers |
| **Configure Secure HTTPS** | Security | Self-signed in dev | Automate Let's Encrypt SSL/TLS certificates via Certbot |
| **Create Unique Meeting IDs** | Core Engine | Supported | Ensure secure random generator is active by default |
| **Allow Custom Meeting IDs** | Core Engine | Supported | Enable custom room naming field on welcome page |
| **Desktop & Mobile Compatibility** | QA / UX | Responsive | Verify Chrome, Edge, Firefox, Safari (iOS & Android) |
| **Enable Lobby / Waiting Room** | Meeting Control | Implemented | Enable by default and ensure host controls are active |
| **Enable Meeting Chat** | In-Meeting | Implemented | Enable chat toolbar button & notifications |
| **Enable Screen Sharing** | In-Meeting | Implemented | Enable screen/tab/window audio & video sharing |
| **Enable Raise Hand** | In-Meeting | Implemented | Enable raise hand queue in participants pane |
| **Enable Reactions** | In-Meeting | Implemented | Enable animated emojis & sound reactions |
| **Enable Captions** | In-Meeting | Implemented | Configure speech-to-text / subtitles module |
| **Background Blur / Virtual Background** | In-Meeting | Implemented | Ensure WASM & TFLite models are loaded |
| **Host Mute Participants / Everyone** | Moderation | Implemented | Enable mute-all and individual mute action |
| **Prevent Forcibly Muted User from Unmuting** | Moderation | Implemented | Enable AV Moderation lock rules |
| **No Forced Camera Control** | Privacy Policy | Built-in | Ensure remote camera activation is strictly prohibited |
| **Host / Co-host Can End Meeting for All** | Moderation | Implemented | Enable `endMeeting` toolbar & menu action |
| **Normal Participant Can Leave Individually** | Core UX | Built-in | Hangup button disconnects only the local participant |

---

## 3. Step-by-Step Implementation Strategy

### Step 1: Branding & White-Label Customization
1. **Title & SEO Metadata**:
   - Edit `title.html` with title `Toowix Meet`, OpenGraph descriptions, and brand assets.
   - Update `resources/manifest.json` for PWA installation support with Toowix icons.
2. **Visual Assets**:
   - Replace `images/watermark.svg` with Toowix Watermark.
   - Replace `images/favicon.ico` / `favicon.svg`.
   - Add official Toowix logo for the welcome and prejoin screens.
3. **Interface Configuration**:
   - Update `interface_config.js` and `config.js`:
     - `APP_NAME`: `'Toowix Meet'`
     - `BRAND_WATERMARK_LINK`: `'https://toowix.com'`
     - `SHOW_JITSI_WATERMARK`: `false`
     - `SHOW_WATERMARK_FOR_GUESTS`: `true`

### Step 2: In-Meeting Feature Toggles & Policy Lock
1. **Host Moderation & Security**:
   - Enable AV Moderation (`avModeration: { enabled: true }`) so hosts can lock microphones.
   - Ensure `disableRemoteMute: false` and remote unmute is configured only as an unmute *request*.
   - Enable `endMeeting: true` for room moderators.
2. **Lobby & Prejoin**:
   - Enable prejoin screen (`prejoinConfig.enabled: true`) so participants test audio/video before entering.
   - Configure lobby access controls in the security dialog.
3. **Collaboration Tools**:
   - Verify toolbar button list includes: `microphone`, `camera`, `desktop`, `chat`, `raisehand`, `reactions`, `participants-pane`, `tileview`, `select-background`, `settings`, `hangup`.

### Step 3: Production Server Deployment (`meet.toowix.com`)
1. **Host Server Setup**:
   - Ubuntu Linux 22.04/24.04 LTS VPS or Cloud instance.
   - Open ports: `80/tcp` (HTTP), `443/tcp` (HTTPS), `10000/udp` (JVB media traffic), `22/tcp` (SSH).
2. **Core Stack Installation**:
   - Deploy Prosody (XMPP signaling), Jicofo (Conference focus), Jitsi Videobridge (SFU), and Nginx.
3. **Domain & SSL**:
   - Set DNS A record `meet.toowix.com` $\rightarrow$ Server IP.
   - Issue automated Let's Encrypt certificate: `certbot --nginx -d meet.toowix.com`.
4. **Deploy Custom Web Client**:
   - Run `prepare-dev.sh` / production build.
   - Sync compiled bundle and static assets to `/usr/share/jitsi-meet/` on the server.

### Step 4: Verification & Quality Matrix
1. **Host & Guest Test**:
   - Host creates room $\rightarrow$ turns on Lobby.
   - Guest joins $\rightarrow$ waits in Lobby $\rightarrow$ Host admits guest.
   - Host mutes guest and locks unmute $\rightarrow$ Guest cannot unmute.
   - Host unlocks $\rightarrow$ Guest can unmute.
   - Host clicks "End Meeting for Everyone" $\rightarrow$ all attendees are disconnected.
2. **Cross-Browser Verification**:
   - Desktop: Google Chrome, Mozilla Firefox, Microsoft Edge, Apple Safari.
   - Mobile: Chrome (Android), Safari (iOS).

---

## 4. Deliverable
A fully operational, branded, secure meeting engine running at **`https://meet.toowix.com`** with all Milestone 1 features active and verified.
