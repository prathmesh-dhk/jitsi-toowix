import { useState, type ReactNode } from 'react';
import { X, Volume2, Video, Settings, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { useMeetingPref, notifyDesktop } from '../lib/meetingPrefs';

type Tab = 'audio' | 'video' | 'general';

interface IDevice { deviceId: string; kind: string; label: string }

interface IProps {
  isOpen: boolean;
  onClose: () => void;
  isDark: boolean;
  devices: IDevice[];
  audioId: string;
  videoId: string;
  outputId: string;
  onSelectAudio: (id: string) => void;
  onSelectVideo: (id: string) => void;
  onSelectOutput: (id: string) => void;
  onSendResolution: (maxHeight: number) => void;
  onReceiveResolution: (maxHeight: number) => void;
  onOpenBackgrounds: () => void;
  tabs?: Tab[];
}

const RESOLUTIONS = [
  { value: 0, label: 'Auto' },
  { value: 720, label: 'High definition (720p)' },
  { value: 360, label: 'Standard definition (360p)' },
  { value: 180, label: 'Low definition (180p)' }
];

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      style={{
        width: '44px',
        height: '24px',
        borderRadius: '12px',
        border: 'none',
        cursor: 'pointer',
        backgroundColor: on ? '#4F46E5' : '#80868B',
        position: 'relative',
        flexShrink: 0,
        transition: 'background-color 0.15s ease'
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: '3px',
          left: on ? '23px' : '3px',
          width: '18px',
          height: '18px',
          borderRadius: '50%',
          backgroundColor: '#FFFFFF',
          transition: 'left 0.15s ease'
        }}
      />
    </button>
  );
}

export function MeetingSettingsDialog(props: IProps) {
  const { isOpen, onClose, isDark, devices } = props;
  const [ tab, setTab ] = useState<Tab>('audio');
  const [ callControlOpen, setCallControlOpen ] = useState(false);
  const [ pushToTalk, setPushToTalk ] = useMeetingPref('pushToTalk');
  const [ autoPip, setAutoPip ] = useMeetingPref('autoPip');
  const [ desktopNotifications, setDesktopNotifications ] = useMeetingPref('desktopNotifications');
  const [ leaveEmptyCalls, setLeaveEmptyCalls ] = useMeetingPref('leaveEmptyCalls');
  const [ joinLeaveSounds, setJoinLeaveSounds ] = useMeetingPref('joinLeaveSounds');
  const [ sendRes, setSendRes ] = useMeetingPref('sendResolution');
  const [ receiveRes, setReceiveRes ] = useMeetingPref('receiveResolution');

  if (!isOpen) {
    return null;
  }

  const fg = isDark ? '#E8EAED' : '#202124';
  const muted = isDark ? '#9AA0A6' : '#5F6368';
  const border = isDark ? 'rgba(255,255,255,0.15)' : '#DADCE0';
  const selectStyle = {
    width: '100%',
    padding: '12px',
    borderRadius: '6px',
    backgroundColor: isDark ? '#2D2E30' : '#FFFFFF',
    border: `1px solid ${border}`,
    color: fg,
    fontSize: '14px',
    outline: 'none'
  } as const;

  const testSpeaker = async () => {
    try {
      const audio = new Audio('/sounds/participant-joined.wav');

      if (props.outputId && (audio as any).setSinkId) {
        await (audio as any).setSinkId(props.outputId);
      }
      await audio.play();
    } catch { /* ignore */ }
  };

  const allTabs: Array<{ id: Tab; label: string; icon: ReactNode }> = [
    { id: 'audio', label: 'Audio', icon: <Volume2 size={20} /> },
    { id: 'video', label: 'Video', icon: <Video size={20} /> },
    { id: 'general', label: 'General', icon: <Settings size={20} /> }
  ];
  const tabs = allTabs.filter((t) => !props.tabs || props.tabs.includes(t.id));

  const label = (text: string) => (
    <div style={{ fontSize: '14px', fontWeight: 600, color: '#8AB4F8', marginBottom: '8px' }}>{text}</div>
  );
  const row = (title: string, description: string, control: ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', margin: '18px 0' }}>
      <div>
        <div style={{ fontSize: '14px', fontWeight: 600, color: fg }}>{title}</div>
        <div style={{ fontSize: '13px', color: muted, marginTop: '2px', maxWidth: '320px' }}>{description}</div>
      </div>
      {control}
    </div>
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
        padding: '20px'
      }}
    >
      <style>{`
        @media (max-width: 768px) {
          .tw-settings { flex-direction: column !important; height: min(640px, 92dvh) !important; }
          .tw-settings-nav { width: 100% !important; display: flex !important; flex-direction: row !important; gap: 4px; padding: 8px !important; border-right: none !important; border-bottom: 1px solid rgba(128,134,139,0.4) !important; overflow-x: auto; }
          .tw-settings-nav > div { display: none !important; }
          .tw-settings-nav button { width: auto !important; flex: 1; justify-content: center; margin-bottom: 0 !important; }
        }
      `}</style>
      <div
        className="tw-settings"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        style={{
          backgroundColor: isDark ? '#2D2E30' : '#FFFFFF',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '760px',
          height: 'min(600px, 90vh)',
          display: 'flex',
          overflow: 'hidden',
          boxShadow: '0 12px 36px rgba(0, 0, 0, 0.5)',
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : '#E5E7EB'}`,
          color: fg
        }}
      >
        <div className="tw-settings-nav" style={{ width: '200px', flexShrink: 0, padding: '20px 10px', borderRight: `1px solid ${border}` }}>
          <div style={{ fontSize: '22px', fontWeight: 500, padding: '0 12px 20px' }}>Settings</div>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                width: '100%',
                padding: '12px',
                marginBottom: '4px',
                borderRadius: '24px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '14px',
                textAlign: 'left',
                color: tab === t.id ? '#8AB4F8' : fg,
                backgroundColor: tab === t.id ? 'rgba(138,180,248,0.16)' : 'transparent'
              }}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, padding: '24px 28px', overflowY: 'auto', position: 'relative' }}>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', color: muted, cursor: 'pointer' }}
          >
            <X size={22} />
          </button>

          {tab === 'audio' && (
            <div style={{ paddingRight: '24px' }}>
              {label('Microphone')}
              <select value={props.audioId} onChange={(e) => props.onSelectAudio(e.target.value)} style={selectStyle}>
                <option value="">Default System Microphone</option>
                {devices.filter((d) => d.kind === 'audioinput').map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${d.deviceId.slice(0, 5)}`}</option>
                ))}
              </select>

              {row('Push to talk', 'Press and hold spacebar to unmute your mic', <Toggle on={pushToTalk} onChange={setPushToTalk} label="Push to talk" />)}

              <div style={{ marginTop: '24px' }}>
                {label('Speaker')}
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <select value={props.outputId} onChange={(e) => props.onSelectOutput(e.target.value)} style={selectStyle}>
                    <option value="">Default System Speaker</option>
                    {devices.filter((d) => d.kind === 'audiooutput').map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker ${d.deviceId.slice(0, 5)}`}</option>
                    ))}
                  </select>
                  <button
                    onClick={testSpeaker}
                    style={{ background: 'none', border: 'none', color: '#8AB4F8', fontWeight: 600, cursor: 'pointer', fontSize: '14px' }}
                  >
                    Test
                  </button>
                </div>
              </div>

              <button
                onClick={() => setCallControlOpen(!callControlOpen)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginTop: '28px', background: 'none', border: 'none', color: '#8AB4F8', fontWeight: 600, fontSize: '14px', cursor: 'pointer', padding: 0 }}
              >
                Call control
                {callControlOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
              {callControlOpen && row('Join and leave sounds', 'Play a sound when people join or leave the call', <Toggle on={joinLeaveSounds} onChange={setJoinLeaveSounds} label="Join and leave sounds" />)}
            </div>
          )}

          {tab === 'video' && (
            <div style={{ paddingRight: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', backgroundColor: isDark ? 'rgba(138,180,248,0.12)' : '#D3E3FD', borderRadius: '8px', padding: '14px 16px', marginBottom: '24px', fontSize: '14px' }}>
                <span>Video enhancement has moved</span>
                <button
                  onClick={() => { onClose(); props.onOpenBackgrounds(); }}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', color: '#8AB4F8', fontWeight: 600, cursor: 'pointer', fontSize: '14px' }}
                >
                  <Sparkles size={15} /> Backgrounds and effects
                </button>
              </div>

              {label('Camera')}
              <select value={props.videoId} onChange={(e) => props.onSelectVideo(e.target.value)} style={selectStyle}>
                <option value="">Default System Camera</option>
                {devices.filter((d) => d.kind === 'videoinput').map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0, 5)}`}</option>
                ))}
              </select>

              <div style={{ marginTop: '24px' }}>
                {label('Send resolution (maximum)')}
                <select
                  value={sendRes}
                  onChange={(e) => { const v = Number(e.target.value); setSendRes(v); props.onSendResolution(v); }}
                  style={selectStyle}
                >
                  {RESOLUTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>

              <div style={{ marginTop: '24px' }}>
                {label('Receive resolution (maximum)')}
                <select
                  value={receiveRes}
                  onChange={(e) => { const v = Number(e.target.value); setReceiveRes(v); props.onReceiveResolution(v); }}
                  style={selectStyle}
                >
                  {RESOLUTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            </div>
          )}

          {tab === 'general' && (
            <div style={{ paddingRight: '24px' }}>
              <div style={{ margin: '0 0 18px' }}>
                <div style={{ fontSize: '14px', fontWeight: 600 }}>Automatic picture-in-picture</div>
                <div style={{ fontSize: '13px', color: muted, margin: '2px 0 10px' }}>Select when you want picture-in-picture to automatically show</div>
                <select value={autoPip} onChange={(e) => setAutoPip(e.target.value as 'always' | 'never')} style={{ ...selectStyle, maxWidth: '300px' }}>
                  <option value="always">Always automatically show</option>
                  <option value="never">Never automatically show</option>
                </select>
              </div>

              {row(
                'Desktop notifications',
                'Show desktop notifications when someone is waiting to join or sends a message while this tab is in the background',
                <Toggle
                  on={desktopNotifications}
                  label="Desktop notifications"
                  onChange={async (v) => {
                    if (v && 'Notification' in window && Notification.permission !== 'granted') {
                      const permission = await Notification.requestPermission();

                      if (permission !== 'granted') {
                        return;
                      }
                    }
                    setDesktopNotifications(v);
                    if (v) {
                      notifyDesktop('Notifications on', 'You will be notified when this tab is in the background.');
                    }
                  }}
                />
              )}

              {row('Leave empty calls', 'Removes you from a call after a few minutes if no one else joins', <Toggle on={leaveEmptyCalls} onChange={setLeaveEmptyCalls} label="Leave empty calls" />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
