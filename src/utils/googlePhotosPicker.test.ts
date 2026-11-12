import assert from 'node:assert/strict';
import { pickGooglePhotos, safePhotoDownload, safePickerUri, googleDuration, waitForPhotos } from './googlePhotosPicker';
import { createFileOperationScope } from './fileOperationScope';
const session = { id: 'fixture-session', pickerUri: 'https://photos.google.com/picker/fixture', pollingConfig: { pollInterval: '2s', timeoutIn: '30s' } };
const item = (id = 'one') => ({ id, type: 'PHOTO', createTime: '2020-02-03T10:00:00Z', mediaFile: { baseUrl: 'https://lh3.googleusercontent.com/p/fixture', filename: `${id}.jpg`, mimeType: 'image/jpeg' } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const scope = createFileOperationScope(() => ['synthetic-family', 'synthetic-user']);
assert.equal(safePhotoDownload(item().mediaFile.baseUrl), 'https://lh3.googleusercontent.com/p/fixture=d');
assert.ok(safePickerUri('https://photos.google.com/u/0/picker/session'));
for (const url of ['http://lh3.googleusercontent.com/x', 'https://evil.test/x', 'https://lh3.googleusercontent.com.evil.test/x', 'https://token@lh3.googleusercontent.com/x', 'https://lh3.googleusercontent.com:444/x', 'https://lh3.googleusercontent.com/x?secret=y']) assert.throws(() => safePhotoDownload(url));
for (const url of ['https://evil.test/picker/a', 'https://photos.google.com.evil.test/picker/a', 'https://photos.google.com/account', 'http://photos.google.com/picker/a']) assert.throws(() => safePickerUri(url));
assert.equal(googleDuration('1.5s', 0), 1500); assert.equal(googleDuration('0s', 20), 0); assert.equal(googleDuration('-1s', 20), 20);
{
  const calls: string[] = [], delays: number[] = []; let clock = 0;
  const photos = await pickGooglePhotos({ token: 'fixture-token', scope, signal: new AbortController().signal, now: () => clock,
    onPicker: uri => assert.equal(uri, session.pickerUri), wait: async ms => { delays.push(ms); clock += ms; },
    fetch: async (input, options) => {
      const url = String(input); calls.push(`${options?.method || 'GET'} ${url}`);
      assert.equal((options?.headers as any).Authorization, 'Bearer fixture-token');
      assert.equal(options?.redirect, 'error'); assert.equal(options?.credentials, 'omit');
      if (options?.method === 'POST') { assert.deepEqual(JSON.parse(String(options.body)), { pickingConfig: { maxItemCount: '20' } }); return json(session); }
      if (options?.method === 'DELETE') return new Response(null, { status: 204 });
      if (url.includes('/sessions/')) return json({ ...session, mediaItemsSet: true });
      if (url.includes('/mediaItems?')) return json({ mediaItems: [item()] });
      assert.equal(url, item().mediaFile.baseUrl + '=d');
      return new Response('synthetic image bytes', { headers: { 'content-type': 'image/jpeg' } });
    },
  });
  assert.equal(photos.length, 1); assert.equal(photos[0].file.name, 'one.jpg'); assert.equal(photos[0].captureTime, item().createTime);
  assert.deepEqual(delays, [2000]); assert.ok(calls.at(-1)?.startsWith('DELETE '), 'delete the exact selected session after reading bytes');
}
{
  const controller = new AbortController(), calls: string[] = [];
  await assert.rejects(() => pickGooglePhotos({ token: 'fixture', scope, signal: controller.signal, onPicker: () => controller.abort(),
    fetch: async (input, options) => { calls.push(options?.method || 'GET'); return options?.method === 'POST' ? json(session) : new Response(null, { status: 204 }); },
  }), /abort/i);
  assert.deepEqual(calls, ['POST', 'DELETE'], 'stop cancels polling but still cleans up its own Google session');
}
{
  let clock = 0, reads = 0;
  await assert.rejects(() => pickGooglePhotos({ token: 'fixture', scope, signal: new AbortController().signal, now: () => clock, onPicker: () => {}, wait: async ms => { clock += ms; },
    fetch: async (_, options) => {
      if (options?.method === 'DELETE') return new Response(null, { status: 204 });
      reads++; return json({ ...session, pollingConfig: { timeoutIn: '0s' } });
    },
  }), /timed out/);
  assert.equal(reads, 1, 'Google zero timeout is respected without another poll');
}
{
  let downloads = 0, deleted = false;
  await assert.rejects(() => pickGooglePhotos({ token: 'fixture', scope, signal: new AbortController().signal, onPicker: () => {},
    fetch: async (input, options) => {
      if (options?.method === 'DELETE') { deleted = true; return new Response(null, { status: 204 }); }
      if (options?.method === 'POST') return json({ ...session, mediaItemsSet: true });
      if (String(input).includes('/mediaItems?')) return json({ mediaItems: Array.from({ length: 21 }, (_, i) => item(String(i))) });
      downloads++; return new Response('bytes');
    },
  }), /up to 20/);
  assert.equal(downloads, 0); assert.equal(deleted, true);
}
{
  let deleted = false;
  await assert.rejects(() => pickGooglePhotos({ token: 'fixture', scope, signal: new AbortController().signal, onPicker: () => {},
    fetch: async (input, options) => {
      if (options?.method === 'DELETE') { deleted = true; return new Response(null, { status: 204 }); }
      if (options?.method === 'POST') return json({ ...session, mediaItemsSet: true });
      if (String(input).includes('/mediaItems?')) return json({ mediaItems: [item()] });
      return new Response('small actual body', { headers: { 'content-length': String(21 * 1024 * 1024) } });
    },
  }), /too large/);
  assert.equal(deleted, true);
}
{
  let identity = 'family-one'; const changing = createFileOperationScope(() => [identity]); let bytesRead = false;
  await assert.rejects(() => pickGooglePhotos({ token: 'fixture', scope: changing, signal: new AbortController().signal, onPicker: () => {},
    fetch: async (input, options) => {
      if (options?.method === 'DELETE') return new Response(null, { status: 204 });
      if (options?.method === 'POST') return json({ ...session, mediaItemsSet: true });
      if (String(input).includes('/mediaItems?')) { identity = 'family-two'; return json({ mediaItems: [item()] }); }
      bytesRead = true; return new Response('bytes');
    },
  }), /account, space/);
  assert.equal(bytesRead, false, 'no downloads or adoption after account/space changes');
}
{
  const controller = new AbortController(); const waiting = waitForPhotos(60000, controller.signal); controller.abort();
  await assert.rejects(() => waiting, /cancelled/);
}
console.log('googlePhotosPicker: scoped selection, polling, cleanup, URL fencing, limits, cancellation and account changes passed');
