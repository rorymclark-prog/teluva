interface SpaceUser { uid: string; getIdToken: () => Promise<string> }
interface Options {
  getUser: () => SpaceUser | null;
  getSpace: () => string;
  fetch?: typeof fetch;
}

/** Bind a UI mutation to the visible account/space before token refresh can
 * yield. Response checks also prevent a late reply reaching another view. */
export function createScopedSpacePost(options: Options) {
  return async <T extends { spaceId?: string; error?: string }>(route: string, body: Record<string, unknown>, fallbackError: string, request: { method?: 'POST' | 'GET' | 'DELETE' } = {}): Promise<T> => {
    const user = options.getUser();
    const spaceId = options.getSpace();
    if (!user) throw new Error('Sign in before changing this space.');
    if (typeof spaceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(spaceId)) throw new Error('Choose an available space first.');
    const payload = { ...body, spaceId };
    const current = () => options.getUser()?.uid === user.uid && options.getSpace() === spaceId;
    const check = () => { if (!current()) throw new Error('Your account or space changed. Reload before trying this action again.'); };
    const token = await user.getIdToken();
    check();
    const method = request.method || 'POST';
    const response = await (options.fetch || fetch)(route, {
      method,
      cache: 'no-store',
      headers: { ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${token}`, 'x-teluva-space-id': spaceId },
      ...(method === 'GET' ? {} : { body: JSON.stringify(payload) }),
    });
    check();
    const data = await response.json().catch(() => ({})) as T;
    check();
    if (!response.ok) throw new Error(data.error || fallbackError);
    if (data.spaceId !== spaceId) throw new Error('The space response changed. Reload before trying this action again.');
    return data;
  };
}
