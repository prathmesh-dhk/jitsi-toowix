// A plain, tiny constant deliberately kept OUT of PictureInPicture.tsx (which is lazy-loaded --
// only ever rendered once Document Picture-in-Picture is actually opened) and out of
// MeetingRoomPage.tsx's own body. Both the real-DOM documentPictureInPicture path
// (PipMultiParticipantPages in PictureInPicture.tsx) and the canvas/video fallback path used when
// that API isn't available (drawPipFrame in MeetingRoomPage.tsx, Safari/iOS) need to page their
// participant list identically -- importing this one-line module statically from both places
// keeps that page size in sync without either side pulling in the other's bundle.
export const PIP_PAGE_SIZE = 4;
