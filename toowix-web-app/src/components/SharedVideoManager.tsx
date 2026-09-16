import React, { useEffect, useRef } from 'react';
import YouTube from 'react-youtube';

import { ISharedVideoState } from '../lib/useJitsiMeeting';
import { PLAYBACK_STATUSES } from '../lib/sharedVideo/constants';

export interface ISharedVideoManagerProps {
  sharedVideo: ISharedVideoState;
  localParticipantId: string | null;
  isLocalAudioMuted: boolean;
  onMuteLocalAudio: () => void;
  onStatusUpdate: (status: string, time: number, muted?: boolean) => void;
  onError: () => void;
}

// Ported from jitsi-meet's react/features/shared-video AbstractVideoManager + YoutubeVideoManager
// (combined into one component, and converted from class components to hooks -- this codebase
// doesn't use Jitsi's Redux/class-component architecture, everything else is a faithful port:
// the >5s seek-drift threshold, the owner/follower convergence logic, and the "smart mute" that
// mutes your own mic when the shared video's own audio is audible).

// "Return true if the difference between the two times is larger than 5" -- ported verbatim.
function shouldSeekToPosition(newTime: number, previousTime: number): boolean {
  return Math.abs(newTime - previousTime) > 5;
}

export function SharedVideoManager({
  sharedVideo, localParticipantId, isLocalAudioMuted, onMuteLocalAudio, onStatusUpdate, onError
}: ISharedVideoManagerProps) {
  const playerRef = useRef<any>(null);
  const isOwner = sharedVideo.ownerId === localParticipantId;
  const lastFiredAtRef = useRef(0);

  // Ported from AbstractVideoManager.fireUpdateSharedVideoEvent, throttled to once/5s exactly
  // like upstream (`throttle(this.fireUpdateSharedVideoEvent.bind(this), 5000)`), used for the
  // periodic "still playing" heartbeat (onVideoProgress) so followers' drift-correction has
  // something recent to compare against.
  const fireUpdateSharedVideoEvent = (throttled: boolean) => {
    const player = playerRef.current;

    if (!isOwner || !player) {
      return;
    }
    const now = Date.now();

    if (throttled && now - lastFiredAtRef.current < 5000) {
      return;
    }
    lastFiredAtRef.current = now;

    const playerState = player.getPlayerState();
    let status: string | undefined;

    if (playerState === YouTube.PlayerState.PLAYING) {
      status = PLAYBACK_STATUSES.PLAYING;
    } else if (playerState === YouTube.PlayerState.PAUSED) {
      status = PLAYBACK_STATUSES.PAUSED;
    }
    if (!status) {
      return;
    }
    onStatusUpdate(status, player.getCurrentTime(), player.isMuted());
  };

  // Ported from AbstractVideoManager.smartAudioMute: if the shared video is audible and our own
  // mic isn't already muted, mute it to avoid echo/feedback for everyone else in the room.
  const smartAudioMute = () => {
    const player = playerRef.current;

    if (!player || isLocalAudioMuted) {
      return;
    }
    const volumeOn = player.getPlayerState() === YouTube.PlayerState.PLAYING
      && !player.isMuted() && Number(player.getVolume()) > 0;

    if (volumeOn) {
      onMuteLocalAudio();
    }
  };

  const handleReady = (event: any) => {
    const player = event.target;

    playerRef.current = player;
    player.addEventListener('onVolumeChange', () => fireUpdateSharedVideoEvent(true));

    player.playVideo();
    // YouTube can retain muted state from a previously played video in this browser tab; we
    // disable native controls, so explicitly unmute rather than leaving it silently muted.
    if (player.isMuted()) {
      player.unMute();
    }
  };

  const handleStateChange = (event: any) => {
    if (event.data === YouTube.PlayerState.PLAYING) {
      if (isOwner) {
        smartAudioMute();
        fireUpdateSharedVideoEvent(false);
      }
    } else if (event.data === YouTube.PlayerState.PAUSED) {
      if (isOwner) {
        fireUpdateSharedVideoEvent(false);
      }
    }
  };

  // Ported from AbstractVideoManager.processUpdatedProps: a non-owner's player converges to the
  // shared status/time/mute state on every update; the owner's own player is authoritative and is
  // never driven by received state (upstream: "if (_isOwner) { return; }").
  useEffect(() => {
    if (isOwner) {
      return;
    }
    const player = playerRef.current;

    if (!player) {
      return;
    }

    if (shouldSeekToPosition(Number(sharedVideo.time), Number(player.getCurrentTime()))) {
      player.seekTo(sharedVideo.time, true);
    }

    const currentStatus = player.getPlayerState() === YouTube.PlayerState.PLAYING
      ? PLAYBACK_STATUSES.PLAYING
      : player.getPlayerState() === YouTube.PlayerState.PAUSED ? PLAYBACK_STATUSES.PAUSED : undefined;

    if (currentStatus !== sharedVideo.status) {
      if (sharedVideo.status === PLAYBACK_STATUSES.PLAYING) {
        player.playVideo();
      } else if (sharedVideo.status === PLAYBACK_STATUSES.PAUSED) {
        player.pauseVideo();
      }
    }

    if (player.isMuted() !== sharedVideo.muted) {
      if (sharedVideo.muted) {
        player.mute();
      } else {
        player.unMute();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ sharedVideo.status, sharedVideo.time, sharedVideo.muted, isOwner ]);

  useEffect(() => () => {
    playerRef.current?.destroy?.();
    playerRef.current = null;
  }, []);

  return (
    <>
      <style>{'.shared-video-iframe { width: 100% !important; height: 100% !important; display: block; }'}</style>
      <YouTube
        videoId={sharedVideo.videoUrl}
        // react-youtube's `opts.height`/`opts.width` only set the iframe's own HTML attributes --
        // the wrapping container div react-youtube renders has no size of its own unless `style`
        // (container) and `iframeClassName` (iframe, via the stylesheet above) are both given an
        // explicit 100%/100%, or the whole thing collapses to the iframe's intrinsic default size.
        style={{ width: '100%', height: '100%' }}
        iframeClassName="shared-video-iframe"
        opts={{
          height: '100%',
          width: '100%',
          playerVars: {
            origin: window.location.origin,
            fs: 0,
            autoplay: 0,
            controls: isOwner ? 1 : 0,
            rel: 0
          }
        }}
        onReady={handleReady}
        onStateChange={handleStateChange}
        onError={onError}
      />
    </>
  );
}

export default SharedVideoManager;
