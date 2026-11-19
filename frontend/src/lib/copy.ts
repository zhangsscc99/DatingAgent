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

/**
 * P378 — the sidebar clear-all button's tooltip names where the cleared
 * conversations actually go (the 回收站, same as a single delete), instead
 * of repeating the label. Still derived from the one constant, so the
 * wording can never fork into a second phrasing.
 */
export const CLEAR_ALL_TRASH_TITLE = `${CLEAR_ALL_LABEL}（移到回收站）`;
