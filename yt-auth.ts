// One-time YouTube OAuth bootstrap.
//
// Prereqs (see Marketing Plan/youtube-api-setup.md):
//   - YT_CLIENT_ID + YT_CLIENT_SECRET in .env (Desktop-app OAuth client)
// Run:  npm run yt:auth
// Then: pick the **Tool Shed Tales brand account** in the browser chooser —
//       the tokens are scoped to whichever channel identity you select.
// Saves refresh token to .yt-tokens.json (gitignored).

import 'dotenv/config';
import http from 'node:http';
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const CLIENT_ID = process.env.YT_CLIENT_ID;
const CLIENT_SECRET = process.env.YT_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing YT_CLIENT_ID / YT_CLIENT_SECRET in .env — do the Cloud Console steps first.');
  process.exit(1);
}

const PORT = 8090;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;
// youtube: read catalog + update titles/descriptions/tags (the A/B lever)
// yt-analytics.readonly: impressions/CTR/retention/traffic-source reports
const SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
].join(' ');

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent', // force a refresh_token even on re-auth
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', REDIRECT_URI);
  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400).end('No auth code in callback — check the terminal and retry.');
    return;
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  const tokens = (await tokenRes.json()) as Record<string, string>;

  if (!tokens.refresh_token) {
    res.writeHead(500).end('Token exchange failed — see terminal.');
    console.error('No refresh_token in response:', JSON.stringify(tokens, null, 2));
    server.close();
    process.exit(1);
  }

  writeFileSync('.yt-tokens.json', JSON.stringify(tokens, null, 2));
  res.end('Authorized — you can close this tab.');

  // Verify which channel identity was actually authorized.
  const ch = (await (
    await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
  ).json()) as { items?: Array<{ snippet: { title: string } }> };
  const title = ch.items?.[0]?.snippet?.title ?? 'UNKNOWN';
  console.log(`\nSaved .yt-tokens.json — authorized channel: "${title}"`);
  if (!/tool shed/i.test(title)) {
    console.warn(
      '⚠️  That does not look like the Tool Shed Tales brand channel. ' +
        'Re-run npm run yt:auth and pick the brand account in the chooser.',
    );
  }
  server.close();
});

server.listen(PORT, () => {
  console.log('Opening browser… choose the **Tool Shed Tales** brand account when Google asks which identity to use.');
  console.log('If the app shows an "unverified" warning: Advanced → Go to <app name> → Allow.');
  console.log(`\nIf the browser does not open, visit:\n${authUrl}\n`);
  try {
    execSync(`open "${authUrl}"`);
  } catch {
    /* manual URL printed above */
  }
});
