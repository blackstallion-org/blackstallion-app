// Learn more https://docs.expo.dev/guides/customizing-metro/
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * Release safety: in non-development bundles, '@/dev/preview' (synthetic
 * personas, fixtures, component gallery) resolves to an inert stub, so no
 * role-preview code is shipped at all — not merely unreachable.
 * Verified by `npm run check:release-bundle`.
 */
const RELEASE_STUB = path.resolve(__dirname, 'src/dev/preview.release.ts');
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (!context.dev && (moduleName === '@/dev/preview' || /(^|\/)dev\/preview$/.test(moduleName))) {
    return { type: 'sourceFile', filePath: RELEASE_STUB };
  }
  return upstream ? upstream(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
