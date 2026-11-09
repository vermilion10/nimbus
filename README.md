# Cloud

A web front end for Nextcloud with a built-in media downloader. It has its own look (Material 3 or a minimal shadcn-style theme, each in light and dark), installs as an app on phones, and talks to Nextcloud only through its public APIs, so Nextcloud itself stays untouched and updates normally.

## Features

- **Files:** list and grid views, sorting, multi-select, drag-and-drop upload of files and folders (large files upload in chunks), download (folders as ZIP), new folder, rename, move, copy, favorites, delete
- **Photos:** every image and video in your files as a timeline grouped by month
- **Viewer:** images, video, audio, PDF (pdf.js on phones) and text, with keyboard and swipe navigation
- **Search** by file name across all files
- **Trash** with restore and permanent delete
- **Public links** (optional) for a folder that another site publishes read-only
- **Media downloader:** paste links to posts on X, Instagram, Facebook, TikTok, YouTube, Reddit and many other sites, or share them to the app from your phone; the server fetches them with [gallery-dl](https://github.com/mikf/gallery-dl) and [yt-dlp](https://github.com/yt-dlp/yt-dlp) and saves them to `Downloads/<site>/` in your files
- **Installable web app:** on Android it appears in the Share menu, and shared links go straight to the downloader
- Phone layout with a bottom navigation bar

## How it works

- **One origin.** A Caddy container serves the app and forwards Nextcloud's API paths (`/remote.php`, `/ocs`, `/index.php`, `/login`, `/core`) to your Nextcloud, so the browser never needs CORS. It strips cookies in both directions: the app signs every request with its own app password, and a Nextcloud session cookie on the same host name would otherwise make Nextcloud reject uploads (CSRF check).
- **Sign-in** uses Nextcloud Login Flow v2: Nextcloud's own login page (including two-factor authentication) opens in a new tab and returns an app password for this browser. Signing out revokes it.
- **Media.** A service worker adds the credentials to requests the browser makes by itself (images, video, downloads), so large files stream instead of being loaded into memory.
- **Downloader.** A small Python service (standard library only) runs gallery-dl and yt-dlp. Each request carries the user's app password; the service checks it against Nextcloud, downloads into a temporary folder and uploads the files over WebDAV as that user. It only accepts links that resolve to public internet addresses.

## Requirements

- Nextcloud (tested with 35) running in Docker, and the name of the Docker network it is on
- Docker with Compose
- HTTPS in front of the app if you want to install it on a phone or use the Share menu (browsers only allow installing over HTTPS); any reverse proxy works

## Setup

```bash
git clone https://github.com/vermilion10/nimbus.git && cd nimbus
cp .env.example .env            # Nextcloud's host name, network and port
cp public/config.js config.js   # optional settings, see below
docker compose up -d --build
```

The app is then on port 8093. In `.env`:

| Setting | Meaning |
|---|---|
| `NEXTCLOUD_HOST` | A name in Nextcloud's `trusted_domains`, for example `cloud.example.com` or `nextcloud.local:8080`. Sent as the Host header, so Nextcloud's own links (the sign-in page) use it |
| `NEXTCLOUD_UPSTREAM` | Where Nextcloud answers on the Docker network, for example `nextcloud:80` |
| `NEXTCLOUD_NETWORK` | The Docker network your Nextcloud container is on |
| `PORT` | Published port (default 8093) |
| `DOWNLOAD_DIR` | Folder in each user's files for downloads (default `/Downloads`) |
| `DOWNLOAD_WORKERS` | Downloads that run at once (default 2) |

`config.js` holds settings the browser reads at startup, so they change without a rebuild:

| Setting | Meaning |
|---|---|
| `nextcloudUrl` | Address of Nextcloud's own web interface, for the "Open Nextcloud" menu item (empty hides it) |
| `publicDir`, `publicBase` | If a separate site publishes a Nextcloud folder read-only (for example a static file server), items inside `publicDir` get a "Public link" pointing at `publicBase`. Empty `publicBase` turns sharing off |

### Downloads that need a login

Instagram, Facebook, Reddit and some X posts only download when logged in. On the Download page, **Logins** takes a `cookies.txt` (Netscape format) exported from a browser that is signed in to those sites. It is stored per Nextcloud user in `dl-data/cookies/` and used only for that user's downloads. Public X posts are read through [FxTwitter](https://github.com/FixTweet/FxTwitter)'s API without a login; that service sees which post IDs are requested.

### Blocked sites

The downloader looks up site names over DNS-over-HTTPS through a small resolver container ([dnsproxy](https://github.com/AdguardTeam/dnsproxy)), so sites your network or ISP blocks only by DNS still download. `DOH_UPSTREAM` and `DOH_FALLBACK` in `.env` choose the servers (Cloudflare and Google by default).

If a site is also blocked by its address, the downloader can fetch it through [Cloudflare WARP](https://one.one.one.one/). Set `COMPOSE_PROFILES=warp` and list the sites in `PROXY_SITES` (comma-separated names, as in `Downloads/<site>/`, for example `kemono`). The `warp` container registers an anonymous WARP device on first start ([wgcf](https://github.com/ViRb3/wgcf), accepting Cloudflare's WARP terms), keeps it in `dl-data/warp`, and serves it as an HTTP proxy with [wireproxy](https://github.com/whyvl/wireproxy), without a VPN interface or extra privileges. Only the listed sites go through it; Cloudflare sees those requests.

Sites change often. Rebuild the downloader regularly to get the latest yt-dlp and gallery-dl:

```bash
DL_UPDATED=$(date +%s) docker compose build --pull downloader && docker compose up -d downloader
```

The downloader is meant for saving posts for personal use. Respect the terms of the sites you download from and the rights of the people who made the content.

## Styles

All colours, shapes, sizes and fonts come from CSS variables in `src/styles/tokens.css`, selected by `<html data-style="…" data-mode="…">`. To add a style, add a `[data-style='name']` block (plus its light and dark colours) and an entry in `STYLES` in `src/util.ts`.

## Development

```bash
npm install
NEXTCLOUD=http://localhost:8080 npm run dev
```

The dev server runs at http://localhost:5181 and proxies the API paths to `NEXTCLOUD` (and `/dl` to `CLOUD`, a running instance of the app, for the downloader). `npm run build` followed by `npm run preview` serves the production build at http://localhost:5182 with the same Content-Security-Policy as the `Caddyfile`. pdf.js's fonts, CMaps and decoders are copied to `public/pdfjs` before each build and dev run; `node scripts/make-icons.mjs` regenerates the app icons.

## License

MIT, see [LICENSE](LICENSE). Bundled third-party code keeps its own license: pdf.js (Apache-2.0), Roboto Flex and Inter (SIL Open Font License), Lucide icons (ISC); gallery-dl (GPL-2.0) and yt-dlp (Unlicense) are installed into the downloader image, and wgcf (MIT) and wireproxy (ISC) into the WARP image, not included in this repository.
