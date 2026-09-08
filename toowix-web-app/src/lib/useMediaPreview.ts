import { useEffect, useRef, useState } from 'react';
export function useMediaPreview(joined: boolean, mic: boolean, video: boolean, audioId: string, videoId: string) {
  const stream = useRef<MediaStream | null>(null);
  const preview = useRef<HTMLVideoElement | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micError, setMicError] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [level, setLevel] = useState(0);
  useEffect(() => {
    let active = true;
    const enumerate = async () => { try { const list = await navigator.mediaDevices.enumerateDevices(); if (active) setDevices(list); } catch {} };
    void enumerate();
    navigator.mediaDevices?.addEventListener('devicechange', enumerate);
    return () => { active = false; navigator.mediaDevices?.removeEventListener('devicechange', enumerate); };
  }, []);
  useEffect(() => {
    if (joined) return;
    let active = true;
    let context: AudioContext | undefined;
    let frame = 0;
    const combined = new MediaStream();
    stream.current = combined;
    const capture = async (kind: 'audio' | 'video', id: string) => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({ [kind]: id ? { deviceId: { exact: id } } : true });
        if (!active) { media.getTracks().forEach(t => t.stop()); return; }
        media.getTracks().forEach(t => { t.enabled = kind === 'audio' ? mic : video; combined.addTrack(t); });
        if (preview.current) preview.current.srcObject = combined;
        if (kind === 'audio') {
          setMicError('');
          context = new AudioContext();
          const analyser = context.createAnalyser(); analyser.fftSize = 256;
          context.createMediaStreamSource(media).connect(analyser);
          const values = new Uint8Array(analyser.fftSize);
          const tick = () => { analyser.getByteTimeDomainData(values); setLevel(Math.min(1, Math.sqrt(values.reduce((sum, v) => sum + ((v - 128) / 128) ** 2, 0) / values.length) * 4)); frame = requestAnimationFrame(tick); };
          void context.resume(); tick();
        } else setCameraError('');
        const list = await navigator.mediaDevices.enumerateDevices(); if (active) setDevices(list);
      } catch (error) {
        if (!active) return;
        const name = error instanceof Error ? error.name : 'Unavailable';
        if (kind === 'audio') setMicError(`Microphone: ${name}. Check browser permission and selected input.`);
        else setCameraError(`Camera: ${name}. You can join with audio only.`);
      }
    };
    void Promise.allSettled([capture('audio', audioId), capture('video', videoId)]);
    return () => { active = false; cancelAnimationFrame(frame); void context?.close(); combined.getTracks().forEach(t => t.stop()); if (stream.current === combined) stream.current = null; };
  }, [joined, audioId, videoId]);
  useEffect(() => { stream.current?.getAudioTracks().forEach(t => { t.enabled = mic; }); stream.current?.getVideoTracks().forEach(t => { t.enabled = video; }); }, [mic, video]);
  return { stream, preview, devices, micError, cameraError, level };
}
