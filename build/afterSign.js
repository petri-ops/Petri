// electron-builder afterSign hook: notarize macOS .app bundles after signing.
// Activated only when APPLE_ID + APP_PASSWORD + NOTARIZE_TEAM_ID are all set.
// To enable locally:
//   export APPLE_ID="you@example.com"
//   export APP_PASSWORD="xxxx-xxxx-xxxx-xxxx"  // app-specific password from appleid.apple.com
//   export NOTARIZE_TEAM_ID="ABCDE12345"
const path = require('path');

exports.default = async function afterSign(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  const { APPLE_ID, APP_PASSWORD, NOTARIZE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APP_PASSWORD || !NOTARIZE_TEAM_ID) {
    console.log('[afterSign] skipping notarization: APPLE_ID / APP_PASSWORD / NOTARIZE_TEAM_ID not set');
    return;
  }

  const { notarize } = require('@electron/notarize');
  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`[afterSign] notarizing ${appPath} as ${APPLE_ID} (team ${NOTARIZE_TEAM_ID})`);

  await notarize({
    tool: 'notarytool',
    appBundleId: packager.appInfo.id,
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APP_PASSWORD,
    teamId: NOTARIZE_TEAM_ID,
  });

  console.log('[afterSign] notarization complete');
};
