import {
  getWingetIdFromName,
  findBestCuratedMatch,
  type CuratedAppMatch,
} from '@/lib/app-mappings';

describe('getWingetIdFromName', () => {
  it('does not match Microsoft Office to Mozilla.Firefox via the short alias "ff"', () => {
    expect(getWingetIdFromName('Microsoft Office')).not.toBe('Mozilla.Firefox');
  });

  it('matches Microsoft Office to Microsoft.Office', () => {
    expect(getWingetIdFromName('Microsoft Office')).toBe('Microsoft.Office');
  });

  it('still matches Firefox to Mozilla.Firefox', () => {
    expect(getWingetIdFromName('Firefox')).toBe('Mozilla.Firefox');
    expect(getWingetIdFromName('Mozilla Firefox')).toBe('Mozilla.Firefox');
  });

  it('still matches an exact short alias like "ff"', () => {
    expect(getWingetIdFromName('ff')).toBe('Mozilla.Firefox');
    expect(getWingetIdFromName('FF')).toBe('Mozilla.Firefox');
  });

  it('still matches other exact short aliases', () => {
    expect(getWingetIdFromName('7z')).toBe('7zip.7zip');
    expect(getWingetIdFromName('vlc')).toBe('VideoLAN.VLC');
    expect(getWingetIdFromName('git')).toBe('Git.Git');
    expect(getWingetIdFromName('npp')).toBe('Notepad++.Notepad++');
    expect(getWingetIdFromName('code')).toBe('Microsoft.VisualStudioCode');
  });

  it('does not fire the reciprocal includes branch for short names', () => {
    // Short names contained inside a winget id must no longer match:
    // "tea" is inside "microsoftteams" and "off" inside "microsoftoffice".
    expect(getWingetIdFromName('tea')).toBeNull();
    expect(getWingetIdFromName('off')).toBeNull();
  });

  it('still matches a name that contains a full winget id', () => {
    expect(getWingetIdFromName('Google Chrome (x64)')).toBe('Google.Chrome');
  });
});

describe('findBestCuratedMatch', () => {
  const curatedApps: CuratedAppMatch[] = [
    {
      wingetId: 'Mozilla.Firefox',
      name: 'Firefox',
      publisher: 'Mozilla',
      latestVersion: '128.0',
    },
    {
      wingetId: 'Google.Chrome',
      name: 'Google Chrome',
      publisher: 'Google',
      latestVersion: '126.0',
    },
  ];

  it('does not return a match on a bare name-substring plus version bonus', () => {
    // The curated name "firefox" is a substring of the search term:
    // 40 (search contains name) + 10 (version) = 50 previously crossed the
    // threshold without any exact/starts-with or publisher corroboration.
    expect(findBestCuratedMatch('Firefox Helper Service', null, curatedApps)).toBeNull();
  });

  it('returns a match for an exact name', () => {
    const match = findBestCuratedMatch('Firefox', null, curatedApps);
    expect(match?.wingetId).toBe('Mozilla.Firefox');
  });

  it('returns a match for a starts-with name', () => {
    const match = findBestCuratedMatch('Google', null, curatedApps);
    expect(match?.wingetId).toBe('Google.Chrome');
  });

  it('returns a substring match when corroborated by publisher', () => {
    const match = findBestCuratedMatch('Firefox ESR Deployment', 'Mozilla', curatedApps);
    expect(match?.wingetId).toBe('Mozilla.Firefox');
  });

  it('returns null when nothing matches', () => {
    expect(findBestCuratedMatch('Totally Unrelated App', 'Acme', curatedApps)).toBeNull();
  });
});
