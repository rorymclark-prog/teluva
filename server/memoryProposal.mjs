import { isValidTimelineDate } from './timelineParse.mjs';
export const MEMORY_CATEGORIES = ['memory', 'milestone', 'holiday', 'home', 'school', 'medical', 'other'];
export const MEMORY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'date', 'category', 'evidenceQuote'], properties: {
    title: { type: 'string', minLength: 1, maxLength: 180 }, date: { type: 'string', maxLength: 10, description: 'Recorded event date, or empty when unknown. Never use upload time.' },
    datePrecision: { enum: ['month', 'year'] }, category: { enum: MEMORY_CATEGORIES }, note: { type: 'string', maxLength: 4000 }, place: { type: 'string', maxLength: 200 },
    memberIds: { type: 'array', maxItems: 50, uniqueItems: true, items: { type: 'string', maxLength: 100 } },
    evidenceQuote: { type: 'string', minLength: 1, maxLength: 1500, description: 'An exact excerpt from the named source text, not a model paraphrase.' },
    atlas: { type: 'object', additionalProperties: false, required: ['kind'], description: 'Only when this is a meaningful place/experience. Saves to Atlas, which is already shown in the family timeline; no duplicate timeline row.', properties: {
      kind: { enum: ['holiday', 'home', 'event', 'visit'] }, country: { type: 'string', maxLength: 100 }, lat: { type: 'number', minimum: -90, maximum: 90 }, lng: { type: 'number', minimum: -180, maximum: 180 },
    } },
  },
};
const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
export function sanitizeMemory(input, fail) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !Object.keys(MEMORY_SCHEMA.properties).includes(key))) fail(400, 'INVALID_IMPORT', 'Use supported memory details.');
  const output = {};
  for (const [key, max] of Object.entries({ title: 180, date: 10, note: 4000, place: 200, evidenceQuote: 1500 })) {
    if (input[key] === undefined && !['title', 'date', 'evidenceQuote'].includes(key)) continue;
    if (typeof input[key] !== 'string' || input[key].length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input[key])) fail(400, 'INVALID_IMPORT', 'A memory field is invalid or too long.');
    output[key] = input[key].trim();
  }
  if (!output.title || !output.evidenceQuote) fail(400, 'INVALID_IMPORT', 'Add a memory title and an exact source excerpt.');
  if (!MEMORY_CATEGORIES.includes(input.category)) fail(400, 'INVALID_IMPORT', 'Choose a supported memory category.');
  output.category = input.category;
  if (input.datePrecision !== undefined) {
    if (!['month', 'year'].includes(input.datePrecision)) fail(400, 'INVALID_IMPORT', 'Choose month or year precision, or an exact date.');
    output.datePrecision = input.datePrecision;
  }
  if (output.date && !isValidTimelineDate(output.date, output.datePrecision)) fail(400, 'INVALID_IMPORT', 'Use a real event date at its recorded accuracy, or leave it unknown.');
  if (input.memberIds !== undefined) {
    if (!Array.isArray(input.memberIds) || input.memberIds.length > 50 || input.memberIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(id))) fail(400, 'INVALID_IMPORT', 'Choose valid people for this memory.');
    output.memberIds = [...new Set(input.memberIds)];
  }
  if (input.atlas !== undefined) {
    const atlas = input.atlas;
    if (!atlas || typeof atlas !== 'object' || Array.isArray(atlas) || Object.keys(atlas).some(key => !['kind', 'country', 'lat', 'lng'].includes(key)) || !['holiday', 'home', 'event', 'visit'].includes(atlas.kind)) fail(400, 'INVALID_IMPORT', 'Choose a supported Atlas memory.');
    output.atlas = { kind: atlas.kind };
    if (atlas.country !== undefined) { if (typeof atlas.country !== 'string' || atlas.country.length > 100) fail(400, 'INVALID_IMPORT', 'Use a valid country name.'); output.atlas.country = atlas.country.trim(); }
    if (atlas.lat !== undefined || atlas.lng !== undefined) {
      if (typeof atlas.lat !== 'number' || typeof atlas.lng !== 'number' || !Number.isFinite(atlas.lat) || !Number.isFinite(atlas.lng) || Math.abs(atlas.lat) > 90 || Math.abs(atlas.lng) > 180) fail(400, 'INVALID_IMPORT', 'Use a valid pair of coordinates or leave the pin unknown.');
      output.atlas.lat = atlas.lat; output.atlas.lng = atlas.lng;
    }
  }
  return output;
}
export function assertMemoryEvidence(proposal, sourceText, fail) {
  if (proposal?.kind === 'memory' && (!sourceText || !normalize(sourceText).includes(normalize(proposal.memory.evidenceQuote)))) fail(400, 'MEMORY_EVIDENCE_REQUIRED', 'The memory excerpt must occur in its named source text.');
}
export const memoryIdentity = memory => ({ date: memory.date, quote: normalize(memory.evidenceQuote) });
