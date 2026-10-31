/** Guard the optimistic state update as well as persistence. `canEdit` reads
 * the current capability so a callback captured before a downgrade is inert. */
export async function persistReferenceEdit<T>(next: T, {
  canEdit, demo, apply, save, onCloudResult,
}: {
  canEdit: () => boolean;
  demo: boolean;
  apply: (value: T) => void;
  save: (value: T) => Promise<boolean>;
  onCloudResult: (saved: boolean) => void;
}): Promise<boolean> {
  if (!canEdit()) return false;
  apply(next);
  // A preview can demonstrate editing without touching a real account/cache.
  if (demo) return true;
  const saved = await save(next);
  if (canEdit()) onCloudResult(saved);
  return saved;
}
