// Formats a byte count as a short human-readable size (e.g. "482 KB", "2.3 MB"), same convention
// as the backend's own shared 10MB attachment limit (chatUploadLimits.ts). Shared between
// ChatPanel.tsx (in-meeting chat) and ConversationsPanel.tsx (the dashboard's Conversations tab)
// so a file/image's size always reads identically in both places, not two independently
// maintained copies of the same formatting.
export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
