import { useEffect, useRef, useState } from 'react';

function getMediaErrorMessage(kind: 'Microphone' | 'Camera', error: unknown): string {
  if (!(error instanceof Error)) {
    return `${kind} is unavailable.`;
  }
  switch (error.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return kind === 'Microphone'
        ? 'Microphone permission denied. Please allow microphone access in your browser settings.'
        : 'Camera permission denied. You can join with audio only.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return kind === 'Microphone'
        ? 'No microphone found. Please connect a microphone.'
        : 'No camera found. You can join with audio only.';
    case 'NotReadableError':
    case 'TrackStartError':
      return kind === 'Microphone'
        ? 'Microphone is currently in use by another application or unavailable.'
        : 'Camera is currently in use by another application. You can join with audio only.';
    case 'OverconstrainedError':
      return `${kind} configuration could not be satisfied. Using system default.`;
    default:
      return `${kind} error (${error.name || 'Unavailable'}).`;
  }
}

export function useMediaPreview(
  joined: boolean,
  mic: boolean,
  video: boolean,
  audioId: string,
  videoId: string
) {
  const stream = useRef<MediaStream | null>(null);
  const preview = useRef<HTMLVideoElement | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micError, setMicError] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [level, setLevel] = useState(0);

  const audioTrackRef = useRef<MediaStreamTrack | null>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number>(0);
  const lastLevelUpdateRef = useRef<number>(0);

  // 1. Device enumeration
  useEffect(() => {
    let active = true;
    const enumerate = async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        if (active) setDevices(list);
      } catch {}
    };
    void enumerate();
    navigator.mediaDevices?.addEventListener('devicechange', enumerate);
    return () => {
      active = false;
      navigator.mediaDevices?.removeEventListener('devicechange', enumerate);
    };
  }, []);

  // Helper to re-attach tracks to combined stream & preview
  const updateCombinedStream = () => {
    if (joined) return;
    if (!stream.current) {
      stream.current = new MediaStream();
    }
    const combined = stream.current;
    // Remove old tracks
    combined.getTracks().forEach((t) => {
      if (t !== audioTrackRef.current && t !== videoTrackRef.current) {
        combined.removeTrack(t);
      }
    });
    // Add current tracks if not already present
    if (audioTrackRef.current && !combined.getTracks().includes(audioTrackRef.current)) {
      combined.addTrack(audioTrackRef.current);
    }
    if (videoTrackRef.current && !combined.getTracks().includes(videoTrackRef.current)) {
      combined.addTrack(videoTrackRef.current);
    }
    if (preview.current && preview.current.srcObject !== combined) {
      preview.current.srcObject = combined;
    }
  };

  // 2. Microphone Capture & Level Meter (Isolated Lifecycle)
  useEffect(() => {
    if (joined) {
      if (audioTrackRef.current) {
        audioTrackRef.current.stop();
        audioTrackRef.current = null;
      }
      if (audioContextRef.current) {
        void audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      cancelAnimationFrame(animFrameRef.current);
      setLevel(0);
      return;
    }

    let active = true;

    const startAudio = async () => {
      try {
        let media: MediaStream;
        const constraints: MediaTrackConstraints = audioId
          ? { deviceId: { ideal: audioId } }
          : {};

        try {
          media = await navigator.mediaDevices.getUserMedia({ audio: Object.keys(constraints).length ? constraints : true });
        } catch (err: any) {
          // If ideal device failed, fallback to any default audio
          if (audioId && err?.name === 'OverconstrainedError') {
            media = await navigator.mediaDevices.getUserMedia({ audio: true });
          } else {
            throw err;
          }
        }

        if (!active) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }

        const newTrack = media.getAudioTracks()[0];
        if (!newTrack) throw new Error('No audio track returned');

        // Stop previous audio track
        if (audioTrackRef.current) {
          audioTrackRef.current.stop();
        }
        audioTrackRef.current = newTrack;
        newTrack.enabled = mic;
        setMicError('');

        updateCombinedStream();

        // Close previous audio context
        if (audioContextRef.current) {
          void audioContextRef.current.close().catch(() => {});
          audioContextRef.current = null;
        }

        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.4;

        const source = ctx.createMediaStreamSource(media);
        source.connect(analyser); // Never connect to ctx.destination to prevent feedback!

        const values = new Uint8Array(analyser.frequencyBinCount);

        const tick = (now: number) => {
          if (!active || !audioContextRef.current) return;
          // Throttle state update to at most ~20fps (every 50ms) to eliminate React re-render thrashing
          if (now - lastLevelUpdateRef.current > 50) {
            lastLevelUpdateRef.current = now;
            if (!newTrack.enabled) {
              setLevel(0);
            } else {
              analyser.getByteFrequencyData(values);
              let sum = 0;
              for (let i = 0; i < values.length; i++) {
                sum += values[i];
              }
              const avg = sum / values.length;
              const calculated = Math.min(1, Math.max(0, avg / 80));
              setLevel(calculated);
            }
          }
          animFrameRef.current = requestAnimationFrame(tick);
        };

        void ctx.resume().catch(() => {});
        animFrameRef.current = requestAnimationFrame(tick);

        // Update devices list after permission grant
        try {
          const list = await navigator.mediaDevices.enumerateDevices();
          if (active) setDevices(list);
        } catch {}
      } catch (err) {
        if (!active) return;
        setMicError(getMediaErrorMessage('Microphone', err));
        setLevel(0);
      }
    };

    void startAudio();

    return () => {
      active = false;
      cancelAnimationFrame(animFrameRef.current);
      if (audioContextRef.current) {
        void audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      if (audioTrackRef.current) {
        audioTrackRef.current.stop();
        audioTrackRef.current = null;
      }
      setLevel(0);
    };
  }, [joined, audioId]);

  // 3. Camera Capture (Isolated Lifecycle - Failure will NOT block Mic)
  useEffect(() => {
    if (joined) {
      if (videoTrackRef.current) {
        videoTrackRef.current.stop();
        videoTrackRef.current = null;
      }
      return;
    }

    let active = true;

    const startVideo = async () => {
      try {
        let media: MediaStream;
        const constraints: MediaTrackConstraints = videoId
          ? { deviceId: { ideal: videoId } }
          : {};

        try {
          media = await navigator.mediaDevices.getUserMedia({
            video: Object.keys(constraints).length ? { ...constraints, width: { ideal: 1280 }, height: { ideal: 720 } } : true,
          });
        } catch (err: any) {
          // If ideal device failed, fallback to default video
          if (videoId && err?.name === 'OverconstrainedError') {
            media = await navigator.mediaDevices.getUserMedia({ video: true });
          } else {
            throw err;
          }
        }

        if (!active) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }

        const newTrack = media.getVideoTracks()[0];
        if (!newTrack) throw new Error('No video track returned');

        // Stop previous video track
        if (videoTrackRef.current) {
          videoTrackRef.current.stop();
        }
        videoTrackRef.current = newTrack;
        newTrack.enabled = video;
        setCameraError('');

        updateCombinedStream();

        try {
          const list = await navigator.mediaDevices.enumerateDevices();
          if (active) setDevices(list);
        } catch {}
      } catch (err) {
        if (!active) return;
        setCameraError(getMediaErrorMessage('Camera', err));
      }
    };

    void startVideo();

    return () => {
      active = false;
      if (videoTrackRef.current) {
        videoTrackRef.current.stop();
        videoTrackRef.current = null;
      }
    };
  }, [joined, videoId]);

  // 4. Mute / Unmute Sync for existing tracks without recreating media
  useEffect(() => {
    if (audioTrackRef.current) {
      audioTrackRef.current.enabled = mic;
      if (!mic) setLevel(0);
    }
  }, [mic]);

  useEffect(() => {
    if (videoTrackRef.current) {
      videoTrackRef.current.enabled = video;
    }
  }, [video]);

  // Full cleanup on unmount or when joining
  useEffect(() => {
    if (joined) {
      if (audioTrackRef.current) {
        audioTrackRef.current.stop();
        audioTrackRef.current = null;
      }
      if (videoTrackRef.current) {
        videoTrackRef.current.stop();
        videoTrackRef.current = null;
      }
      if (stream.current) {
        stream.current.getTracks().forEach((t) => t.stop());
        stream.current = null;
      }
      if (audioContextRef.current) {
        void audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      cancelAnimationFrame(animFrameRef.current);
      if (preview.current) {
        preview.current.srcObject = null;
      }
      setLevel(0);
    }
  }, [joined]);

  return { stream, preview, devices, micError, cameraError, level };
}
