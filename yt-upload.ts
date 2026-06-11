// Upload a finished video to the Tool Shed Tales channel via the Data API.
//
// ⚠️ AUDIT LOCK: until the YouTube API compliance audit clears
// (Marketing Plan/youtube-api-audit.md), videos uploaded via the API are
// PERMANENTLY locked private — they can never be made public, even in
// Studio. Until then this script refuses to upload without
// --i-understand-private-lock. Default behavior is a dry run that prints
// the exact request it would send.
//
// Usage:
//   npm run yt:upload -- --file "outputs/STOR008 - Title/Title.mp4" --meta meta.json
//        [--publish-at 2026-06-17T10:30:00Z] [--playlist <playlistId>]
//        [--thumbnail thumb.jpg] [--i-understand-private-lock]
//
// meta.json: { "title": "...", "description": "...", "tags": ["...", ...] }
// Every upload is created private + selfDeclaredMadeForKids (COPPA — see
// launch-plan.md §1.4); --publish-at schedules the go-live.

import 'dotenv/config';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const has = (name: string) => process.argv.includes(`--${name}`);

const file = arg('file');
const metaPath = arg('meta');
if (!file || !metaPath) {
  console.error('Required: --file <video.mp4> --meta <meta.json>. See header comment.');
  process.exit(1);
}
const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
  title: string;
  description: string;
  tags: string[];
};
const publishAt = arg('publish-at');
const playlistId = arg('playlist');
const thumbnail = arg('thumbnail');

const body = {
  snippet: {
    title: meta.title,
    description: meta.description,
    tags: meta.tags,
    categoryId: '27', // Education
    defaultLanguage: 'en',
  },
  status: {
    privacyStatus: 'private',
    selfDeclaredMadeForKids: true,
    ...(publishAt ? { publishAt } : {}),
  },
};

async function getAccessToken(): Promise<string> {
  const { refresh_token } = JSON.parse(readFileSync('.yt-tokens.json', 'utf8')) as { refresh_token: string };
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token,
      client_id: process.env.YT_CLIENT_ID!,
      client_secret: process.env.YT_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }),
  });
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(json)}`);
  return json.access_token;
}

async function main() {
  const size = statSync(file!).size;
  console.log(`Video:    ${file} (${(size / 1e6).toFixed(0)} MB)`);
  console.log(`Title:    ${body.snippet.title}`);
  console.log(`Tags:     ${meta.tags.length} tags`);
  console.log(`Status:   private, made-for-kids${publishAt ? `, scheduled ${publishAt}` : ' (no schedule)'}`);
  if (playlistId) console.log(`Playlist: ${playlistId}`);
  if (thumbnail) console.log(`Thumb:    ${thumbnail}`);

  if (!has('i-understand-private-lock')) {
    console.log('\nDRY RUN — no upload sent. videos.insert request body:');
    console.log(JSON.stringify(body, null, 2));
    console.log(
      '\n⚠️ API uploads are PERMANENTLY locked private until the compliance audit clears.' +
        '\nRe-run with --i-understand-private-lock to really upload.',
    );
    return;
  }

  const token = await getAccessToken();
  const headers = { Authorization: `Bearer ${token}` };

  // Resumable upload: create the session, then PUT the bytes.
  const session = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'X-Upload-Content-Length': String(size),
        'X-Upload-Content-Type': 'video/mp4',
      },
      body: JSON.stringify(body),
    },
  );
  if (!session.ok) throw new Error(`Session create failed: ${session.status} ${await session.text()}`);
  const uploadUrl = session.headers.get('location');
  if (!uploadUrl) throw new Error('No resumable upload URL returned.');

  console.log('\nUploading…');
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Length': String(size), 'Content-Type': 'video/mp4' },
    body: Readable.toWeb(createReadStream(file!)) as unknown as BodyInit,
    // @ts-expect-error Node fetch requires duplex for streamed bodies
    duplex: 'half',
  });
  if (!put.ok) throw new Error(`Upload failed: ${put.status} ${await put.text()}`);
  const video = (await put.json()) as { id: string };
  console.log(`Uploaded: https://youtu.be/${video.id}`);

  if (thumbnail) {
    const tn = await fetch(
      `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${video.id}`,
      { method: 'POST', headers: { ...headers, 'Content-Type': 'image/jpeg' }, body: readFileSync(thumbnail) },
    );
    console.log(tn.ok ? 'Thumbnail set.' : `Thumbnail failed: ${tn.status} ${await tn.text()}`);
  }

  if (playlistId) {
    const pl = await fetch('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId: video.id } },
      }),
    });
    console.log(pl.ok ? 'Added to playlist.' : `Playlist add failed: ${pl.status} ${await pl.text()}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
