/**
 * WinGet package existence check
 *
 * Validates that a WinGet ID actually exists in the winget community
 * repository before accepting it as an app suggestion. Users frequently
 * guess plausible-looking IDs (Adobe.AcrobatPro instead of Adobe.Acrobat.Pro)
 * which produced app-request issues that could never be fulfilled.
 */

export type WingetExistence = 'exists' | 'not-found' | 'unknown';

/**
 * Check whether a WinGet ID has a manifest directory in microsoft/winget-pkgs.
 *
 * Returns 'unknown' on rate limits or network failures so callers can decide
 * to fail open rather than block legitimate suggestions.
 *
 * Note: the GitHub contents API is case sensitive, so a miscased but otherwise
 * valid ID reports 'not-found'. Callers should treat 'not-found' as "verify
 * the exact ID" rather than "this app does not exist".
 */
export async function checkWingetPackageExists(
  wingetId: string
): Promise<WingetExistence> {
  const firstLetter = wingetId[0]?.toLowerCase();
  if (!firstLetter) return 'not-found';

  const manifestPath = wingetId.split('.').join('/');
  const url = `https://api.github.com/repos/microsoft/winget-pkgs/contents/manifests/${firstLetter}/${manifestPath}`;

  const headers: Record<string, string> = {
    'User-Agent': 'IntuneGet',
    Accept: 'application/vnd.github.v3+json',
  };
  // Authenticated requests get a much higher rate limit
  if (process.env.GITHUB_PAT) {
    headers.Authorization = `Bearer ${process.env.GITHUB_PAT}`;
  }

  try {
    const response = await fetch(url, { headers });
    if (response.status === 200) return 'exists';
    if (response.status === 404) return 'not-found';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
