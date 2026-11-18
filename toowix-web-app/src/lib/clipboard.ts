// Real reported bug: "Copy joining info" (MeetingRoomPage's info panel) and "Copy message"
// (ShareMeetingModal's invite dialog) both showed a "Copied!" success state on Mac Safari even
// though nothing actually reached the clipboard. Root cause: both called bare
// `navigator.clipboard.writeText(text)` and either never checked the returned promise at all, or
// awaited it but only `console.error`d on failure with no fallback and no user-visible change.
// Safari enforces the Clipboard API far more strictly than Chrome -- it only honors a write that
// happens synchronously inside a real user-gesture call stack (no prior `await`, no `.then()`/
// `setTimeout` hop) AND requires the document to currently have focus; losing either condition
// (both common in a modal/panel flow) makes it reject with NotAllowedError instead of writing
// anything. `ChatPanel.tsx`'s own copy-to-clipboard handler already worked around this with an
// `execCommand('copy')` fallback -- this is that same pattern, factored out so every other
// copy-link/copy-message button in the app can share it instead of silently trusting
// navigator.clipboard.writeText() alone.
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);

      return true;
    }
  } catch {
    // Falls through to the execCommand fallback below -- this is exactly the Safari
    // NotAllowedError case this function exists for, not necessarily a real failure to report.
  }

  try {
    const textarea = document.createElement('textarea');

    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');

    document.body.removeChild(textarea);

    return ok;
  } catch {
    return false;
  }
}
