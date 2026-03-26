/**
 * Constants shared between the live preview overlay (ChatOverlay) and the
 * offline encoder (exportWorker). Keep these in sync — if you change a value
 * here both rendering paths update automatically.
 */

/** How long (ms) a floating emoji reaction stays visible before fading out. */
export const REACTION_LIFETIME = 3000;

/**
 * Deterministic horizontal position for a reaction, so the same event always
 * lands at the same x-coordinate in both the preview and the exported video.
 *
 * @param {string} id - The unique reaction id.
 * @returns {number} Position as a percentage of the container width (5–75).
 */
export function reactionLeft(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return 5 + (Math.abs(h) % 70); // 5 – 75 %
}
