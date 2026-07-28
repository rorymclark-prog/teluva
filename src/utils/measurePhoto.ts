// Client for the "measure from a photo" endpoint (server.js POST /api/measure).
// This function never writes anything itself — every caller must show the
// reading to the human and require an explicit action before it touches a
// saved field (see GrowthTracker.tsx / MemberSizing.tsx). Re-exports the pure
// types/helpers from measureReading.ts so components only need one import.
import { auth } from '../lib/firebase';
import { MeasureConfidence, MeasureResult, MeasureSourceKind } from './measureReading';

export * from './measureReading';

const SOURCE_KINDS: MeasureSourceKind[] = ['scale', 'size_label', 'ruler_or_growth_chart', 'tape_measure', 'unknown'];

function parseDataUrl(src: string): { mimeType: string; data: string } | null {
  const m = src.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
  return m ? { mimeType: m[1], data: m[2] } : null;
}

export async function measureFromPhoto(photoDataUrl: string): Promise<MeasureResult> {
  const parsed = parseDataUrl(photoDataUrl);
  if (!parsed) throw new Error('This photo could not be read — please try again.');
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in again.');
  const token = await user.getIdToken();
  const res = await fetch('/api/measure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ image: parsed }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Could not read the photo.');
  const sourceKind: MeasureSourceKind = SOURCE_KINDS.includes(data?.sourceKind) ? data.sourceKind : 'unknown';
  const confidence: MeasureConfidence = data?.confidence === 'high' || data?.confidence === 'medium' ? data.confidence : 'low';
  return {
    sourceKind,
    confidence,
    sawText: typeof data?.sawText === 'string' ? data.sawText : '',
    note: typeof data?.note === 'string' ? data.note : '',
    readings: data?.readings && typeof data.readings === 'object' ? data.readings : {},
  };
}
