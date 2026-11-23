# Fern, Beyond the Screen 🍄

A standalone, personal dating-introduction website for Fern. This is **not** a dating platform and is **not** connected to Fern, Beyond the Résumé.

## Design

- Rich oxblood, dark burgundy, warm ivory and antique gold
- Dramatic Amanita muscaria mushroom photography, embedded directly into the HTML
- Responsive editorial layout, including mobile navigation
- Personal introduction, interests, relationship values, conversation starters and an invitation to connect through the original dating profile

## Privacy

There are no public accounts, registration systems, contact forms, analytics, tracking scripts or user-submitted messages. The page deliberately does not publish personal contact information. Search engine indexing is discouraged using a robots meta tag and `public/robots.txt` (these are not security controls).

## Cloudflare Workers deployment

- GitHub repository: `sleepypig321/fern_beyond_the_screen`
- Branch: `main`
- Build command: `npm run build` (optional; the site is static)
- Deploy command: `npx wrangler deploy`
- Assets directory: `./public`
- Worker name in `wrangler.toml`: `fern-beyond-the-screen`

**Important:** Cloudflare Worker names use hyphens, not underscores. The deployed Worker name in Cloudflare must match the `name` value in `wrangler.toml`. The GitHub repository can keep underscores.

If the Cloudflare Worker is connected to this repository with automatic deployment, new commits to `main` can trigger a deployment. Otherwise, connect it in Cloudflare > Workers & Pages > your Worker > Settings > Build. The public URL should be taken from the Cloudflare dashboard after a successful deployment.

## Local preview

Open `public/index.html` in a browser. The mushroom and favicon are embedded in the HTML, so no additional assets are needed.

## Editing content

All copy, color styles, layout and interactions are in `public/index.html`. This is a first draft intended for Fern to review before sharing publicly.
