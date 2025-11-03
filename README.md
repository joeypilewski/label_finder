# Shipping Label Extractor — Static Site

This folder is ready to deploy anywhere that hosts static files (no server needed).

## Files
- `index.html` — the whole app (React, Tailwind, PDF.js from CDNs).

## Quick deploy options
### Netlify (fastest)
1) Go to https://app.netlify.com/drop
2) Drag this folder or the ZIP. Done.

### GitHub Pages (free)
1) Create a new repo and upload `index.html` to the repo root.
2) Settings → Pages → Deploy from branch (main / root).
3) Wait a minute for build; your site will be live at `https://<username>.github.io/<repo>/`.

### Vercel (simple)
1) Import the repo at https://vercel.com/new or drag the folder.
2) Accept defaults for a static project and deploy.

### Local LAN (same Wi‑Fi, temporary)
1) On your computer, open Terminal in this folder and run:
   `python3 -m http.server 8000`
2) Find your computer’s IP (e.g., 192.168.1.23).
3) On your phone (same Wi‑Fi), open: `http://<IP>:8000/`