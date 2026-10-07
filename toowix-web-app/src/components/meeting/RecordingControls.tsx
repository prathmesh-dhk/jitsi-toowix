// Extracted from MeetingRoomPage.tsx (Track 3, Phase 2, item 7). Three independent render sites
// for recording state, each kept as its own small component rather than one combined component,
// since they mount in unrelated parts of the page (a fixed-position toast, a top-bar pill badge,
// and an Activities-panel row) and share nothing but the `recording` boolean itself. The page still
// owns all the state (`recording`, `recordingStartedAt`, `recordingToast`) and the toggle handler --
// these are purely presentational.
//
// The bottom "floating toast" (Raise Hand / Recording / Participant join-leave / etc., further down
// in MeetingRoomPage.tsx) and the mobile "more menu" recording row are NOT part of this extraction:
// the former is a shared multi-feature toast dispatcher, not recording-specific, and the latter is one
// row embedded in a larger shared dropdown menu that isn't being split up in this pass.
import { memo, useEffect, useState } from 'react';
import { Check, Radio } from 'lucide-react';
import { formatDuration } from '../../lib/formatDuration';

// Ticks on its own so a running clock never re-renders the whole meeting page.
const ElapsedClock = memo(function ElapsedClock({ startedAt }: { startedAt: number | null }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (startedAt == null) return;
    const timer = window.setInterval(() => setTick((t) => t + 1), 1000);

    return () => window.clearInterval(timer);
  }, [startedAt]);

  return <>{formatDuration(startedAt == null ? 0 : Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))}</>;
});

export interface IRecordingToastProps {
  recording: boolean;
  recordingToast: string | null;
}

export function RecordingToast({ recording, recordingToast }: IRecordingToastProps) {
  if (!recordingToast) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: '56px',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: '#202124',
        border: recording ? '1px solid #EA4335' : '1px solid #34A853',
        borderRadius: '24px',
        padding: '8px 18px',
        color: '#FFFFFF',
        fontSize: '13px',
        fontWeight: 500,
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
        zIndex: 400,
        pointerEvents: 'none',
        animation: 'slideInRight 0.2s ease',
      }}
    >
      {recording ? (
        <div
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: '#EA4335',
            animation: 'pulse 1.2s infinite',
          }}
        />
      ) : (
        <Check size={16} color="#34A853" />
      )}
      <span>{recordingToast}</span>
    </div>
  );
}

export interface IRecordingPillBadgeProps {
  recording: boolean;
  recordingStartedAt: number | null;
}

export function RecordingPillBadge({ recording, recordingStartedAt }: IRecordingPillBadgeProps) {
  if (!recording) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        backgroundColor: 'rgba(234, 67, 53, 0.15)',
        border: '1px solid rgba(234, 67, 53, 0.4)',
        padding: '3px 8px',
        borderRadius: '12px',
      }}
    >
      <div
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: '#EA4335',
          animation: 'pulse 1.5s infinite',
        }}
      />
      <span style={{ fontSize: '11px', fontWeight: 600, color: '#EA4335', letterSpacing: '0.4px' }}>
        REC <ElapsedClock startedAt={recordingStartedAt} /> • Recording: on
      </span>
    </div>
  );
}

export interface IRecordingActivitiesPanelEntryProps {
  isModerator: boolean;
  recording: boolean;
  recordingStartedAt: number | null;
  onToggle: () => void;
}

export function RecordingActivitiesPanelEntry({
  isModerator, recording, recordingStartedAt, onToggle,
}: IRecordingActivitiesPanelEntryProps) {
  // Recording control is host/moderator-only. Non-moderators still see the red "recording in
  // progress" pill badge and dot elsewhere in the UI -- this is just the start/stop control itself.
  if (!isModerator) return null;

  return (
    <div
      onClick={onToggle}
      style={{
        padding: '14px',
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderRadius: '14px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        border: recording ? '1px solid #EA4335' : '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <Radio size={20} color={recording ? '#EA4335' : '#E8EAED'} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#E8EAED' }}>
          {recording ? 'Recording in progress' : 'Record meeting'}
        </div>
        <div style={{ fontSize: '12px', color: '#9AA0A6' }}>
          {recording ? <>Recording: <ElapsedClock startedAt={recordingStartedAt} /></> : 'Save session to your workspace cloud'}
        </div>
      </div>
    </div>
  );
}
