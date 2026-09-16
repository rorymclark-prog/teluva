/**
 * THE NAME ON THE HEADER.
 *
 * A space carries TWO names, written at different moments into different
 * stores:
 *
 *   1. `SpaceMembership.name` — what the person typed when they created the
 *      space ("the rats"). Written once, at creation, lives on the membership
 *      record, and is what the space switcher's dropdown lists.
 *   2. `HubSettings.hubName` — an optional rename, set much later in Hub
 *      settings. EMPTY for every space nobody has bothered to rename, which is
 *      most of them, including every space on its first day.
 *
 * The header only ever read (2), and fell straight through to the literal
 * string "Family Hub" when it was empty. So a family that had already named
 * itself at sign-up saw a generic label on every single screen, while its real
 * name sat one click away inside a closed dropdown — the app looked like it had
 * not been told who it belonged to, moments after being told.
 *
 * The creation name is a real answer to "whose space is this?", so it belongs
 * between the deliberate rename and the generic fallback. The generic label is
 * now only reached when a space genuinely has no name at all.
 */
export function hubDisplayName(
  settingsHubName: string | undefined | null,
  spaceName: string | undefined | null,
  isBusinessSpace: boolean,
): string {
  const renamed = (settingsHubName || '').trim();
  if (renamed) return renamed;
  const created = (spaceName || '').trim();
  if (created) return created;
  return isBusinessSpace ? 'Business Hub' : 'Family Hub';
}
