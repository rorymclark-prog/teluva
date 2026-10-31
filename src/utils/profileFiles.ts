export const PROFILE_FILE_LIMIT_BYTES = 20 * 1024 * 1024;
export const PROFILE_FILE_LIMIT_LABEL = '20 MB';

type StoredFile = { storagePath: string; downloadUrl: string };

export function captureProfileFileScope(identity: () => readonly unknown[]): () => boolean {
  const captured = identity();
  return () => {
    const current = identity();
    return current.length === captured.length && current.every((value, index) => value === captured[index]);
  };
}

/** File the new reference successfully before retiring any previous evidence. */
export async function fileProfileAttachment(options: {
  store: () => Promise<StoredFile>;
  save: (stored: StoredFile) => Promise<boolean | void>;
  retirePrevious?: () => Promise<void>;
  isCurrent: () => boolean;
}): Promise<void> {
  const check = () => { if (!options.isCurrent()) throw new Error('This profile or account changed. Reopen the profile and try again.'); };
  check();
  const stored = await options.store();
  check();
  const saved = await options.save(stored);
  check();
  if (saved === false) throw new Error('The new file is saved on this device, but cloud sync is pending. The previous file has been kept.');
  if (options.retirePrevious) { await options.retirePrevious(); check(); }
}

/** Real profiles store references; only the unsaved demo keeps inline bytes. */
export async function persistProfileFile(options: {
  size: number;
  demo: boolean;
  readDataUrl: () => Promise<string>;
  upload: () => Promise<StoredFile>;
}): Promise<StoredFile> {
  if (options.size >= PROFILE_FILE_LIMIT_BYTES) throw new Error(`Choose a file smaller than ${PROFILE_FILE_LIMIT_LABEL}.`);
  if (options.demo) return { storagePath: '', downloadUrl: await options.readDataUrl() };
  return options.upload();
}

export function readFileDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}
