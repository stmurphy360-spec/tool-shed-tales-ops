// Pull the leading-indicator dashboard from the YouTube APIs.
//
// Metrics per Marketing Plan/evaluation-framework.md: avg % viewed,
// traffic-source mix, subs — NOT raw views as the headline.
// ⚠️ Thumbnail impressions + CTR are NOT exposed by any YouTube API
// (verified against the Analytics API metrics doc 2026-06-11) — those two
// must be read manually in Studio. Traffic-source RELATED_VIDEO/YT_SEARCH
// views are the best API-visible proxy for "is YouTube showing us."
// Run:  npm run yt:pull
// Output: console summary + Marketing Plan/reports/<date>-pull.md
//
// Note: YouTube Analytics lags ~24–48h, so "today" windows are partial.

import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const LAUNCH_DATE = '2026-06-01';
const REPORTS_DIR = path.join('Marketing Plan', 'reports');

interface Tokens {
  refresh_token: string;
}

async function getAccessToken(): Promise<string> {
  const { refresh_token } = JSON.parse(readFileSync('.yt-tokens.json', 'utf8')) as Tokens;
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
  const json = (await res.json()) as { access_token?: string; error?: string };
  if (!json.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(json)}`);
  return json.access_token;
}

let TOKEN = '';
async function api<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}\n${await res.text()}`);
  return (await res.json()) as T;
}

interface AnalyticsReport {
  columnHeaders: Array<{ name: string }>;
  rows?: Array<Array<string | number>>;
}

// Rows keyed by column name; returns [] (not a throw) when there's no data yet.
async function analytics(params: Record<string, string>): Promise<Array<Record<string, string | number>>> {
  const url =
    'https://youtubeanalytics.googleapis.com/v2/reports?' +
    new URLSearchParams({ ids: 'channel==MINE', ...params });
  const report = await api<AnalyticsReport>(url);
  const cols = report.columnHeaders.map((c) => c.name);
  return (report.rows ?? []).map((row) => Object.fromEntries(row.map((v, i) => [cols[i], v])));
}

const PER_VIDEO_METRICS = 'views,averageViewPercentage,estimatedMinutesWatched,subscribersGained';

async function perVideo(videoIds: string[], startDate: string, endDate: string) {
  return analytics({
    startDate,
    endDate,
    dimensions: 'video',
    filters: `video==${videoIds.join(',')}`,
    metrics: PER_VIDEO_METRICS,
  });
}

function fmtPct(v: unknown): string {
  return typeof v === 'number' ? `${v.toFixed(1)}%` : '–';
}

async function main() {
  TOKEN = await getAccessToken();
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);

  // Channel + uploads (Data API)
  const ch = await api<{
    items: Array<{
      snippet: { title: string };
      statistics: { subscriberCount: string; viewCount: string };
      contentDetails: { relatedPlaylists: { uploads: string } };
    }>;
  }>('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true');
  const channel = ch.items[0];
  const uploadsId = channel.contentDetails.relatedPlaylists.uploads;

  const videos: Array<{ id: string; title: string; published: string }> = [];
  let pageToken = '';
  do {
    const page = await api<{
      items: Array<{ snippet: { title: string; publishedAt: string; resourceId: { videoId: string } } }>;
      nextPageToken?: string;
    }>(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${uploadsId}${pageToken ? `&pageToken=${pageToken}` : ''}`,
    );
    for (const item of page.items) {
      videos.push({
        id: item.snippet.resourceId.videoId,
        title: item.snippet.title,
        published: item.snippet.publishedAt.slice(0, 10),
      });
    }
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  videos.sort((a, b) => a.published.localeCompare(b.published));

  if (videos.length === 0) {
    console.log('No public/scheduled-live videos found on the channel yet.');
    return;
  }

  const ids = videos.map((v) => v.id);
  const lifetime = await perVideo(ids, LAUNCH_DATE, today);
  const last7 = await perVideo(ids, weekAgo, today);
  const trafficLifetime = await analytics({
    startDate: LAUNCH_DATE,
    endDate: today,
    metrics: 'views,estimatedMinutesWatched',
    dimensions: 'insightTrafficSourceType',
    sort: '-views',
  });
  const traffic7 = await analytics({
    startDate: weekAgo,
    endDate: today,
    metrics: 'views,estimatedMinutesWatched',
    dimensions: 'insightTrafficSourceType',
    sort: '-views',
  });

  const byId = (rows: Array<Record<string, string | number>>) =>
    new Map(rows.map((r) => [r.video as string, r]));
  const lifeMap = byId(lifetime);
  const weekMap = byId(last7);

  const videoTable = (map: Map<string, Record<string, string | number>>) => {
    const header = '| Video | Published | Views | Avg % viewed | Watch min | Subs |\n|---|---|---|---|---|---|';
    const lines = videos.map((v) => {
      const r = map.get(v.id) ?? {};
      const cells = [r.views ?? 0, fmtPct(r.averageViewPercentage), r.estimatedMinutesWatched ?? 0, r.subscribersGained ?? 0];
      return `| ${v.title.split('|')[0].trim()} | ${v.published} | ${cells.join(' | ')} |`;
    });
    return [header, ...lines].join('\n');
  };

  const trafficTable = (rows: Array<Record<string, string | number>>) =>
    rows.length === 0
      ? '_No traffic data yet._'
      : ['| Source | Views | Watch min |', '|---|---|---|']
          .concat(rows.map((r) => `| ${r.insightTrafficSourceType} | ${r.views} | ${r.estimatedMinutesWatched} |`))
          .join('\n');

  const report = `# YouTube Pull — ${today}

**Channel:** ${channel.snippet.title} · **Subs:** ${channel.statistics.subscriberCount} · **Total views:** ${channel.statistics.viewCount}
_Analytics lag is ~24–48h; the most recent days are partial. Thumbnail impressions + CTR are not API-accessible — read those in Studio (Content → Reach)._

## Per-video — lifetime (since ${LAUNCH_DATE})

${videoTable(lifeMap)}

## Per-video — last 7 days (${weekAgo} → ${today})

${videoTable(weekMap)}

## Traffic sources — lifetime

${trafficTable(trafficLifetime)}

## Traffic sources — last 7 days

${trafficTable(traffic7)}
`;

  mkdirSync(REPORTS_DIR, { recursive: true });
  const outPath = path.join(REPORTS_DIR, `${today}-pull.md`);
  writeFileSync(outPath, report);
  console.log(report);
  console.log(`Saved → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
