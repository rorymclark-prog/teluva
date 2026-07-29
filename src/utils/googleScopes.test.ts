import assert from 'node:assert/strict';
import { driveScopeFor, DRIVE_FILE_SCOPE, DRIVE_READONLY_SCOPE } from './googleScopes';

// The whole point of googleScopes.ts: which Drive scope gets requested
// tracks whether the Picker has a developer key, not a flag anyone has to
// remember to flip. Get this backwards and either the folder browser breaks
// (file scope, no Picker) or the CASA-restricted scope never goes away
// (readonly scope, Picker key present and unused).

// --- no key configured: stays on the broad, CASA-restricted scope ---------
{
  assert.equal(driveScopeFor(undefined), DRIVE_READONLY_SCOPE);
  assert.equal(driveScopeFor(''), DRIVE_READONLY_SCOPE, 'an empty string is not a key');
}

// --- key configured: narrows to the per-file scope -------------------------
{
  assert.equal(driveScopeFor('AIzaSyExampleKey'), DRIVE_FILE_SCOPE);
}

// --- the two scopes are never accidentally the same string -----------------
{
  assert.notEqual(DRIVE_FILE_SCOPE, DRIVE_READONLY_SCOPE);
}

console.log('googleScopes.test.ts: all assertions passed');
