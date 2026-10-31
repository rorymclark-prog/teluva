import crypto from 'node:crypto';
import { PUBLISH_MODES, publicationState } from './calendarPublish.mjs';
import { includesCalendarOccasions } from './spaceSharing.mjs';

/** Management always uses the authorized requested space. Public feed reads
 * still use the stored familyId/createdBy, including that creator's hide list. */
export function createCalendarPublicationHandlers({ member, readSpaceInfo, readPublication, writePublication, listPublications, makeToken = () => crypto.randomBytes(32).toString('base64url'), now = () => new Date(), logError = console.error }) {
  const failure = (res, route, error, message) => {
    logError(`/api/calendar-publish/${route} error:`, error);
    return res.status(500).json({ error: message });
  };
  return {
    create: async (req, res) => {
      try {
        const caller = await member(req);
        if (caller.error) return res.status(caller.status).json({ error: caller.error });
        if (caller.role === 'child') return res.status(403).json({ error: 'Only adults can publish calendar links.' });
        const body = req.body || {};
        const mode = PUBLISH_MODES.includes(body.mode) ? body.mode : 'details';
        const label = typeof body.label === 'string' ? body.label.trim().slice(0, 80) : '';
        const includeOccasions = includesCalendarOccasions(await readSpaceInfo(caller.familyId), { mode, includeOccasions: body.includeOccasions });
        const token = makeToken();
        await writePublication(token, {
          familyId: caller.familyId, createdBy: caller.uid, createdByName: caller.displayName || '',
          createdAt: now().toISOString(), mode, label, includeOccasions, revoked: false, fetchCount: 0,
        });
        return res.json({ ok: true, spaceId: caller.familyId, token, path: `/cal/${token}.ics`, mode, includeOccasions });
      } catch (error) { return failure(res, 'create', error, 'Could not create the calendar link. Please try again.'); }
    },
    list: async (req, res) => {
      try {
        const caller = await member(req);
        if (caller.error) return res.status(caller.status).json({ error: caller.error });
        const records = await listPublications(caller.familyId);
        const links = records.filter(record => record.familyId === caller.familyId && publicationState(record) === 'active').map(record => ({
          token: record.id, path: `/cal/${record.id}.ics`, mode: record.mode || 'details', label: record.label || '',
          includeOccasions: record.includeOccasions === true, createdAt: record.createdAt || '', createdByName: record.createdByName || '',
          lastFetchedAt: record.lastFetchedAt || null, fetchCount: record.fetchCount || 0,
        })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return res.json({ spaceId: caller.familyId, links });
      } catch (error) { return failure(res, 'list', error, 'Could not load your calendar links.'); }
    },
    revoke: async (req, res) => {
      try {
        const caller = await member(req);
        if (caller.error) return res.status(caller.status).json({ error: caller.error });
        if (caller.role === 'child') return res.status(403).json({ error: 'Only adults can change calendar links.' });
        const token = typeof req.body?.token === 'string' ? req.body.token.slice(0, 200) : '';
        if (!token || token.includes('/') || /[\x00-\x1f\x7f]/.test(token)) return res.status(400).json({ error: 'Missing or invalid link id.' });
        const record = await readPublication(token);
        if (!record) return res.json({ ok: true, spaceId: caller.familyId });
        if (record.familyId !== caller.familyId) return res.status(403).json({ error: 'That link is not yours.' });
        await writePublication(token, { revoked: true, revokedAt: now().toISOString() });
        return res.json({ ok: true, spaceId: caller.familyId });
      } catch (error) { return failure(res, 'revoke', error, 'Could not turn that link off.'); }
    },
  };
}
