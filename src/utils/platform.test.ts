import { isAppleTouchDevice, emptyClipboardAdvice, emptyPasteAdvice, copiedNameOnlyAdvice, composerHint } from './platform';

let passed = 0;
const fails: string[] = [];
const check = (n: string, c: boolean) => { c ? passed++ : fails.push(n); };

const IPAD_OS13 = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const IPAD_LEGACY = 'Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X) AppleWebKit/605.1.15 Version/12.0 Mobile/15E148 Safari/604.1';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36';

// THE CASE THIS FILE EXISTS FOR: a modern iPad identifies as a Macintosh, so
// a UA test for "iPad" misses every iPad made since 2019. Touch points are
// what tell the two apart.
check('modern iPad (Mac UA, 5 touch points) is Apple touch', isAppleTouchDevice(IPAD_OS13, 'MacIntel', 5));
check('a real Mac with the same UA is NOT', !isAppleTouchDevice(MAC, 'MacIntel', 0));
check('a Mac with a touch bar / trackpad still reports 0', !isAppleTouchDevice(MAC, 'MacIntel', 0));
check('legacy iPad UA still matches', isAppleTouchDevice(IPAD_LEGACY, 'iPad', 5));
check('iPhone matches', isAppleTouchDevice(IPHONE, 'iPhone', 5));
check('Windows does not match', !isAppleTouchDevice(WIN, 'Win32', 0));
check('a Windows touchscreen laptop does not match', !isAppleTouchDevice(WIN, 'Win32', 10));
check('Android does not match', !isAppleTouchDevice(ANDROID, 'Linux armv8l', 5));
check('missing values never throw', !isAppleTouchDevice('', '', 0));
// Device emulation overrides the user agent but NOT navigator.platform, so an
// emulated phone on a Mac reports an Android UA with platform "MacIntel" and 5
// touch points. Without the explicit non-Apple check that matched the iPad
// rule and showed iPad wording in an Android viewport.
check('an emulated Android viewport on a Mac is NOT an iPad', !isAppleTouchDevice(ANDROID, 'MacIntel', 5));
check('an emulated Windows viewport on a Mac is NOT an iPad', !isAppleTouchDevice(WIN, 'MacIntel', 5));
check('a ChromeOS tablet is not an iPad', !isAppleTouchDevice('Mozilla/5.0 (X11; CrOS x86_64) Chrome/126', 'MacIntel', 5));
check('undefined-ish touch count is treated as none', !isAppleTouchDevice(MAC, 'MacIntel', undefined as unknown as number));

// The advice must differ, and the Apple one must NOT blame the user for a
// copy that actually worked.
check('apple advice names the paperclip', /paperclip/.test(emptyClipboardAdvice(true)));
check('apple advice does not tell them to copy again', !/copy one first/.test(emptyClipboardAdvice(true)));
check('desktop advice is the plain one', /copy one first/.test(emptyClipboardAdvice(false)));

// REGRESSION GUARD, and a record of getting this wrong twice in both
// directions. v257 said a copied file "never reaches the page" — a platform
// claim that was false on a Mac. v259 corrected too far and told iPhone users
// to hold in the message box and choose Paste — true on a Mac, and on a phone
// it offers Paste and then hands over an empty clipboard, because iOS puts a
// file PROMISE on the pasteboard rather than the bytes.
//
// So: name no gesture on a phone that does not exist, and promise nothing
// about a Mac here either. Route them to the picker, which always works.
check('apple advice does not invent a phone paste gesture', !/hold in the message box/i.test(emptyClipboardAdvice(true)));
check('apple advice sends them to the picker', /paperclip/.test(emptyClipboardAdvice(true)));
check('apple advice scopes the button limit to the button', /Paste button/.test(emptyClipboardAdvice(true)));

// The empty-paste message is separate: the paste DID fire, so it must not
// suggest trying the same gesture again, and it must not name a cause the
// code cannot observe (v259 blamed an in-app browser at a home-screen PWA).
check('empty-paste advice differs by platform', emptyPasteAdvice(true) !== emptyPasteAdvice(false));
check('empty-paste advice on apple contrasts with the Mac', /Mac/.test(emptyPasteAdvice(true)));
check('empty-paste advice names no cause it cannot see', !/built-in browser|Safari|Chrome/.test(emptyPasteAdvice(true)));
check('empty-paste advice does not re-suggest pasting', !/tap Paste|choose Paste/i.test(emptyPasteAdvice(true)));
check('desktop empty-paste advice stays neutral', !/iPhone|iPad|Mac/.test(emptyPasteAdvice(false)));

// A pasted NAME is a different failure from a Paste button that came back
// empty — the user already made the right gesture, so this one must not send
// them back to it.
check('name-only advice does not re-recommend the paste button', !/Paste button/.test(copiedNameOnlyAdvice(true)));
check('name-only advice offers a route on apple', /paperclip/.test(copiedNameOnlyAdvice(true)));
check('name-only advice mentions Finder on desktop', /Finder/.test(copiedNameOnlyAdvice(false)));
check('the two messages are not the same string', emptyClipboardAdvice(true) !== copiedNameOnlyAdvice(true));
check('hint drops Ctrl+V on apple touch', !/Ctrl/.test(composerHint(true)));
check('hint keeps Ctrl+V on desktop', /Ctrl\+V/.test(composerHint(false)));
check('desktop hint mentions dragging', /drag/.test(composerHint(false)));
check('both hints mention Apply', /Apply/.test(composerHint(true)) && /Apply/.test(composerHint(false)));

if (fails.length) {
  console.error(`platform: ${fails.length} FAILED of ${passed + fails.length}`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`platform: ${passed} assertions passed`);
