/**
 * Shared UI copy constants.
 *
 * `CLEAR_ALL_LABEL` exists so the sidebar "recent chats" header button, the
 * settings → data section button, and the confirm-dialog title all render one
 * identical label for the same destructive action — before this module, three
 * hard-coded variants (「清空全部」/「清空全部对话」/「清空全部历史对话」)
 * drifted apart and read like three different features. Keep it a plain string
 * so every consumer (including aria-label/title) stays in sync.
 */
export const CLEAR_ALL_LABEL = '清空全部对话';
