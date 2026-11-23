# Fern, Beyond the Screen 🍄

An independent, private dating-introduction website for Fern, with a deep burgundy Amanita aesthetic. **Not** a public dating platform or part of Fern, Beyond the Résumé.

## Separate pages

- / — landing page with interactive video-game-style character select, four persona cards, and links to all chapters
- /stargazer/ — the Stardazer personality chapter
- /wildflower/ — the Wildflower personality chapter
- /creator/ — the Creator personality chapter
- /unfiltered/ — the Unfiltered personality chapter
- /about/ — About Me
- /my-world/ — My World
- /connection/ — Connection and values
- /conversation/ — Conversation starters
- /inquire/ — Private introduction form with photo

Every page has its own distinct URL, with shared branding and navigation. The homepage character-select tiles preview each personality and the "Enter chapter" link opens its separate page.

## Fern's photographs

No private photos have been committed. Each character page has an intentional photo placeholder. To activate a portrait, add a file with the exact name:
- `public/portraits/stargazer.webp`
- `public/portraits/wildflower.webp`
- `public/portraits/creator.webp`
- `public/portraits/unfiltered.webp`

A little client-side script (`public/portraits.js`) automatically replaces the placeholder when the image exists. These portrait assets are publicly accessible by design: only use photos approved for public viewing. The homepage gallery currently uses stylized character placeholders until photos are provided.

## Private inquiry email + photo attachments

`src/index.js` handles POST `/api/inquiry` with server-side validation, 18+ restriction, Cloudflare Turnstile spam prevention, and image-type verification (JPG/PNG/WebP, up to 3 MB). It sends the message and photo as an email attachment using Resend. It does **not** create public image URLs or write inquiries to a public database. Sender name, email, interests, regional location, introduction, and photo are sent to the private recipient address and subject to the email service's retention practices.

Before this can accept submissions, set the following environment variables and secrets on your Cloudflare Worker **fern-beyond-the-screen**:

- `RESEND_API_KEY`: Resend private API key, as a secret
- `INQUIRY_FROM_EMAIL`: verified sender address on a domain configured with Resend; may be a plain environment variable
- `INQUIRY_TO_EMAIL`: Fern's private recipient inbox (suggested: fern.croxton@outlook.com), as a secret
- `TURNSTILE_SITE_KEY`: the public site key from a Cloudflare Turnstile widget configured for this site's domain
- `TURNSTILE_SECRET_KEY`: the Turnstile private secret, as a secret

**Never put API keys or the private recipient email in frontend HTML or GitHub files.** Until everything is configured, the form displays a "being connected" message and disables the Send button—no fake delivery success.

Privacy: form responses are emailed privately and not publicly displayed. The email delivery service and your inbox may retain attachments. Keep submissions secure and delete them if not needed. The site uses no public signups, public photos of visitors, or user profiles.

## Cloudflare deploy

- Repository: `sleepypig321/fern_beyond_the_screen`, branch: `main`
- Build: `npm run build`
- Deploy: `npx wrangler deploy`
- Worker name: `fern-beyond-the-screen`
- Static directory: `public`

Changes in `main` should trigger a redeploy only if GitHub/Cloudflare automatic builds are connected. This repository update by itself is not proof of a live deployment.

Search engine indexing is discouraged with noindex + robots.txt but this **does not** restrict site access; anyone with the URL can view public content and public photos.
