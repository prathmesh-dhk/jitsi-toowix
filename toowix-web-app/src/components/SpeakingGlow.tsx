import type { RefObject } from 'react';
import { useAudioLevel } from '../lib/speakingStore';
import { useSpeakingGlowLevel, useSpeakingGlowSize } from '../lib/speakingGlow';

interface IProps {
  participantId: string;
  hostRef: RefObject<HTMLElement | null>;
}

// Subscribes to this participant's live mic level and writes it straight to the card's own DOM
// node (hostRef) as CSS custom properties -- never through a prop/render -- so the ~10x/second
// level ticks re-render only this tiny invisible component, not the whole (video + buttons)
// MeetingParticipantCard. Visibility of the glow is still owned by the card itself (its own
// isActivelySpeaking/useSpeaking read, gated by speakingStore's onset/hold hysteresis); this only
// ever adjusts the glow's intensity once it's already showing.
export function SpeakingGlow({ participantId, hostRef }: IProps) {
  const level = useAudioLevel(participantId);

  useSpeakingGlowLevel(hostRef, level);
  useSpeakingGlowSize(hostRef);

  return null;
}
