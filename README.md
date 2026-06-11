# Tool Shed Tales Ops

**[Privacy Policy](./PRIVACY.md)** · **[Terms of Service](./TERMS.md)**

Internal command-line tooling used by **Green Growth Digital LLC** (a single-member LLC) to manage its own **YouTube** channel, [Tool Shed Tales](https://www.youtube.com/@tool_shed_tales) — original animated Bible stories and songs for children. This application uses **YouTube API Services**.

## What this is

A private, single-user API client. It is operated exclusively by the LLC's sole member, on his own computer, against the one channel the LLC owns. It is not a product: it is not distributed, sold, licensed, or accessible to anyone else, and it has no users other than the channel owner. The source is published here for transparency.

## What it does

The complete client consists of the scripts in this repository:

| Script | YouTube API Service | Purpose |
|---|---|---|
| `yt-auth.ts` | OAuth 2.0 | One-time authorization of the owner's own channel (scopes: `youtube`, `yt-analytics.readonly`) |
| `yt-pull.ts` | YouTube Data API v3 + YouTube Analytics API | Reads the channel's own video list and performance reports (views, retention, watch time, subscribers, traffic sources) and writes a local markdown report for the owner's weekly review |
| `yt-upload.ts` | YouTube Data API v3 (`videos.insert`) | Uploads the LLC's own finished videos to its own channel as private/scheduled posts, with metadata (title, description, tags), made-for-kids designation, thumbnail, and playlist placement — replacing manual uploads through YouTube Studio. This endpoint is the reason for the API compliance audit. |

## Data handling

- OAuth tokens are stored in a local file on the owner's computer and are never transmitted anywhere except to Google's OAuth endpoints.
- All API data retrieved (the channel's own metadata and analytics) is written to local files for the owner's own review.
- No data is shared with third parties. No other user's or channel's data is ever requested or accessed.

See the [Privacy Policy](./PRIVACY.md) and [Terms of Service](./TERMS.md).

## Contact

Green Growth Digital LLC — stmurphy360@gmail.com
