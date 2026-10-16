// Without a Developer ID certificate, ad-hoc sign the macOS app so it launches on Apple
// Silicon (unsigned arm64 code is refused). With a certificate, electron-builder signs it.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin' || process.env.CSC_LINK) return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
    console.log('Ad-hoc signed', app);
  } catch (e) {
    console.warn('Ad-hoc signing failed:', e.message);
  }
};
