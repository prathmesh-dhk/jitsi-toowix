// Extracted from MeetingRoomPage.tsx (Track 3, Phase 2, item 9). Unlike ChatPanel/RecordingControls/
// DeviceMenus, the captions feature's state (captionsEnabled/captionText/captionInterim) and its
// Web Speech API effect are used ONLY by this feature -- nothing else on the page reads or writes
// them -- so the state moves here too, not just the render logic. useCaptions owns that state and
// effect; CaptionsOverlay and CaptionsToggleButton are pure render, taking what they need as props.
// The mobile "more menu" captions row stays on the page (same reasoning as the recording/mic rows
// there): it's one entry in a larger shared dropdown that isn't being split apart in this pass, but
// it now calls the toggleCaptions() this hook returns instead of a page-local setter.
import { useEffect, useRef, useState } from 'react';
import { Subtitles } from 'lucide-react';

export function useCaptions() {
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [captionText, setCaptionText] = useState('');
  const [captionInterim, setCaptionInterim] = useState('');
  const speechRecognitionRef = useRef<any>(null);

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!captionsEnabled) {
      // Stop any active recognition session
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch { }
        speechRecognitionRef.current = null;
      }
      setCaptionText('');
      setCaptionInterim('');
      return;
    }

    if (!SpeechRecognition) {
      setCaptionText('⚠️ Live captions are not supported in this browser. Please use Chrome or Edge.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript + ' ';
        } else {
          interim += transcript;
        }
      }
      if (final) {
        setCaptionText((prev) => {
          const combined = (prev + ' ' + final).trim();
          // Keep only last ~200 chars so box stays concise
          return combined.length > 200 ? combined.slice(combined.length - 200) : combined;
        });
      }
      setCaptionInterim(interim);
    };

    let restartTimer: ReturnType<typeof setTimeout> | null = null;
    let consecutiveRestartFailures = 0;

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return; // ignore silence/manual stop
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setCaptionText('⚠️ Microphone access denied. Allow mic permission to use captions.');
      } else if (event.error === 'network') {
        // Chrome's built-in recognizer sends audio to a remote speech service -- this fires
        // when that service can't be reached (offline, or a network/firewall blocking it),
        // not a bug in this page. Surfacing it beats silently showing nothing forever.
        setCaptionText('⚠️ Live captions need internet access to a speech service -- check your network/firewall.');
      } else {
        setCaptionText(`⚠️ Live captions stopped (${event.error}). Try turning captions off and on again.`);
      }
    };

    recognition.onend = () => {
      // Auto-restart so captions stay active as long as enabled. Restarting the SAME
      // recognition instance synchronously inside onend is a known race (throws
      // InvalidStateError because the browser hasn't fully torn it down yet) -- a short delay
      // avoids that. If it keeps failing, stop retrying instead of failing silently forever.
      if (!captionsEnabled || speechRecognitionRef.current !== recognition) {
        return;
      }
      restartTimer = setTimeout(() => {
        try {
          recognition.start();
          consecutiveRestartFailures = 0;
        } catch (err) {
          consecutiveRestartFailures += 1;
          if (consecutiveRestartFailures >= 3) {
            setCaptionText('⚠️ Live captions stopped unexpectedly. Turn captions off and on to retry.');
          } else {
            // eslint-disable-next-line no-console
            console.warn('[Captions] restart failed, will retry:', err);
          }
        }
      }, 300);
    };

    try {
      recognition.start();
      speechRecognitionRef.current = recognition;
    } catch { }

    return () => {
      if (restartTimer) clearTimeout(restartTimer);
      try { recognition.stop(); } catch { }
      speechRecognitionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captionsEnabled]);

  const toggleCaptions = () => setCaptionsEnabled((prev) => !prev);

  return { captionsEnabled, toggleCaptions, captionText, captionInterim };
}

export interface ICaptionsOverlayProps {
  captionsEnabled: boolean;
  captionText: string;
  captionInterim: string;
}

export function CaptionsOverlay({ captionsEnabled, captionText, captionInterim }: ICaptionsOverlayProps) {
  if (!captionsEnabled) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '108px',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: 'rgba(10, 10, 12, 0.90)',
        backdropFilter: 'blur(12px)',
        padding: '10px 24px',
        borderRadius: '14px',
        color: '#FFFFFF',
        fontSize: '15px',
        lineHeight: 1.6,
        maxWidth: '70vw',
        minWidth: '260px',
        textAlign: 'center',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
        zIndex: 300,
        pointerEvents: 'none',
        minHeight: '42px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {(captionText || captionInterim) ? (
        <span>
          <span style={{ color: '#FFFFFF', fontWeight: 400 }}>{captionText}</span>
          {captionInterim && (
            <span style={{ color: 'rgba(255,255,255,0.45)', fontStyle: 'italic' }}>
              {' '}{captionInterim}
            </span>
          )}
        </span>
      ) : (
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px' }}>
          🎤 Listening… start speaking to see live captions
        </span>
      )}
    </div>
  );
}

export interface ICaptionsToggleButtonProps {
  captionsEnabled: boolean;
  onToggle: () => void;
}

export function CaptionsToggleButton({ captionsEnabled, onToggle }: ICaptionsToggleButtonProps) {
  return (
    <button
      onClick={onToggle}
      title={captionsEnabled ? 'Turn off captions' : 'Turn on captions'}
      style={{
        width: '48px',
        height: '48px',
        borderRadius: '50%',
        backgroundColor: captionsEnabled ? '#8AB4F8' : '#3C4043',
        border: 'none',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background-color 0.15s ease',
      }}
    >
      <Subtitles size={20} color={captionsEnabled ? '#202124' : '#E8EAED'} />
    </button>
  );
}
