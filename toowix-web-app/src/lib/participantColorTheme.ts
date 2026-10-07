// Extracted alongside the PictureInPicture.tsx split (Track 3, Phase 2, item 2): DocumentPipContent
// needs this same per-participant color assignment MeetingRoomPage.tsx already used everywhere
// else, and importing it back from the page would have created a circular dependency between the
// page and the new component. Moved verbatim; no behavior change.
export interface IParticipantColorTheme {
  name: string;
  avatarBg: string;
  tileBg: string;
  badgeBg: string;
  ringColor: string;
}

export const PARTICIPANT_COLOR_THEMES: IParticipantColorTheme[] = [
  { name: 'deep-blue', avatarBg: '#2962C5', tileBg: '#101D35', badgeBg: 'rgba(10,20,38,.9)', ringColor: '#74A7FF' },
  { name: 'teal', avatarBg: '#087E72', tileBg: '#102D2B', badgeBg: 'rgba(8,35,33,.9)', ringColor: '#57C8BA' },
  { name: 'forest', avatarBg: '#367B48', tileBg: '#142B1A', badgeBg: 'rgba(14,33,19,.9)', ringColor: '#86CC91' },
  { name: 'olive', avatarBg: '#77861F', tileBg: '#2E3313', badgeBg: 'rgba(34,37,11,.9)', ringColor: '#B9C85A' },
  { name: 'mustard', avatarBg: '#B17B16', tileBg: '#36270F', badgeBg: 'rgba(42,30,9,.9)', ringColor: '#E4B851' },
  { name: 'terracotta', avatarBg: '#B75C3A', tileBg: '#382019', badgeBg: 'rgba(43,22,16,.9)', ringColor: '#E99A79' },
  { name: 'burgundy', avatarBg: '#8E2948', tileBg: '#32141E', badgeBg: 'rgba(41,13,22,.9)', ringColor: '#D97898' },
  { name: 'purple', avatarBg: '#703AAB', tileBg: '#271737', badgeBg: 'rgba(28,14,42,.9)', ringColor: '#B98BE8' },
  { name: 'indigo', avatarBg: '#4255A5', tileBg: '#171B38', badgeBg: 'rgba(16,19,43,.9)', ringColor: '#91A2EC' },
  { name: 'rose', avatarBg: '#B84572', tileBg: '#371827', badgeBg: 'rgba(43,13,27,.9)', ringColor: '#EC91B2' },
  { name: 'charcoal', avatarBg: '#51606A', tileBg: '#1D2328', badgeBg: 'rgba(20,25,29,.9)', ringColor: '#A9BBC7' },
  { name: 'ocean', avatarBg: '#176C95', tileBg: '#112938', badgeBg: 'rgba(10,29,40,.9)', ringColor: '#71B9DB' },
  { name: 'plum', avatarBg: '#8B417D', tileBg: '#30192F', badgeBg: 'rgba(38,14,35,.9)', ringColor: '#D58AC6' },
  { name: 'copper', avatarBg: '#9D6432', tileBg: '#332316', badgeBg: 'rgba(39,25,13,.9)', ringColor: '#D9A76F' },
  { name: 'slate', avatarBg: '#4B6173', tileBg: '#19232C', badgeBg: 'rgba(18,27,34,.9)', ringColor: '#9AB5C8' },
];

export function getParticipantColorTheme(identifier: string, _forceIndex?: number): IParticipantColorTheme {
  let hash = 0;
  const str = (identifier || '').trim().toLowerCase();

  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }

  return PARTICIPANT_COLOR_THEMES[Math.abs(hash) % PARTICIPANT_COLOR_THEMES.length];
}
