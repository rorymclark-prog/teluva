import React, { useState, useRef } from 'react';
import { FamilyMember, FavoriteItem } from '../types';
import { getFavoritePlaceholderSvg } from '../utils/svgPlaceholders';
import { 
  Heart, Plus, Trash2, Camera, Upload, Sparkles, X, 
  Search, Eye, Calendar, Tag, Check, RefreshCcw, HelpCircle, FileText,
  Gift, ExternalLink, ShoppingBag, DollarSign
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface MemberFavoritesProps {
  member: FamilyMember;
  onUpdateMember: (updatedMember: FamilyMember) => void;
}

const CATEGORIES: FavoriteItem['category'][] = [
  'Toy', 'Clothing & Style', 'Hobbies & Sports', 'Books & Media', 'Food & Treats', 'Other'
];

export default function MemberFavorites({ member, onUpdateMember }: MemberFavoritesProps) {
  const favorites = member.favorites || [];
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [listSection, setListSection] = useState<'all' | 'liked' | 'wishlist'>('all'); // Filter by tab
  const [isAdding, setIsAdding] = useState(false);
  const [viewingItem, setViewingItem] = useState<FavoriteItem | null>(null);

  // Form states
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<FavoriteItem['category']>('Toy');
  const [notes, setNotes] = useState('');
  const [isWishlist, setIsWishlist] = useState(false); // Wishlist toggler
  const [targetPrice, setTargetPrice] = useState('');  // Estimated price
  const [webLink, setWebLink] = useState('');          // Shopping shop URL
  
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
        setImageMode('upload'); // Switch to view uploaded base64 copy
      }
    }
  };

  // Submit favorite item addition
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    // Use placeholder SVG if no upload is selected or mode is 'svg'
    const finalImage = (imageMode !== 'svg' && uploadedBase64) 
      ? uploadedBase64 
      : getFavoritePlaceholderSvg(title, category);

    const newItem: FavoriteItem = {
      id: 'fav-' + Date.now(),
      title: title.trim(),
      category,
      imageUrl: finalImage,
      notes: notes.trim() || undefined,
      addedAt: new Date().toISOString().split('T')[0],
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

  // Toggle acquired/bought status of items on the wishlist
  const toggleBought = (itemId: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation(); // Prevent opening zoom view
    }
    const updatedFavorites = favorites.map(fav => {
      if (fav.id === itemId) {
        return { ...fav, bought: !fav.bought };
      }
      return fav;
    });
    const updatedMember: FamilyMember = {
      ...member,
      favorites: updatedFavorites
    };
    onUpdateMember(updatedMember);

    // Update state of currently active modal view if zoom detail is open
    if (viewingItem?.id === itemId) {
      setViewingItem({
        ...viewingItem,
        bought: !viewingItem.bought
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Upper header action block with EU label */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-4">
        <div>
          <h3 className="text-sm font-bold text-gray-900 flex flex-wrap items-center gap-2 uppercase tracking-wider">
            <span className="w-1.5 h-3.5 bg-rose-500 rounded-full inline-block"></span>
            <span>Things They Like & Favorites</span>
            <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-rose-700 border border-rose-200">
              <Heart className="w-2.5 h-2.5 fill-rose-600 text-rose-600" /> Catalog Scanner
            </span>
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            Store beautiful photos of clothes, toys, snacks, and books they adore so ordering gifts or matching styles is seamless.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setIsAdding(!isAdding);
            setIsCameraActive(false);
          }}
          className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold uppercase tracking-wider rounded-xl cursor-pointer shadow-sm flex items-center gap-1.5 transition-all active:scale-95"
        >
          {isAdding ? (
            <>
              <X className="w-3.5 h-3.5" />
              <span>Cancel Entry</span>
            </>
          ) : (
            <>
              <Plus className="w-3.5 h-3.5" />
              <span>Add Favorite</span>
            </>
          )}
        </button>
      </div>

      {/* Dynamic Add Favorite Form Card */}
      <AnimatePresence>
        {isAdding && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden bg-rose-50/40 border border-rose-100 rounded-2xl p-5 shadow-xs"
          >
            <form onSubmit={handleSubmit} className="space-y-4">
              <h4 className="text-[10px] font-bold text-rose-900 uppercase tracking-widest flex items-center gap-1.5 mb-1">
                <Sparkles className="w-3.5 h-3.5 text-rose-600" />
                New Favorite catalog record
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Text fields */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1 uppercase tracking-wider">
                      Item Title / Specific Name
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Lego Technic Racecar, Chocolate Croissants"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-xs focus:ring-1 focus:ring-rose-500 focus:border-rose-500 outline-none transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1 uppercase tracking-wider">
                      Category
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as FavoriteItem['category'])}
                      className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-xs focus:ring-1 focus:ring-rose-500 focus:border-rose-500 outline-none transition-all"
                    >
                      {CATEGORIES.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1 uppercase tracking-wider">
                      Notes or Sizes details
                    </label>
                    <textarea
                      rows={2}
                      placeholder="e.g. Size EU 38, loves strawberry flavor, purchased at Decathlon..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-xs focus:ring-1 focus:ring-rose-500 focus:border-rose-500 outline-none transition-all resize-none"
                    />
                  </div>

                  {/* Wishlist item setting toggle */}
                  <div className="pt-1.5 border-t border-rose-100/60">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={isWishlist}
                        onChange={(e) => setIsWishlist(e.target.checked)}
                        className="rounded border-gray-300 text-rose-600 focus:ring-rose-500 w-4 h-4 cursor-pointer"
                      />
                      <span className="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1">
                        <Gift className="w-3.5 h-3.5 text-rose-500 fill-rose-100" />
                        Save as Wishlist item (wanted gift)
                      </span>
                    </label>
                    <p className="text-[10px] text-gray-500 ml-6 mt-0.5">
                      Check this if {member.name} doesn&apos;t have this yet, but wants it for birthdays or upcoming holidays.
                    </p>
                  </div>

                  {/* Dynamic optional price & web store link input */}
                  {isWishlist && (
                    <div className="grid grid-cols-2 gap-2.5 pt-1 animate-fadeIn">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-700 mb-1 uppercase tracking-wider">
                          Target Price (€)
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. €29.99"
                          value={targetPrice}
                          onChange={(e) => setTargetPrice(e.target.value)}
                          className="w-full px-3 py-2 bg-white border border-gray-250 rounded-lg text-xs focus:ring-1 focus:ring-rose-500 focus:border-rose-500 outline-none transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-700 mb-1 uppercase tracking-wider">
                          Shop URL / Store link
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. amazon.de..."
                          value={webLink}
                          onChange={(e) => setWebLink(e.target.value)}
                          className="w-full px-3 py-2 bg-white border border-gray-250 rounded-lg text-xs focus:ring-1 focus:ring-rose-500 focus:border-rose-500 outline-none transition-all"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Picture uploading or capture selection */}
                <div className="space-y-3">
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Picture Attachment
                  </label>

                  <div className="flex bg-gray-100 p-1 rounded-xl gap-1">
                    <button
                      type="button"
                      onClick={() => { setImageMode('svg'); stopCamera(); }}
                      className={`flex-1 py-1.5 text-[9px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                        imageMode === 'svg' ? 'bg-white text-gray-950 shadow-xs' : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      <Sparkles className="w-3 h-3 inline-block mr-1 text-rose-500" />
                      Dynamic Art
                    </button>
                    <button
                      type="button"
                      onClick={() => { setImageMode('upload'); stopCamera(); }}
                      className={`flex-1 py-1.5 text-[9px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                        imageMode === 'upload' ? 'bg-white text-gray-950 shadow-xs' : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      <Upload className="w-3 h-3 inline-block mr-1 text-indigo-500" />
                      Upload Scan
                    </button>
                    <button
                      type="button"
                      onClick={() => { setImageMode('camera'); startCamera(); }}
                      className={`flex-1 py-1.5 text-[9px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                        imageMode === 'camera' ? 'bg-white text-gray-950 shadow-xs' : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      <Camera className="w-3 h-3 inline-block mr-1 text-teal-600" />
                      Live Camera
                    </button>
                  </div>

                  {/* Attachment options display */}
                  <div className="border border-gray-200 rounded-xl bg-white p-3 min-h-[140px] flex flex-col justify-center items-center relative overflow-hidden">
                    {imageMode === 'svg' && (
                      <div className="text-center p-4">
                        <Sparkles className="w-8 h-8 text-rose-500 mx-auto animate-pulse" />
                        <p className="text-[10px] text-rose-800 font-bold uppercase tracking-wider mt-2">Dynamic Art Enabled</p>
                        <p className="text-[9px] text-gray-500 mt-1 max-w-[200px] mx-auto">
                          Generates a beautifully colored vector vector illustration matching &ldquo;{title || 'Example'}&rdquo; instantly.
                        </p>
                      </div>
                    )}

                    {imageMode === 'upload' && (
                      <div 
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={handleFileChange}
                        className="w-full h-full min-h-[110px] border-2 border-dashed border-gray-200 rounded-lg flex flex-col items-center justify-center p-3 cursor-pointer hover:bg-gray-50 transition-colors"
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
                              className="h-full object-contain rounded-lg border border-gray-200"
                              referrerPolicy="no-referrer"
                            />
                            <div className="absolute bottom-1 bg-black/75 text-white text-[8px] font-mono px-1.5 py-0.5 rounded">
                              {uploadFileName ? uploadFileName.slice(0, 20) + '...' : 'Scan Loaded'}
                            </div>
                          </div>
                        ) : (
                          <>
                            <Upload className="w-6 h-6 text-gray-450 mb-1" />
                            <p className="text-[10px] font-bold text-gray-700 uppercase tracking-wider">Drag or Tap to Upload</p>
                            <p className="text-[8px] text-gray-400 mt-0.5">JPG / PNG photograph of the item</p>
                          </>
                        )}
                      </div>
                    )}

                    {imageMode === 'camera' && (
                      <div className="w-full text-center space-y-2">
                        {isCameraActive ? (
                          <div className="relative rounded-lg overflow-hidden bg-black mx-auto max-w-[260px] aspect-video border border-gray-300">
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
                                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer"
                              >
                                <Camera className="w-3 h-3" />
                                <span>Snap Pic</span>
                              </button>
                              <button
                                type="button"
                                onClick={stopCamera}
                                className="px-2 py-1 bg-gray-800 text-white hover:bg-black rounded-lg text-[9px]"
                              >
                                Stop
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="p-4">
                            <Camera className="w-8 h-8 text-teal-600 mx-auto" />
                            <button
                              type="button"
                              onClick={startCamera}
                              className="mt-2.5 px-3 py-1.5 bg-gray-900 hover:bg-black text-white text-[9px] font-bold uppercase tracking-wider rounded-lg cursor-pointer"
                            >
                              Initialize Web Camera
                            </button>
                            {cameraError && (
                              <p className="text-[10px] text-red-500 mt-1.5 font-semibold">{cameraError}</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex justify-end gap-2 pt-2 border-t border-rose-100">
                <button
                  type="button"
                  onClick={() => { setIsAdding(false); stopCamera(); }}
                  className="px-3.5 py-1.5 border border-gray-250 hover:bg-gray-50 text-gray-700 text-[10px] font-bold uppercase tracking-wider rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!title.trim()}
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white text-[10px] font-bold uppercase tracking-wider rounded-xl cursor-pointer shadow-xs active:scale-95 transition-all"
                >
                  Confirm Favorite Detail
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* List Type Segment Picker: Likes vs Wishlist */}
      <div className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center">
        <div className="flex bg-gray-100 border border-gray-150 p-1.5 rounded-2xl w-full sm:w-auto sm:min-w-[380px] select-none">
          <button
            onClick={() => { setListSection('all'); setSelectedCategory('All'); }}
            className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer text-center ${
              listSection === 'all'
                ? 'bg-white text-gray-950 shadow-xs'
                : 'text-gray-500 hover:text-gray-850'
            }`}
          >
            All ({favorites.length})
          </button>
          <button
            onClick={() => { setListSection('liked'); setSelectedCategory('All'); }}
            className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer text-center flex items-center justify-center gap-1.5 ${
              listSection === 'liked'
                ? 'bg-white text-rose-600 shadow-xs'
                : 'text-gray-500 hover:text-gray-850'
            }`}
          >
            <Heart className="w-3.5 h-3.5 fill-rose-500 text-rose-500" />
            <span>Owned ({favorites.filter(f => f.isWishlist !== true).length})</span>
          </button>
          <button
            onClick={() => { setListSection('wishlist'); setSelectedCategory('All'); }}
            className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer text-center flex items-center justify-center gap-1.5 ${
              listSection === 'wishlist'
                ? 'bg-white text-indigo-650 shadow-xs font-extrabold'
                : 'text-gray-550 hover:text-gray-850'
            }`}
          >
            <Gift className="w-3.5 h-3.5 text-indigo-500 fill-indigo-100" />
            <span>Wishlist ({favorites.filter(f => f.isWishlist === true).length})</span>
          </button>
        </div>

        <div className="text-[11px] text-gray-400 font-mono tracking-wide">
          {listSection === 'all' && 'Showing all catalog items'}
          {listSection === 'liked' && 'Showing things they own & love'}
          {listSection === 'wishlist' && 'Showing birthday & upcoming gift ideas'}
        </div>
      </div>

      {/* Interactive Category Filter Menu */}
      <div className="flex flex-wrap gap-1.5 bg-gray-50 border border-gray-150 p-1.5 rounded-xl text-xs font-medium w-full overflow-x-auto select-none">
        <button
          onClick={() => setSelectedCategory('All')}
          className={`px-3 py-1.5 rounded-lg text-[9.5px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
            selectedCategory === 'All' 
              ? 'bg-rose-600 text-white shadow-xs' 
              : 'text-gray-550 hover:text-gray-850 hover:bg-gray-100'
          }`}
        >
          View All ({sectionFiltered.length})
        </button>

        {CATEGORIES.map(categoryName => {
          const count = sectionFiltered.filter(f => f.category === categoryName).length;
          return (
            <button
              key={categoryName}
              onClick={() => setSelectedCategory(categoryName)}
              className={`px-3 py-1.5 rounded-lg text-[9.5px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                selectedCategory === categoryName 
                  ? 'bg-rose-600 text-white shadow-xs' 
                  : 'text-gray-550 hover:text-gray-850 hover:bg-gray-100'
              }`}
            >
              {categoryName}s ({count})
            </button>
          );
        })}
      </div>

      {/* Grid of Favorite Card Items */}
      {filteredFavorites.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-gray-200 rounded-2xl bg-white p-5 space-y-3 font-sans">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-500 border border-rose-100 flex items-center justify-center mx-auto">
            <Heart className="w-6 h-6" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h4 className="text-xs font-bold text-gray-900 uppercase tracking-widest">
              No Favorite items registered in {selectedCategory}
            </h4>
            <p className="text-xs text-gray-500 font-light leading-relaxed">
              Maintain photographic scans, dimensions, color preferences, and store links of things {member.name} loves. Useful for sizing references, holiday shopping guides, and packing sheets.
            </p>
          </div>
          <button
            onClick={() => setIsAdding(true)}
            className="px-3 py-1.5 bg-gray-950 hover:bg-black text-white text-[10px] font-bold uppercase tracking-wider rounded-xl cursor-pointer"
          >
            Add {member.name}&apos;s First Favorite
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5 font-sans">
          {filteredFavorites.map((item) => (
            <div 
              key={item.id}
              className={`bg-white border rounded-2xl shadow-xs hover:shadow-xs transition-all overflow-hidden flex flex-col group relative ${
                item.isWishlist 
                  ? item.bought 
                    ? 'border-emerald-200 bg-emerald-50/10' 
                    : 'border-indigo-150 bg-indigo-50/5' 
                  : 'border-gray-150'
              }`}
            >
              {/* Card visual rendering */}
              <div className="aspect-video relative overflow-hidden bg-gray-50 border-b border-gray-100 shrink-0">
                <img 
                  src={item.imageUrl} 
                  alt={item.title} 
                  className="w-full h-full object-cover group-hover:scale-103 transition-transform duration-300"
                  referrerPolicy="no-referrer"
                />

                {/* Overlaid category tag */}
                <div className="absolute top-2 left-2 bg-black/75 backdrop-blur-xs text-[8px] font-bold uppercase tracking-wider text-white px-2 py-0.5 rounded-md flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-rose-400 rounded-full inline-block"></span>
                  {item.category}
                </div>

                {/* Overlaid Wishlist badge */}
                {item.isWishlist && (
                  <div className={`absolute top-2 right-2 backdrop-blur-xs text-[8.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md flex items-center gap-1 border shadow-xs ${
                    item.bought
                      ? 'bg-emerald-600 border-emerald-500 text-white'
                      : 'bg-indigo-600 border-indigo-500 text-white'
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

                {/* Overlaid view action button */}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <button
                    onClick={() => setViewingItem(item)}
                    className="p-2 bg-white text-gray-950 rounded-xl font-bold uppercase text-[9px] hover:bg-gray-150 active:scale-95 transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Zoom Detail</span>
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="p-2 bg-red-650 text-white rounded-xl text-[9px] hover:bg-red-700 active:scale-95 transition-all cursor-pointer"
                    title="Remove Favorite"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Card Title & notes */}
              <div className="p-4 flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between gap-1.5">
                    <h4 className="text-xs sm:text-sm font-bold text-gray-950 truncate uppercase tracking-wider">
                      {item.title}
                    </h4>
                    {item.isWishlist && item.targetPrice && (
                      <span className="shrink-0 font-mono text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                        {item.targetPrice.startsWith('€') || item.targetPrice.startsWith('$') ? item.targetPrice : `€${item.targetPrice}`}
                      </span>
                    )}
                  </div>
                  {item.notes ? (
                    <p className="text-[11px] text-gray-500 mt-1 lines-clamp-2 leading-relaxed font-light">
                      {item.notes}
                    </p>
                  ) : (
                    <p className="text-[10px] text-gray-450 italic mt-1 font-light">No notes logged yet.</p>
                  )}
                </div>

                <div className="border-t border-gray-50 pt-2.5 mt-2.5 flex items-center justify-between text-[9px] text-gray-400 font-medium tracking-wider uppercase font-mono">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-gray-400" />
                    Added: {item.addedAt}
                  </span>
                  
                  {/* Quick-action bought switcher and shop link */}
                  <div className="flex items-center gap-1.5">
                    {item.isWishlist && (
                      <button
                        onClick={(e) => toggleBought(item.id, e)}
                        className={`px-2 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider transition-all border cursor-pointer ${
                          item.bought
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                            : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                        }`}
                        title={item.bought ? 'Mark as wanted' : 'Mark as secured (bought)'}
                      >
                        {item.bought ? 'Secured' : 'Get Item'}
                      </button>
                    )}

                    {item.isWishlist && item.webLink && (
                      <a
                        href={item.webLink.startsWith('http') ? item.webLink : `https://${item.webLink}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1 hover:bg-gray-100 text-gray-400 hover:text-indigo-650 rounded transition-colors"
                        title="Open shopping page"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}

                    {!item.isWishlist && (
                      <span className="text-gray-400 flex items-center gap-0.5">
                        <Check className="w-3 h-3 text-rose-500" /> Loved
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Beautiful Zoom Overlay Modal */}
      <AnimatePresence>
        {viewingItem && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl overflow-hidden max-w-lg w-full shadow-2xl border border-gray-100 font-sans"
            >
              <div className="p-5 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                <div>
                  <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md border ${
                    viewingItem.isWishlist 
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-700' 
                      : 'text-rose-600 bg-rose-50 border border-rose-150'
                  }`}>
                    {viewingItem.isWishlist ? '🎁 Wishlist Gift Idea' : `${viewingItem.category} Favorite`}
                  </span>
                  <h3 className="text-sm font-bold text-gray-900 mt-2 uppercase tracking-wider">{viewingItem.title}</h3>
                </div>
                <button
                  onClick={() => setViewingItem(null)}
                  className="p-1.5 hover:bg-gray-150 text-gray-500 hover:text-gray-900 rounded-xl transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="aspect-video relative rounded-2xl overflow-hidden border border-gray-200 bg-gray-100 flex items-center justify-center">
                  <img 
                    src={viewingItem.imageUrl} 
                    alt={viewingItem.title} 
                    className="max-h-full max-w-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                </div>

                {/* Additional Wishlist Specs Block */}
                {viewingItem.isWishlist && (
                  <div className="p-3.5 rounded-xl bg-indigo-50/45 border border-indigo-100 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                        <Gift className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="font-extrabold text-indigo-950 uppercase tracking-wider text-[10px]">Christmas / Birthday Shopping State</p>
                        <p className="text-gray-500 text-[10px] uppercase font-mono mt-0.5">
                          Cost Estimate: <span className="text-gray-900 font-bold">{viewingItem.targetPrice ? (viewingItem.targetPrice.startsWith('€') || viewingItem.targetPrice.startsWith('$') ? viewingItem.targetPrice : `€${viewingItem.targetPrice}`) : 'Unspecified'}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => toggleBought(viewingItem.id)}
                        className={`px-3 py-1.5 text-[9.5px] font-bold uppercase tracking-wider rounded-lg transition-all border cursor-pointer ${
                          viewingItem.bought
                            ? 'bg-emerald-600 text-white border-emerald-500 shadow-xs'
                            : 'bg-white text-indigo-700 border-indigo-250 hover:bg-indigo-50'
                        }`}
                      >
                        {viewingItem.bought ? '✓ Secured' : '🎁 Secure Gift'}
                      </button>

                      {viewingItem.webLink && (
                        <a
                          href={viewingItem.webLink.startsWith('http') ? viewingItem.webLink : `https://${viewingItem.webLink}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1.5 bg-gray-900 hover:bg-black text-white rounded-lg text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>Buy Shop</span>
                        </a>
                      )}
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <h4 className="text-[10px] font-bold text-gray-450 uppercase tracking-widest">Specifications &amp; Shopping Notes</h4>
                  <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100 text-xs text-gray-700 leading-relaxed font-light">
                    {viewingItem.notes || <span className="italic text-gray-400">No favorite descriptions recorded. Edit record or add helpful details (sizing references, stores, flavors).</span>}
                  </div>
                </div>

                <div className="flex justify-between items-center text-[10px] text-gray-400 font-mono text-right border-t border-gray-100 pt-3">
                  <span>ID: {viewingItem.id}</span>
                  <span>Registered: {viewingItem.addedAt}</span>
                </div>
              </div>

              <div className="px-5 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-2">
                <button
                  onClick={() => handleDelete(viewingItem.id)}
                  className="px-3.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-650 text-[10px] font-bold uppercase tracking-wider rounded-xl cursor-pointer"
                >
                  Delete Item Reference
                </button>
                <button
                  onClick={() => setViewingItem(null)}
                  className="px-4 py-1.5 bg-gray-900 hover:bg-black text-white text-[10px] font-bold uppercase tracking-wider rounded-xl cursor-pointer animate-pulse"
                >
                  Keep &amp; Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
