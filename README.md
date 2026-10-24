# Calculus for Engineers

A free web app that teaches calculus by asking **why** each tool exists and **when** to use it, with examples for General, Mechanical, and Civil engineering. There are 16 lessons and 65 practice questions. Students pick the tool and explain their choice before they calculate anything.

It runs on GitHub Pages like the other apps. Nobody needs an account. Progress is saved on each device, and an optional Cloudflare Worker lets a parent see a student's progress from their own phone.

## What's in this repo

```
index.html                    the whole app (lessons, visuals, practice, parent view)
config.js                     one setting: the address of the sync Worker (optional)
.nojekyll                     tells GitHub Pages to serve the files as they are
worker/src/worker.js          the sync service (Cloudflare Worker + KV)
worker/wrangler.toml          settings for deploying the Worker with wrangler
.github/workflows/deploy-worker.yml   optional: auto-deploy the Worker from GitHub
```

## 1. Put the app on GitHub Pages

1. Create a new repository on GitHub, for example `calculus-for-engineers`. Public is fine, since there are no secrets in it.
2. From this folder:
   ```
   git init
   git add .
   git commit -m "Calculus for Engineers"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/calculus-for-engineers.git
   git push -u origin main
   ```
3. In the repository, open **Settings > Pages**. Under **Build and deployment**, choose **Deploy from a branch**, then branch **main** and folder **/ (root)**, and save.
4. After a minute the app is live at `https://YOUR-USERNAME.github.io/calculus-for-engineers/`.

At this point everything works except sharing progress between devices. Progress is saved in each browser, and the Parent view shows that device's own progress.

## 2. Optional: turn on Family sync with Cloudflare

This is what lets a parent open the Parent view on their own phone and see the student's progress. Skip it if you don't need that.

### A. Create the storage (KV namespace)

- Dashboard: **Workers & Pages > KV > Create a namespace**, name it `calculus-progress`, and copy its **ID**.
- Or with wrangler: `npx wrangler kv namespace create PROGRESS` (older versions use `kv:namespace`).

### B. Deploy the Worker (pick one)

**Dashboard, no tools needed**
1. **Workers & Pages > Create > Create Worker**. Name it `calculus-progress` and deploy.
2. Choose **Edit code**, replace everything with the contents of `worker/src/worker.js`, and deploy.
3. In the Worker's **Settings**, add a **KV namespace binding**: variable name `PROGRESS`, namespace `calculus-progress`.
4. Still in **Settings**, add a variable `ALLOWED_ORIGIN` with the value `https://YOUR-USERNAME.github.io`. Use the origin only: no path and no trailing slash.
5. Deploy again so the settings take effect.

**wrangler**
1. Open `worker/wrangler.toml` and fill in `ALLOWED_ORIGIN` and the KV namespace `id`.
2. Run `cd worker && npx wrangler deploy`.

**GitHub Actions (optional)**
1. Fill in `worker/wrangler.toml` as above and commit it.
2. In the repository, add the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The token needs permission to edit Workers.
3. Every push that changes `worker/` now deploys it. You can also run it by hand from the **Actions** tab.

### C. Check it

Open `https://calculus-progress.YOUR-SUBDOMAIN.workers.dev/api/health` in a browser. You should see `{"ok":true}`.

### D. Point the app at it

Edit `config.js`:

```js
window.CFE_CONFIG = {
  apiBase: 'https://calculus-progress.YOUR-SUBDOMAIN.workers.dev'
};
```

Commit and push. A **Family sync** button now works in the app.

## How a family uses it

1. **Parent:** open the app, choose **Family sync**, and tap **Create a family code**. It looks like `K7M2-X9QD-4HTE`.
2. **Student:** on their own device, open **Family sync**, enter the code and their first name, and tap **Join**. From then on, practice progress saves to the family.
3. **Parent:** on any device, open **Family sync**, then **Parent view**. It shows each student's lessons, first-try results, and a list of things worth talking about. It refreshes every minute and has a **Refresh now** button.

A second parent just enters the same code. The same student on a second device joins with the same name, and their progress is merged.

## Privacy and limits

- No accounts, emails, or passwords. A family code is a long random code that works like a key: anyone who has it can see that family's progress, so share it only with family.
- What's stored: the student's first name, track, which lessons and questions were done, and which questions were missed on the first try. Nothing else.
- Names are cleaned on the server and escaped in the page, so a typed name can't inject code.
- Up to 12 students per family. Unused families expire after about 13 months. Creating codes is limited to 10 per hour per network.
- Cloudflare's free KV plan has daily limits on writes and list calls (about 1,000 each when this was written; check the current numbers). A family using the app normally stays well under them.
- The Worker only answers requests from your site's address (`ALLOWED_ORIGIN`), plus `localhost` for testing.
- Fonts load from Google Fonts. If you'd rather not, delete the `<link>` to fonts.googleapis.com in `index.html`, and the app falls back to system fonts.

## Troubleshooting

- **"Couldn't reach the sync service":** check `apiBase` in `config.js`, and open the `/api/health` address in a browser.
- **The browser console says a CORS error:** `ALLOWED_ORIGIN` must exactly match the site's origin, for example `https://yourname.github.io`, with no path and no trailing slash. Redeploy after changing it.
- **"Family code not found":** check the code for typos, since the app ignores case, spaces, and dashes. Codes for families unused for over a year expire.
- **Progress missing on the parent's screen:** the student has to join with a name, and the parent device has to use the same family code.
- **A change to `index.html` doesn't show up:** GitHub Pages can take a minute, and the browser may cache. Do a hard refresh.
