import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import { Package, Camera, Loader2, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { AssetItem } from '../types';
import { loadAssets, saveAsset, uploadAssetPhoto } from '../utils/db';
import { compressImageToAvatar } from '../utils/imageCompress';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { itemImages } from '../utils/assetConstants';
import AssetDetailModal from './AssetDetailModal';

const EXTRA_PHOTO_CAP = 12; // extras live in Storage, so the cap is generous

// Case-insensitive match, WITHOUT loose substring containment (which would
// cross-attribute e.g. "Ann" → "Joanna"). Matches on: exact full name, OR when
// one side is a bare first name equal to the other's first name (so "Mia"
// matches "Mia Clark", and "Rory Michael Clark" matches "Rory"). Two different
// full names that merely share a first name do NOT match.
function isAssignedTo(assignedMember: string | undefined, memberName: string): boolean {
  if (!assignedMember || !assignedMember.trim()) return false;
  const a = assignedMember.trim().toLowerCase().replace(/\s+/g, ' ');
  const m = memberName.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!m) return false;
  if (a === m) return true;
  const aParts = a.split(' ');
  const mParts = m.split(' ');
  if (aParts.length === 1 && aParts[0] === mParts[0]) return true;  // "Mia" ↔ "Mia Clark"
  if (mParts.length === 1 && mParts[0] === aParts[0]) return true;  // full ↔ bare first name
  return false;
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function MemberBelongings(
  { memberName, canEdit = false }: { memberName: string; canEdit?: boolean },
) {
  const [items, setItems] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gallery, setGallery] = useState<{ src: string; label: string }[] | null>(null);
  const [galleryIdx, setGalleryIdx] = useState(0);
  const [detailItem, setDetailItem] = useState<AssetItem | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingItemRef = useRef<string | null>(null);

  // Gallery lightbox is an internally-managed overlay (not parent-gated), so
  // lock body scroll based on its own open state — matches AddMemberModal's
  // pattern but with the boolean this component actually owns.
  useBodyScrollLock(!!gallery && gallery.length > 0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadAssets()
      .then((all) => {
        if (cancelled) return;
        setItems((all || []).filter((item) => isAssignedTo(item.assignedMember, memberName)));
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [memberName]);

  const openGallery = (imgs: { src: string; label: string }[], idx = 0) => {
    if (imgs.length) { setGallery(imgs); setGalleryIdx(idx); }
  };

  const pickPhoto = (itemId: string) => {
    pendingItemRef.current = itemId;
    fileRef.current?.click();
  };

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const files: File[] = e.target.files ? Array.from(e.target.files) : [];
    const itemId = pendingItemRef.current;
    e.target.value = '';
    pendingItemRef.current = null;
    if (!files.length || !itemId) return;
    const item = items.find((i) => i.id === itemId);
    if (!item) return;

    setBusyId(itemId); setError(null);
    try {
      // First selected photo (if none yet) becomes the inline primary for a fast
      // thumbnail; every other photo is uploaded to Storage and stored as a URL,
      // so an asset can hold many pictures without the ~1 MiB Firestore limit.
      let updated: AssetItem = { ...item };
      for (const file of files) {
        const dataUrl = await readFile(file);
        if (!updated.photoDataUrl) {
          updated = { ...updated, photoDataUrl: await compressImageToAvatar(dataUrl, 1500, 0.82) };
        } else if ((updated.photos || []).length < EXTRA_PHOTO_CAP) {
          const url = await uploadAssetPhoto(await compressImageToAvatar(dataUrl, 1600, 0.82));
          updated = { ...updated, photos: [...(updated.photos || []), url] };
        }
      }
      const ok = await saveAsset(updated);
      if (ok) {
        setItems((prev) => prev.map((i) => (i.id === itemId ? updated : i)));
      } else {
        setError('Could not save the photos — please try again.');
      }
    } catch {
      setError('Could not add those photos — please try another.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="card p-6 flex items-center justify-center">
        <div className="w-5 h-5 rounded-full border-2 border-cream-300 border-t-clay-500 animate-spin" />
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-2.5">
        <div className="p-1.5 rounded-lg bg-sage-100 text-sage-700 shrink-0">
          <Package className="w-3.5 h-3.5" />
        </div>
        <h3 className="text-[13px] font-bold text-ink-800">Belongings</h3>
        <span className="text-[11px] text-ink-400">{items.length}</span>
      </div>

      {error && <p className="px-4 pb-2 text-[11px] text-rosa-600">{error}</p>}

      <div className="divide-y divide-cream-200">
        {items.map((item) => {
          const value = item.replacementValue || item.purchasePrice;
          const statusChip = item.status === 'stolen' ? 'Stolen' : item.status === 'lost' ? 'Lost' : null;
          const imgs = itemImages(item);
          const busy = busyId === item.id;

          return (
            <div
              key={item.id}
              onClick={() => setDetailItem(item)}
              className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-cream-50/80 transition-colors"
              title="View full details"
            >
              {imgs.length > 0 ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); openGallery(imgs); }}
                  className="w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-cream-100 flex items-center justify-center ring-1 ring-cream-200 hover:ring-clay-300 transition-all cursor-zoom-in"
                  title="View photos"
                >
                  <img src={imgs[0].src} alt={item.name} className="w-full h-full object-cover" />
                </button>
              ) : canEdit ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); pickPhoto(item.id); }}
                  disabled={busy}
                  className="group/ph w-9 h-9 rounded-lg shrink-0 bg-clay-50/60 border border-dashed border-clay-300 flex items-center justify-center hover:border-clay-400 hover:bg-clay-50 transition-all cursor-pointer disabled:opacity-60"
                  title="Add a photo"
                >
                  {busy
                    ? <Loader2 className="w-4 h-4 text-clay-500 animate-spin" />
                    : <Camera className="w-4 h-4 text-clay-400 group-hover/ph:text-clay-600 transition-colors" />}
                </button>
              ) : (
                <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-cream-100 flex items-center justify-center">
                  <Package className="w-4 h-4 text-ink-300" />
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink-800 truncate">{item.name}</p>
                {(item.make || item.model) && (
                  <p className="text-[11px] text-ink-400 truncate">
                    {[item.make, item.model].filter(Boolean).join(' ')}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {statusChip && (
                  <span className="chip bg-rosa-100 text-rosa-700">{statusChip}</span>
                )}
                {value && (
                  <span className="chip bg-cream-100 text-ink-600 tabular-nums">{value}</span>
                )}
                {/* Add / replace a photo even when one already exists */}
                {canEdit && imgs.length > 0 && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); pickPhoto(item.id); }}
                    disabled={busy}
                    className="btn-quiet p-1.5 disabled:opacity-60"
                    title="Add another photo"
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <input ref={fileRef} type="file" accept="image/*" multiple onChange={handleFile} className="hidden" />

      {/* Image gallery lightbox */}
      {gallery && gallery.length > 0 && (
        <div
          className="fixed inset-0 z-[60] bg-ink-900/80 backdrop-blur-sm flex items-center justify-center p-4 anim-fade"
          onClick={() => setGallery(null)}
        >
          <button className="absolute top-4 right-4 btn-quiet text-white p-2" onClick={() => setGallery(null)}><X className="w-5 h-5" /></button>
          <div className="relative max-w-3xl w-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            {gallery.length > 1 && (
              <button
                className="absolute left-2 sm:-left-12 btn-quiet text-white p-2 bg-ink-900/40 rounded-full"
                onClick={() => setGalleryIdx((i) => (i - 1 + gallery.length) % gallery.length)}
              ><ChevronLeft className="w-6 h-6" /></button>
            )}
            <div className="flex flex-col items-center gap-3">
              <img src={gallery[galleryIdx].src} alt={gallery[galleryIdx].label} className="max-h-[80dvh] max-w-full rounded-xl object-contain" />
              <div className="flex items-center gap-2">
                <span className="chip bg-white/90 text-ink-700">{gallery[galleryIdx].label}</span>
                {gallery.length > 1 && <span className="text-[12px] text-white/80 tabular-nums">{galleryIdx + 1} / {gallery.length}</span>}
              </div>
            </div>
            {gallery.length > 1 && (
              <button
                className="absolute right-2 sm:-right-12 btn-quiet text-white p-2 bg-ink-900/40 rounded-full"
                onClick={() => setGalleryIdx((i) => (i + 1) % gallery.length)}
              ><ChevronRight className="w-6 h-6" /></button>
            )}
          </div>
        </div>
      )}

      {detailItem && (
        <AssetDetailModal
          item={detailItem}
          canEdit={canEdit}
          onClose={() => setDetailItem(null)}
          onSaved={(updated) => {
            setItems((prev) =>
              isAssignedTo(updated.assignedMember, memberName)
                ? prev.map((i) => (i.id === updated.id ? updated : i))
                // Reassigning to someone else drops it from this member's own card.
                : prev.filter((i) => i.id !== updated.id),
            );
            setDetailItem(null);
          }}
          onDeleted={(id) => {
            setItems((prev) => prev.filter((i) => i.id !== id));
            setDetailItem(null);
          }}
        />
      )}
    </div>
  );
}
