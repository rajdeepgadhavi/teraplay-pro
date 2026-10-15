/**
 * Master Resolver Coordinator
 * Tries the high-speed reverse-engineered iTeraPlay resolver first,
 * and seamlessly falls back to Direct TeraBox & Mirror resolvers.
 */

const { resolveIteraPlay } = require('./iteraplay');
const { resolveDirectTeraBox } = require('./terabox_direct');

async function resolveLink(url, action = 'stream') {
  if (!url || typeof url !== 'string' || !url.trim()) {
    return {
      status: 'error',
      message: 'Please provide a valid TeraBox link.'
    };
  }

  const endpoint = action === 'download' ? '/api/download' : '/api/stream';

  // Strategy 1: iTeraPlay Backend
  try {
    const iteraRes = await resolveIteraPlay(url.trim(), endpoint);
    if (iteraRes.success && iteraRes.list && iteraRes.list.length > 0) {
      return {
        status: 'success',
        provider: 'iteraplay',
        list: iteraRes.list,
        total_folders: iteraRes.total_folders,
        zip_download_link: iteraRes.zip_download_link
      };
    }
  } catch (err) {
    console.warn('[Resolver] iTeraPlay engine failed:', err.message);
  }

  // Strategy 2: Direct TeraBox API
  try {
    const directRes = await resolveDirectTeraBox(url.trim());
    if (directRes.success && directRes.list && directRes.list.length > 0) {
      return {
        status: 'success',
        provider: 'terabox_direct',
        list: directRes.list,
        total_folders: directRes.total_folders,
        zip_download_link: directRes.zip_download_link
      };
    }
  } catch (err) {
    console.warn('[Resolver] Direct engine failed:', err.message);
  }

  return {
    status: 'error',
    message: 'Could not resolve this TeraBox link. Please verify that the link exists, is publicly accessible, and has not expired.'
  };
}

module.exports = {
  resolveLink
};
