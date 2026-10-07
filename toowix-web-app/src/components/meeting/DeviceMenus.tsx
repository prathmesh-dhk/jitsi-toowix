// Extracted from MeetingRoomPage.tsx (Track 3, Phase 2, item 8). Covers only the toolbar's own
// mic/camera buttons and their device-picker dropdowns. Device SWITCHING itself (handleSelectAudioDevice
// / handleSelectVideoDevice / applyJitsiDevice -> jitsiMeeting.switchDevice) stays on the page, since
// those same handlers are also wired into MeetingSettingsDialog and MeetingReadyDialog -- moving them
// here would make this component responsible for state two other components depend on. Likewise the
// periodic mic-health-check/auto-recovery logic (checkMicHealth/recoverMic) is untouched and still
// lives in useJitsiMeeting.ts; this file only renders the manual device-picker UI, nothing that
// observes or repairs device health on its own.
import { ChevronUp, MicOff, Video, VideoOff } from 'lucide-react';
import { MicLevelIcon } from '../MicLevelIcon';

export interface IMicDeviceButtonProps {
  inCallMuted: boolean | null;
  onToggleMic: () => void;
  showAudioMenu: boolean;
  onOpenAudioMenu: () => void;
  audioDevices: MediaDeviceInfo[];
  audioId: string;
  onSelectAudioDevice: (deviceId: string) => void;
}

export function MicDeviceButton({
  inCallMuted, onToggleMic, showAudioMenu, onOpenAudioMenu, audioDevices, audioId, onSelectAudioDevice,
}: IMicDeviceButtonProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
      <button
        onClick={onOpenAudioMenu}
        title="Select microphone"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#E8EAED',
          cursor: 'pointer',
          padding: '4px 2px',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <ChevronUp size={16} />
      </button>
      <button
        onClick={onToggleMic}
        title={inCallMuted ? 'Turn on microphone (M)' : 'Turn off microphone (M)'}
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          backgroundColor: inCallMuted ? '#3C4043' : '#3C4043',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          transition: 'background-color 0.15s ease',
        }}
      >
        {inCallMuted ? <MicOff size={20} color="#EA4335" /> : <MicLevelIcon size={22} color="#E8EAED" />}
      </button>

      {/* Audio Device Dropdown Menu */}
      {showAudioMenu && (
        <div
          style={{
            position: 'absolute',
            bottom: '56px',
            left: 0,
            backgroundColor: '#2D2E30',
            borderRadius: '16px',
            padding: '8px',
            minWidth: '220px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.1)',
            zIndex: 150,
          }}
        >
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#9AA0A6', padding: '6px 10px', textTransform: 'uppercase' }}>
            Microphone
          </div>
          {audioDevices.filter((d) => d.kind === 'audioinput').map((d) => (
            <button
              key={d.deviceId}
              onClick={() => onSelectAudioDevice(d.deviceId)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '8px 10px',
                background: audioId === d.deviceId ? 'rgba(255,255,255,0.08)' : 'transparent',
                color: '#E8EAED',
                border: 'none',
                borderRadius: '8px',
                fontSize: '13px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {d.label || `Microphone (${d.deviceId.slice(0, 5)})`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface ICameraDeviceButtonProps {
  inCallVideo: boolean;
  onToggleVideo: () => void;
  showVideoMenu: boolean;
  onOpenVideoMenu: () => void;
  videoDevices: MediaDeviceInfo[];
  videoId: string;
  onSelectVideoDevice: (deviceId: string) => void;
}

export function CameraDeviceButton({
  inCallVideo, onToggleVideo, showVideoMenu, onOpenVideoMenu, videoDevices, videoId, onSelectVideoDevice,
}: ICameraDeviceButtonProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
      <button
        onClick={onOpenVideoMenu}
        title="Select camera"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#E8EAED',
          cursor: 'pointer',
          padding: '4px 2px',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <ChevronUp size={16} />
      </button>
      <button
        onClick={onToggleVideo}
        title={inCallVideo ? 'Turn off camera (V)' : 'Turn on camera (V)'}
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          backgroundColor: '#3C4043',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          transition: 'background-color 0.15s ease',
        }}
      >
        {inCallVideo ? <Video size={20} color="#E8EAED" /> : <VideoOff size={20} color="#EA4335" />}
        {!inCallVideo && (
          <div
            style={{
              position: 'absolute',
              top: '2px',
              right: '2px',
              width: '14px',
              height: '14px',
              borderRadius: '50%',
              backgroundColor: '#FBBC04',
              color: '#202124',
              fontSize: '10px',
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            !
          </div>
        )}
      </button>

      {/* Video Device Dropdown Menu */}
      {showVideoMenu && (
        <div
          style={{
            position: 'absolute',
            bottom: '56px',
            left: 0,
            backgroundColor: '#2D2E30',
            borderRadius: '16px',
            padding: '8px',
            minWidth: '220px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.1)',
            zIndex: 150,
          }}
        >
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#9AA0A6', padding: '6px 10px', textTransform: 'uppercase' }}>
            Camera
          </div>
          {videoDevices.filter((d) => d.kind === 'videoinput').map((d) => (
            <button
              key={d.deviceId}
              onClick={() => onSelectVideoDevice(d.deviceId)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '8px 10px',
                background: videoId === d.deviceId ? 'rgba(255,255,255,0.08)' : 'transparent',
                color: '#E8EAED',
                border: 'none',
                borderRadius: '8px',
                fontSize: '13px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {d.label || `Camera (${d.deviceId.slice(0, 5)})`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
