import React, { useState, useRef } from 'react';
import { FamilyMember, FavoriteItem } from '../types';
import { getFavoritePlaceholderSvg } from '../utils/svgPlaceholders';
import {
  Heart, Plus, Camera, Upload, Sparkles, X,
  Search, Eye, Calendar, Tag, Check, RefreshCcw, HelpCircle, FileText,
  Gift, ExternalLink, ShoppingBag, DollarSign
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import SheetGrabber from './SheetGrabber';
import EmptyState from './EmptyState';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

interface MemberFavoritesProps {
  member: FamilyMember;
  onUpdateMember: (updatedMember: FamilyMember) => void;
}

const CATEGORIES: FavoriteItem['category'][] = [
  'Toy', 'Clothing & Style', 'Hobbies & Sports', 'Books & Media', 'Food & Treats', 'Other'
];

// Bug fix #3 / shared with GrowthTracker: timezone-safe local date
const todayLocal = () => new Date().toLocaleDateString('en-CA');

// Category chip colour pairing
const CATEGORY_CHIP: Record<string, string> = {
  'Toy': 'bg-honey-100 text-honey-700',
  'Clothing & Style': 'bg-rosa-100 text-rosa-700',
  'Hobbies & Sports': 'bg-sage-100 text-sage-700',
  'Books & Media': 'bg-dusk-100 text-dusk-700',
  'Food & Treats': 'bg-clay-100 text-clay-700',
  'Other': 'bg-cream-200 text-ink-600',
};

export default function MemberFavorites({ member, onUpdateMember }: MemberFavoritesProps) {
  const favorites = member.favorites || [];
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [listSection, setListSection] = useState<'all' | 'liked' | 'wishlist'>('all');
  const [isAdding, setIsAdding] = useState(false);
  const [viewingItem, setViewingItem] = useState<FavoriteItem | null>(null);

  // Detail modal is a "fixed inset-0" overlay gated by viewingItem !== null —
  // lock background scroll while it's open (iOS Safari pan/rubber-band fix).
  useBodyScrollLock(viewingItem !== null);

  // Form states
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<FavoriteItem['category']>('Toy');
  const [notes, setNotes] = useState('');
  const [isWishlist, setIsWishlist] = useState(false);
  const [targetPrice, setTargetPrice] = useState('');
  const [webLink, setWebLink] = useState('');

  const [imageMode, setImageMode] = useState<'svg' | 'upload' | 'camera'>('svg');
  const [uploadedBase64, setUploadedBase64] = useState<string>('');
  const [uploadFileName, setUploadFileName] = useState('');

  // Camera states
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Handle section & category filtering
  const sectionFiltered = favorites.filter(fav => {
    if (listSection === 'liked') return fav.isWishlist !== true;
    if (listSection === 'wishlist') return fav.isWishlist === true;
    return true;
  });

  const filteredFavorites = selectedCategory === 'All'
    ? sectionFiltered
    : sectionFiltered.filter(fav => fav.category === selectedCategory);

  // File drag & drop or selection handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent<HTMLDivElement>) => {
    let file: File | null = null;

    if ('dataTransfer' in e) {
      e.preventDefault();
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        file = e.dataTransfer.files[0];
      }
    } else if (e.target.files && e.target.files.length > 0) {
      file = e.target.files[0];
    }

    if (file) {
      if (!file.type.startsWith('image/')) {
        alert('Please provide a valid image file.');
        return;
      }
      setUploadFileName(file.name);
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          setUploadedBase64(reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Live Camera handlers
  const startCamera = async () => {
    setIsCameraActive(true);
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      console.error(err);
      setCameraError('Could not start video stream. Verify permissions.');
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  const capturePhoto = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth || 640;
      canvas.height = videoRef.current.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        setUploadedBase64(dataUrl);
        setUploadFileName('Live_Scan_Image.jpg');
        stopCamera();
        setImageMode('upload');
      }
    }
  };

  // Submit favorite item addition
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const finalImage = (imageMode !== 'svg' && uploadedBase64)
      ? uploadedBase64
      : getFavoritePlaceholderSvg(title, category);

    const newItem: FavoriteItem = {
      id: 'fav-' + Date.now(),
      title: title.trim(),
      category,
      imageUrl: finalImage,
      notes: notes.trim() || undefined,
      // Bug fix #3: use timezone-safe local date string
      addedAt: todayLocal(),
      isWishlist,
      targetPrice: isWishlist ? (targetPrice.trim() || undefined) : undefined,
      webLink: isWishlist ? (webLink.trim() || undefined) : undefined,
      bought: false
    };

    const updatedMember: FamilyMember = {
      ...member,
      favorites: [...favorites, newItem]
    };

    onUpdateMember(updatedMember);

    // Reset Form
    setTitle('');
    setCategory('Toy');
    setNotes('');
    setIsWishlist(false);
    setTargetPrice('');
    setWebLink('');
    setUploadedBase64('');
    setUploadFileName('');
    setIsAdding(false);
  };

  // Delete favorite item
  const handleDelete = (favId: string) => {
    const updatedMember: FamilyMember = {
      ...member,
      favorites: favorites.filter(fav => fav.id !== favId)
    };
    onUpdateMember(updatedMember);
    if (viewingItem?.id === favId) {
      setViewingItem(null);
    }
  };

  // Toggle acquired/bought status
  const toggleBought = (itemId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const updatedFavorites = favorites.map(fav => {
      if (fav.id === itemId) return { ...fav, bought: !fav.bought };
      return fav;
    });
    const updatedMember: FamilyMember = { ...member, favorites: updatedFavorites };
    onUpdateMember(updatedMember);
    if (viewingItem?.id === itemId) {
      setViewingItem({ ...viewingItem, bought: !viewingItem.bought });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-cream-200 pb-4">
        <div>
          <h3 className="text-xl font-display font-semibold text-ink-900 flex flex-wrap items-center gap-2">
            <span className="w-1.5 h-3.5 bg-rosa-500 rounded-full inline-block"></span>
            <span>Things they like &amp; favorites</span>
            <span className="chip bg-rosa-100 text-rosa-700 border border-rosa-100">
              <Heart className="w-3 h-3 fill-rosa-500 text-rosa-500" /> Catalog scanner
            </span>
          </h3>
          <p className="text-[13px] text-ink-500 mt-1">
            Store beautiful photos of clothes, toys, snacks, and books they adore so ordering gifts or matching styles is seamless.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setIsAdding(!isAdding);
            setIsCameraActive(false);
          }}
          className="btn-primary"
        >
          {isAdding ? (
            <>
              <X className="w-3.5 h-3.5" />
              <span>Cancel entry</span>
            </>
          ) : (
            <>
              <Plus className="w-3.5 h-3.5" />
              <span>Add favorite</span>
            </>
          )}
        </button>
      </div>

      {/* Add Favorite Form */}
      <AnimatePresence>
        {isAdding && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden bg-cream-100 border border-cream-300 rounded-2xl p-5 shadow-soft"
          >
            <form onSubmit={handleSubmit} className="space-y-4">
              <h4 className="text-[13px] font-semibold text-ink-600 flex items-center gap-1.5 mb-1">
                <Sparkles className="w-3.5 h-3.5 text-clay-500" />
                New favorite catalog record
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Text fields */}
                <div className="space-y-3">
                  <div>
                    <label className="field-label">Item title / specific name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Lego Technic Racecar, Chocolate Croissants"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="field"
                    />
                  </div>

                  <div>
                    <label className="field-label">Category</label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as FavoriteItem['category'])}
                      className="field"
                    >
                      {CATEGORIES.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="field-label">Notes or size details</label>
                    <textarea
                      rows={2}
                      placeholder="e.g. Size EU 38, loves strawberry flavor, purchased at Decathlon..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="field resize-none"
                    />
                  </div>

                  {/* Wishlist toggle */}
                  <div className="pt-1.5 border-t border-cream-300">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={isWishlist}
                        onChange={(e) => setIsWishlist(e.target.checked)}
                        className="rounded border-cream-300 text-clay-500 focus:ring-clay-400 w-4 h-4 cursor-pointer"
                      />
                      <span className="text-[13px] font-semibold text-ink-700 flex items-center gap-1">
                        <Gift className="w-3.5 h-3.5 text-honey-500" />
                        Save as wishlist item (wanted gift)
                      </span>
                    </label>
                    <p className="text-[12px] text-ink-400 ml-6 mt-0.5">
                      Check this if {member.name} doesn&apos;t have this yet, but wants it for birthdays or upcoming holidays.
                    </p>
                  </div>

                  {/* Optional price & link */}
                  {isWishlist && (
                    <div className="grid grid-cols-2 gap-2.5 pt-1">
                      <div>
                        <label className="field-label">Target price (€)</label>
                        <input
                          type="text"
                          placeholder="e.g. €29.99"
                          value={targetPrice}
                          onChange={(e) => setTargetPrice(e.target.value)}
                          className="field"
                        />
                      </div>
                      <div>
                        <label className="field-label">Shop URL / store link</label>
                        <input
                          type="text"
                          placeholder="e.g. amazon.de..."
                          value={webLink}
                          onChange={(e) => setWebLink(e.target.value)}
                          className="field"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Picture section */}
                <div className="space-y-3">
                  <label className="field-label">Picture attachment</label>

                  <div className="flex bg-cream-200 p-1 rounded-xl gap-1">
                    <button
                      type="button"
                      onClick={() => { setImageMode('svg'); stopCamera(); }}
                      className={`flex-1 py-1.5 text-[12px] font-semibold rounded-lg transition-all ${
                        imageMode === 'svg' ? 'bg-white text-ink-900 shadow-soft' : 'text-ink-500 hover:text-ink-800'
                      }`}
                    >
                      <Sparkles className="w-3 h-3 inline-block mr-1 text-clay-500" />
                      Dynamic art
                    </button>
                    <button
                      type="button"
                      onClick={() => { setImageMode('upload'); stopCamera(); }}
                      className={`flex-1 py-1.5 text-[12px] font-semibold rounded-lg transition-all ${
                        imageMode === 'upload' ? 'bg-white text-ink-900 shadow-soft' : 'text-ink-500 hover:text-ink-800'
                      }`}
                    >
                      <Upload className="w-3 h-3 inline-block mr-1 text-dusk-500" />
                      Upload scan
                    </button>
                    <button
                      type="button"
                      onClick={() => { setImageMode('camera'); startCamera(); }}
                      className={`flex-1 py-1.5 text-[12px] font-semibold rounded-lg transition-all ${
                        imageMode === 'camera' ? 'bg-white text-ink-900 shadow-soft' : 'text-ink-500 hover:text-ink-800'
                      }`}
                    >
                      <Camera className="w-3 h-3 inline-block mr-1 text-sage-500" />
                      Live camera
                    </button>
                  </div>

                  <div className="border border-cream-300 rounded-xl bg-white p-3 min-h-[140px] flex flex-col justify-center items-center relative overflow-hidden">
                    {imageMode === 'svg' && (
                      <div className="text-center p-4">
                        <Sparkles className="w-8 h-8 text-clay-500 mx-auto animate-pulse" />
                        <p className="text-[12px] font-semibold text-clay-700 mt-2">Dynamic art enabled</p>
                        <p className="text-[12px] text-ink-400 mt-1 max-w-[200px] mx-auto">
                          Generates a beautifully colored vector illustration matching &ldquo;{title || 'Example'}&rdquo; instantly.
                        </p>
                      </div>
                    )}

                    {imageMode === 'upload' && (
                      <div
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={handleFileChange}
                        className="w-full h-full min-h-[110px] border-2 border-dashed border-cream-300 rounded-lg flex flex-col items-center justify-center p-3 cursor-pointer hover:bg-cream-50 transition-colors"
                        onClick={() => document.getElementById('fav-image-file')?.click()}
                      >
                        <input
                          id="fav-image-file"
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleFileChange}
                        />
                        {uploadedBase64 ? (
                          <div className="relative w-full h-24 flex items-center justify-center">
                            <img
                              src={uploadedBase64}
                              alt="Scan Preview"
                              className="h-full object-contain rounded-lg border border-cream-300"
                              referrerPolicy="no-referrer"
                            />
                            <div className="absolute bottom-1 bg-ink-900/75 text-white text-[11px] font-mono px-1.5 py-0.5 rounded">
                              {uploadFileName ? uploadFileName.slice(0, 20) + '...' : 'Scan loaded'}
                            </div>
                          </div>
                        ) : (
                          <>
                            <Upload className="w-6 h-6 text-ink-400 mb-1" />
                            <p className="text-[12px] font-semibold text-ink-600">Drag or tap to upload</p>
                            <p className="text-[11px] text-ink-400 mt-0.5">JPG / PNG photograph of the item</p>
                          </>
                        )}
                      </div>
                    )}

                    {imageMode === 'camera' && (
                      <div className="w-full text-center space-y-2">
                        {isCameraActive ? (
                          <div className="relative rounded-lg overflow-hidden bg-ink-900 mx-auto max-w-[260px] aspect-video border border-cream-300">
                            <video
                              ref={videoRef}
                              autoPlay
                              playsInline
                              muted
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={capturePhoto}
                                className="px-3 py-1 bg-sage-500 hover:bg-sage-600 text-white rounded-lg text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                              >
                                <Camera className="w-3 h-3" />
                                <span>Snap pic</span>
                              </button>
                              <button
                                type="button"
                                onClick={stopCamera}
                                className="px-2 py-1 bg-ink-800 text-white hover:bg-ink-900 rounded-lg text-[11px]"
                              >
                                Stop
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="p-4">
                            <Camera className="w-8 h-8 text-sage-500 mx-auto" />
                            <button
                              type="button"
                              onClick={startCamera}
                              className="mt-2.5 btn-quiet text-[12px] px-3 py-1.5"
                            >
                              Initialize web camera
                            </button>
                            {cameraError && (
                              <p className="text-[12px] text-rosa-500 mt-1.5 font-semibold">{cameraError}</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex justify-end gap-2 pt-2 border-t border-cream-200">
                <button
                  type="button"
                  onClick={() => { setIsAdding(false); stopCamera(); }}
                  className="btn-quiet"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!title.trim()}
                  className="btn-primary disabled:opacity-40"
                >
                  Confirm favorite
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Section Picker: All / Owned / Wishlist */}
      <div className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center">
        <div className="flex bg-cream-200 border border-cream-300 p-1.5 rounded-2xl w-full sm:w-auto sm:min-w-[380px] select-none">
          <button
            onClick={() => { setListSection('all'); setSelectedCategory('All'); }}
            className={`flex-1 py-2 text-[13px] font-semibold rounded-xl transition-all cursor-pointer text-center ${
              listSection === 'all'
                ? 'bg-white text-ink-900 shadow-soft'
                : 'text-ink-500 hover:text-ink-800'
            }`}
          >
            All (<span className="tabular-nums">{favorites.length}</span>)
          </button>
          <button
            onClick={() => { setListSection('liked'); setSelectedCategory('All'); }}
            className={`flex-1 py-1.5 text-[13px] font-semibold rounded-xl transition-all cursor-pointer text-center flex items-center justify-center gap-1.5 ${
              listSection === 'liked'
                ? 'bg-white text-rosa-500 shadow-soft'
                : 'text-ink-500 hover:text-ink-800'
            }`}
          >
            <Heart className="w-3.5 h-3.5 fill-rosa-500 text-rosa-500" />
            <span>Owned (<span className="tabular-nums">{favorites.filter(f => f.isWishlist !== true).length}</span>)</span>
          </button>
          <button
            onClick={() => { setListSection('wishlist'); setSelectedCategory('All'); }}
            className={`flex-1 py-1.5 text-[13px] font-semibold rounded-xl transition-all cursor-pointer text-center flex items-center justify-center gap-1.5 ${
              listSection === 'wishlist'
                ? 'bg-white text-dusk-500 shadow-soft'
                : 'text-ink-500 hover:text-ink-800'
            }`}
          >
            <Gift className="w-3.5 h-3.5 text-honey-500 fill-honey-100" />
            <span>Wishlist (<span className="tabular-nums">{favorites.filter(f => f.isWishlist === true).length}</span>)</span>
          </button>
        </div>

        <div className="text-[12px] text-ink-400 font-mono">
          {listSection === 'all' && 'Showing all catalog items'}
          {listSection === 'liked' && 'Showing things they own & love'}
          {listSection === 'wishlist' && 'Showing birthday & upcoming gift ideas'}
        </div>
      </div>

      {/* Category Filter */}
      <div className="flex flex-wrap gap-1.5 bg-cream-100 border border-cream-200 p-1.5 rounded-xl text-xs font-medium w-full overflow-x-auto select-none">
        <button
          onClick={() => setSelectedCategory('All')}
          className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all cursor-pointer ${
            selectedCategory === 'All'
              ? 'bg-clay-500 text-white shadow-soft'
              : 'text-ink-500 hover:text-ink-800 hover:bg-cream-200'
          }`}
        >
          View all (<span className="tabular-nums">{sectionFiltered.length}</span>)
        </button>

        {CATEGORIES.map(categoryName => {
          const count = sectionFiltered.filter(f => f.category === categoryName).length;
          return (
            <button
              key={categoryName}
              onClick={() => setSelectedCategory(categoryName)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all cursor-pointer ${
                selectedCategory === categoryName
                  ? 'bg-clay-500 text-white shadow-soft'
                  : 'text-ink-500 hover:text-ink-800 hover:bg-cream-200'
              }`}
            >
              {categoryName} (<span className="tabular-nums">{count}</span>)
            </button>
          );
        })}
      </div>

      {/* Favorites Grid */}
      {filteredFavorites.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-cream-300 rounded-2xl bg-cream-50 p-5 space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-rosa-50 text-rosa-500 border border-rosa-100 flex items-center justify-center mx-auto">
            <Heart className="w-6 h-6" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h4 className="text-[13px] font-semibold text-ink-800">
              No favorite items in {selectedCategory}
            </h4>
            <p className="text-[13px] text-ink-400 leading-relaxed">
              Maintain photographic scans, dimensions, color preferences, and store links of things {member.name} loves.
            </p>
          </div>
          <button
            onClick={() => setIsAdding(true)}
            className="btn-primary mx-auto"
          >
            Add {member.name}&apos;s first favorite
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredFavorites.map((item) => (
            <div
              key={item.id}
              className={`bg-white border rounded-2xl shadow-soft hover:shadow-lift transition-all overflow-hidden flex flex-col group relative ${
                item.isWishlist
                  ? item.bought
                    ? 'border-sage-200 bg-sage-50/10'
                    : 'border-honey-200 bg-honey-50/10'
                  : 'border-cream-300/70'
              }`}
            >
              {/* Card image */}
              <div className="aspect-video relative overflow-hidden bg-cream-100 border-b border-cream-200 shrink-0">
                <img
                  src={item.imageUrl || getFavoritePlaceholderSvg(item.title, item.category)}
                  alt={item.title}
                  className="w-full h-full object-cover group-hover:scale-103 transition-transform duration-300"
                  referrerPolicy="no-referrer"
                />

                {/* Category chip overlay */}
                <div className={`absolute top-2 left-2 chip ${CATEGORY_CHIP[item.category] ?? 'bg-cream-200 text-ink-600'} backdrop-blur-sm shadow-soft`}>
                  {item.category}
                </div>

                {/* Wishlist badge overlay */}
                {item.isWishlist && (
                  <div className={`absolute top-2 right-2 chip backdrop-blur-sm shadow-soft ${
                    item.bought
                      ? 'bg-sage-500 text-white'
                      : 'bg-honey-500 text-white'
                  }`}>
                    {item.bought ? (
                      <>
                        <Check className="w-2.5 h-2.5" />
                        <span>Secured</span>
                      </>
                    ) : (
                      <>
                        <Gift className="w-2.5 h-2.5" />
                        <span>Wishlist</span>
                      </>
                    )}
                  </div>
                )}

                {/* Action overlay — hover-reveal on desktop, always tappable on touch */}
                <div className="absolute inset-0 bg-ink-900/40 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <button
                    onClick={() => setViewingItem(item)}
                    className="p-2 bg-white text-ink-900 rounded-xl font-semibold text-[12px] hover:bg-cream-100 active:scale-95 transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Zoom detail</span>
                  </button>
                  <ConfirmDeleteButton
                    onConfirm={() => handleDelete(item.id)}
                    ariaLabel={`Remove ${item.title || 'this'} from favorites`}
                    confirm={false}
                    variant="solid"
                  />
                </div>
              </div>

              {/* Card body */}
              <div className="p-4 flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between gap-1.5">
                    <h4 className="text-[13px] font-semibold text-ink-900 truncate">
                      {item.title}
                    </h4>
                    {item.isWishlist && item.targetPrice && (
                      <span className="shrink-0 font-mono text-[11px] font-semibold px-1.5 py-0.5 rounded chip bg-honey-100 text-honey-700 tabular-nums">
                        {item.targetPrice.startsWith('€') || item.targetPrice.startsWith('$') ? item.targetPrice : `€${item.targetPrice}`}
                      </span>
                    )}
                  </div>
                  {item.notes ? (
                    <p className="text-[12px] text-ink-500 mt-1 line-clamp-2 leading-relaxed">
                      {item.notes}
                    </p>
                  ) : (
                    <EmptyState size="sm" title="No notes logged yet." className="italic mt-1" />
                  )}
                </div>

                <div className="border-t border-cream-200 pt-2.5 mt-2.5 flex items-center justify-between text-[11px] text-ink-400 font-mono">
                  <span className="flex items-center gap-1 tabular-nums">
                    <Calendar className="w-3 h-3" />
                    {item.addedAt}
                  </span>

                  <div className="flex items-center gap-1.5">
                    {item.isWishlist && (
                      <button
                        onClick={(e) => toggleBought(item.id, e)}
                        className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-all border cursor-pointer ${
                          item.bought
                            ? 'bg-sage-100 text-sage-700 border-sage-200 hover:bg-sage-200'
                            : 'bg-honey-100 hover:bg-honey-200 text-honey-700 border-honey-200'
                        }`}
                        title={item.bought ? 'Mark as wanted' : 'Mark as secured (bought)'}
                      >
                        {item.bought ? 'Secured' : 'Get item'}
                      </button>
                    )}

                    {item.isWishlist && item.webLink && (
                      <a
                        href={item.webLink.startsWith('http') ? item.webLink : `https://${item.webLink}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1 hover:bg-cream-200 text-ink-400 hover:text-dusk-500 rounded transition-colors"
                        title="Open shopping page"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}

                    {!item.isWishlist && (
                      <span className="text-ink-400 flex items-center gap-0.5">
                        <Check className="w-3 h-3 text-rosa-500" /> Loved
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail Modal */}
      <AnimatePresence>
        {viewingItem && (
          <div className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm anim-fade flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl overflow-hidden max-w-lg w-full shadow-lift border border-cream-300/70 anim-pop"
            >
              <SheetGrabber onClose={() => setViewingItem(null)} />
              <div className="p-5 border-b border-cream-200 bg-cream-50 flex justify-between items-center">
                <div>
                  <span className={`chip ${
                    viewingItem.isWishlist
                      ? 'bg-honey-100 text-honey-700'
                      : `${CATEGORY_CHIP[viewingItem.category] ?? 'bg-cream-200 text-ink-600'}`
                  }`}>
                    {viewingItem.isWishlist ? '🎁 Wishlist gift idea' : `${viewingItem.category} favorite`}
                  </span>
                  <h3 className="text-[15px] font-semibold text-ink-900 mt-2">{viewingItem.title}</h3>
                </div>
                <button
                  onClick={() => setViewingItem(null)}
                  className="p-1.5 hover:bg-cream-200 text-ink-400 hover:text-ink-800 rounded-xl transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="aspect-video relative rounded-2xl overflow-hidden border border-cream-200 bg-cream-100 flex items-center justify-center">
                  <img
                    src={viewingItem.imageUrl || getFavoritePlaceholderSvg(viewingItem.title, viewingItem.category)}
                    alt={viewingItem.title}
                    className="max-h-full max-w-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                </div>

                {/* Wishlist specs */}
                {viewingItem.isWishlist && (
                  <div className="p-3.5 rounded-xl bg-honey-50 border border-honey-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-honey-100 text-honey-700 flex items-center justify-center shrink-0">
                        <Gift className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="font-semibold text-ink-800 text-[13px]">Christmas / birthday shopping</p>
                        <p className="text-ink-500 text-[12px] mt-0.5">
                          Cost estimate: <span className="text-ink-900 font-semibold tabular-nums">{viewingItem.targetPrice ? (viewingItem.targetPrice.startsWith('€') || viewingItem.targetPrice.startsWith('$') ? viewingItem.targetPrice : `€${viewingItem.targetPrice}`) : 'Unspecified'}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => toggleBought(viewingItem.id)}
                        className={`px-3 py-1.5 text-[12px] font-semibold rounded-xl transition-all border cursor-pointer ${
                          viewingItem.bought
                            ? 'bg-sage-500 text-white border-sage-500 shadow-soft'
                            : 'bg-white text-honey-700 border-honey-200 hover:bg-honey-50'
                        }`}
                      >
                        {viewingItem.bought ? '✓ Secured' : '🎁 Secure gift'}
                      </button>

                      {viewingItem.webLink && (
                        <a
                          href={viewingItem.webLink.startsWith('http') ? viewingItem.webLink : `https://${viewingItem.webLink}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-quiet px-2.5 py-1.5 text-[12px] flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>Buy</span>
                        </a>
                      )}
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <h4 className="section-label">Specifications &amp; shopping notes</h4>
                  <div className="p-4 rounded-2xl bg-cream-100 border border-cream-200 text-[13px] text-ink-700 leading-relaxed">
                    {viewingItem.notes || <span className="italic text-ink-400">No favorite descriptions recorded.</span>}
                  </div>
                </div>

                <div className="flex justify-between items-center text-[11px] text-ink-400 font-mono border-t border-cream-200 pt-3 tabular-nums">
                  <span>ID: {viewingItem.id}</span>
                  <span>Registered: {viewingItem.addedAt}</span>
                </div>
              </div>

              <div className="px-5 py-4 bg-cream-50 border-t border-cream-200 flex justify-end gap-2">
                <ConfirmDeleteButton
                  onConfirm={() => handleDelete(viewingItem.id)}
                  ariaLabel={`Delete ${viewingItem.title || 'this'} favorite`}
                  confirm={false}
                  variant="solid"
                  className="rounded-full px-4"
                >
                  Delete item
                </ConfirmDeleteButton>
                <button
                  onClick={() => setViewingItem(null)}
                  className="btn-primary"
                >
                  Keep &amp; close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
