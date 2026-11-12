import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { geoGraticule10 } from 'd3-geo';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Globe2, Map, Minus, Plus, RotateCcw } from 'lucide-react';
import type { TravelTimelineEntry } from '../types';
import { atlasCountries, atlasPath, atlasProjection, initialAtlasCamera, visibleAtlasPoint, type AtlasCamera } from '../utils/atlasGeometry';
import { atlasDateLabel, atlasKind, atlasTitle, hasAtlasPoint, validAtlasPoint } from '../utils/lifeAtlas';
import './LifeAtlas.css';

export default function LifeAtlasMap({ entries, selectedId, onSelect, onPlacePin }: {
  entries: TravelTimelineEntry[]; selectedId?: string; onSelect: (id: string) => void; onPlacePin?: (lat: number, lng: number) => void;
}) {
  const [mode, setMode] = useState<'globe' | 'map'>('globe');
  const [camera, setCamera] = useState<AtlasCamera>(initialAtlasCamera);
  const svg = useRef<SVGSVGElement>(null), drag = useRef<{ x: number; y: number; camera: AtlasCamera; moved: boolean } | null>(null);
  const frame = useRef<number | null>(null), pendingCamera = useRef(camera);
  const [displayWidth, setDisplayWidth] = useState(960);
  const id = useId().replace(/:/g, '');
  const selected = entries.find(entry => entry.id === selectedId);
  const cancelMotion = () => { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; drag.current = null; };
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  useEffect(() => {
    if (!svg.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => { if (entries[0]?.contentRect.width) setDisplayWidth(entries[0].contentRect.width); });
    observer.observe(svg.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!selected || !hasAtlasPoint(selected)) return;
    cancelMotion();
    setCamera(old => {
      if (mode === 'globe') return { ...old, longitude: selected.lng!, latitude: selected.lat! };
      const point = atlasProjection('map', { ...old, x: 0, y: 0 })([selected.lng!, selected.lat!])!;
      return { ...old, x: 480 - point[0], y: 280 - point[1] };
    });
  }, [selectedId, selected?.lat, selected?.lng, mode]);
  const path = useMemo(() => atlasPath(mode, camera), [mode, camera]);
  const points = entries.filter(hasAtlasPoint).flatMap(entry => {
    const point = visibleAtlasPoint(entry.lng!, entry.lat!, mode, camera);
    return point ? [{ entry, point }] : [];
  });
  const move = (x: number, y: number) => { cancelMotion(); setCamera(old => mode === 'globe'
    ? { ...old, longitude: old.longitude + x * 10, latitude: Math.max(-80, Math.min(80, old.latitude + y * 10)) }
    : { ...old, x: old.x - x * 60, y: old.y + y * 60 }); };
  const zoom = (factor: number) => { cancelMotion(); setCamera(old => ({ ...old, zoom: Math.max(0.7, Math.min(5, old.zoom * factor)) })); };
  const pointerPoint = (event: React.PointerEvent<SVGSVGElement>) => {
    const point = event.currentTarget.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const matrix = event.currentTarget.getScreenCTM();
    return matrix ? point.matrixTransform(matrix.inverse()) : { x: 0, y: 0 };
  };
  return <section className="life-atlas-map overflow-hidden rounded-3xl" aria-label="Life Atlas world view">
    <div className="atlas-map-toolbar">
      <div className="atlas-view-switch" role="group" aria-label="Atlas view">
        <button type="button" aria-pressed={mode === 'globe'} onClick={() => { cancelMotion(); setMode('globe'); setCamera(initialAtlasCamera); }}><Globe2 size={16} />3D globe</button>
        <button type="button" aria-pressed={mode === 'map'} onClick={() => { cancelMotion(); setMode('map'); setCamera(initialAtlasCamera); }}><Map size={16} />2D map</button>
      </div>
      <p>{onPlacePin ? 'Tap the map to place this memory' : `${points.length} visible · drag to explore`}</p>
    </div>
    <svg ref={svg} viewBox="0 0 960 560" role="group" tabIndex={0} aria-label={`Interactive ${mode === 'globe' ? 'globe' : 'world map'}. Use arrow keys to move and plus or minus to zoom.`}
      className={`atlas-world ${onPlacePin ? 'is-placing' : ''}`} onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
        if (directions[event.key]) { event.preventDefault(); move(...directions[event.key]); }
        if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.3); }
        if (event.key === '-') { event.preventDefault(); zoom(1 / 1.3); }
      }} onPointerDown={event => {
        if (event.button !== 0 || (event.target as Element).closest('[data-atlas-pin]')) return;
        const point = pointerPoint(event); drag.current = { ...point, camera, moved: false }; event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={event => {
        const start = drag.current; if (!start) return;
        const point = pointerPoint(event), dx = point.x - start.x, dy = point.y - start.y;
        if (Math.hypot(dx, dy) > 5) start.moved = true;
        pendingCamera.current = mode === 'globe'
          ? { ...start.camera, longitude: start.camera.longitude - dx * 0.25 / start.camera.zoom, latitude: Math.max(-85, Math.min(85, start.camera.latitude + dy * 0.25 / start.camera.zoom)) }
          : { ...start.camera, x: start.camera.x + dx, y: start.camera.y + dy };
        if (frame.current === null) frame.current = requestAnimationFrame(() => { setCamera(pendingCamera.current); frame.current = null; });
      }} onPointerUp={event => {
        const start = drag.current; drag.current = null;
        if (!start || start.moved || !onPlacePin) return;
        const point = pointerPoint(event);
        if (mode === 'globe' && Math.hypot(point.x - 480, point.y - 280) > 235 * camera.zoom) return;
        const position = atlasProjection(mode, camera).invert?.([point.x, point.y]);
        if (position && validAtlasPoint(position[1], position[0])) onPlacePin(Number(position[1].toFixed(5)), Number(position[0].toFixed(5)));
      }} onPointerCancel={() => { drag.current = null; }}>
      <defs>
        <radialGradient id={`ocean-${id}`} cx="35%" cy="30%"><stop stopColor="#233D51" /><stop offset="1" stopColor="#0B1A2B" /></radialGradient>
        <radialGradient id={`shade-${id}`} cx="30%" cy="25%" r="75%"><stop offset="0.55" stopColor="#000000" stopOpacity="0" /><stop offset="1" stopColor="#000000" stopOpacity="0.5" /></radialGradient>
        <clipPath id={`world-${id}`}><path d={path({ type: 'Sphere' }) || ''} /></clipPath>
      </defs>
      <path d={path({ type: 'Sphere' }) || ''} fill={`url(#ocean-${id})`} stroke="#557D91" strokeOpacity="0.45" />
      <g clipPath={`url(#world-${id})`}>
        {atlasCountries.features.map((country, index) => <path key={country.id || index} d={path(country) || ''} className="atlas-land" />)}
        <path d={path(geoGraticule10()) || ''} fill="none" stroke="#9DBAC6" strokeWidth="0.5" strokeOpacity="0.15" />
        {mode === 'globe' && <path d={path({ type: 'Sphere' }) || ''} fill={`url(#shade-${id})`} pointerEvents="none" />}
      </g>
      {points.map(({ entry, point }) => <g key={entry.id} data-atlas-pin="true" transform={`translate(${point[0]},${point[1]})`} role="button" tabIndex={0}
        aria-label={`${atlasTitle(entry)}, ${atlasDateLabel(entry)}`} aria-pressed={entry.id === selectedId}
        onPointerDown={event => event.stopPropagation()} onClick={() => onSelect(entry.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onSelect(entry.id); } }}
        className={`atlas-pin atlas-pin-${atlasKind(entry)} ${entry.id === selectedId ? 'is-selected' : ''}`}>
        <title>{atlasTitle(entry)} · {atlasDateLabel(entry)}</title><circle r={Math.max(20, 22 * 960 / displayWidth)} fill="transparent" /><circle className="atlas-pin-halo" r={entry.id === selectedId ? 15 : 10} /><circle className="atlas-pin-core" r={entry.id === selectedId ? 7 : 5} />
      </g>)}
    </svg>
    <div className="atlas-map-footer">
      <div className="atlas-legend"><span><i className="holiday" />Holidays</span><span><i className="home" />Homes</span><span><i className="event" />Events</span><span><i className="visit" />Visits</span></div>
      <div className="atlas-controls" role="group" aria-label="Map controls">
        <button type="button" aria-label="Move west" onClick={() => move(-1, 0)}><ChevronLeft size={16} /></button><button type="button" aria-label="Move east" onClick={() => move(1, 0)}><ChevronRight size={16} /></button>
        <button type="button" aria-label="Move north" onClick={() => move(0, 1)}><ChevronUp size={16} /></button><button type="button" aria-label="Move south" onClick={() => move(0, -1)}><ChevronDown size={16} /></button>
        <button type="button" aria-label="Zoom in" onClick={() => zoom(1.3)}><Plus size={16} /></button><button type="button" aria-label="Zoom out" onClick={() => zoom(1 / 1.3)}><Minus size={16} /></button>
        <button type="button" aria-label="Reset world view" onClick={() => { cancelMotion(); setCamera(initialAtlasCamera); }}><RotateCcw size={16} /></button>
      </div>
    </div>
    <p className="atlas-attribution">Natural Earth geography · map stays on your device · borders are illustrative</p>
  </section>;
}
