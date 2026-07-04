// M2-11 (H4)：mac 签名后 notarize + staple
// electron-builder 在 afterSign 阶段调用此 hook。
// 需 CI 注入环境变量：APPLE_ID / APP_PASSWORD / TEAM_ID
// 无证书时（本地构建）此 hook 不执行 notarize（identity=null 跳过签名）。
const { notarize } = require('@electron/notarize');

exports.default = async function afterSign(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  // 无签名身份时跳过（本地未签名构建）
  const appleId = process.env.APPLE_ID;
  const appPassword = process.env.APP_PASSWORD;
  const teamId = process.env.NOTARIZE_TEAM_ID;
  if (!appleId || !appPassword || !teamId) {
    console.log('[afterSign] skipping notarize — no Apple credentials in env');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`[afterSign] notarizing ${appPath}...`);
  await notarize({
    appBundleId: context.packager.appInfo.id,
    appPath,
    appleId,
    appPassword,
    teamId,
  });
  console.log('[afterSign] notarization complete');

  // Staple the ticket
  const { execSync } = require('child_process');
  try {
    execSync(`xcrun stapler staple "${appPath}"`, { stdio: 'inherit' });
    console.log('[afterSign] staple complete');
  } catch (e) {
    console.warn('[afterSign] staple failed:', e.message);
  }
};
