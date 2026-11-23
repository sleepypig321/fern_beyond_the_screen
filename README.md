# Fern, Beyond the Screen 🍄

An independent, private dating-introduction website for Fern, with a deep burgundy Amanita aesthetic. **Not** a public dating platform or part of Fern, Beyond the Résumé.

## Separate pages

- / — landing page with a fanned, layered 10-photo deck (one photo in front and three behind), arrow navigation, mobile swiping, and links to all chapters
- /stargazer/ — the Stargazer personality chapter
- /wildflower/ — the Wildflower personality chapter
- /creator/ — the Creator personality chapter
- /unfiltered/ — the Unfiltered personality chapter
- /about/ — About Me
- /my-world/ — My World
- /connection/ — Connection and values
- /conversation/ — Conversation starters
- /inquire/ — animated black door, then a camera zoom into the inquiry room
- /inquire/letter/ — dedicated private letter and photo form, beyond the door

Every page has its own distinct URL, with shared branding and navigation. The homepage gallery is a separate collection of up to ten real photographs, independent of the four personality chapter pages.

## Fern's photographs — ten-photo gallery

The homepage has a **stacked photo carousel**, with **one card in front and three fanned behind**. Left/right arrow buttons, arrow keys (when the gallery is focused), and touch swipes cycle through the ten slots, looping back to the beginning. Every card has a **thin, solid 2px black frame**, including the cards in the rear of the stack. The remaining six cards are offstage until their turn.

The homepage accepts photographs at these exact paths:

```
public/portraits/gallery-01.webp
public/portraits/gallery-02.webp
public/portraits/gallery-03.webp
public/portraits/gallery-04.webp
public/portraits/gallery-05.webp
public/portraits/gallery-06.webp
public/portraits/gallery-07.webp
public/portraits/gallery-08.webp
public/portraits/gallery-09.webp
public/portraits/gallery-10.webp
```

Photos haven't been supplied yet. The gallery currently shows clearly labeled decorative placeholders, **not AI-generated photographs of Fern**. Adding a WebP image at a listed path automatically replaces that slot's placeholder after deployment. Photos are public site assets: only upload pictures Fern approves for public viewing.

The four optional personality chapter pages have their own additional portrait placeholders, with distinct filenames:

```
public/portraits/stargazer.webp
public/portraits/wildflower.webp
public/portraits/creator.webp
public/portraits/unfiltered.webp
```

A client-side script (`public/portraits.js`) automatically replaces a chapter placeholder when its image exists. The chapters are not required for the 10-photo homepage carousel to operate.

## Private inquiry, approval, and chat

An inquiry is submitted through `/inquire/letter/`, validated by Cloudflare Turnstile, and saved to a **private SQLite-backed Durable Object**. The form remains limited to visitors age 25+, requires a clear NON-EXPLICIT JPG/PNG/WebP photograph of up to 3 MB, and does not publish applicant photographs or information on the website.

The administrator logs in at `/admin/` with the secret `ADMIN_PASSWORD`. Only the administrator can view submitted inquiries and photographs, **approve or decline** applicants, generate a one-time registration invitation, manage existing accounts, and reply through the inbox.

Approved applicants receive an invitation by email (if Resend is configured), or the administrator can securely share the one-time link. Each link expires after seven days and works once. The applicant creates a password on `/chat/register/` and signs into `/chat/` afterward. There is no public self-registration page. The server enforces all approval rules; the front end does not grant access.

Chat messages are accessible only via authenticated sessions. This is **private but not end-to-end encrypted**. The administrator sees all messages; approved users see only their own thread. Green **Online** status reflects a live administrator heartbeat and switches off after the app stops checking in.

The admin dashboard is a browser-installable PWA. Push notifications require a VAPID key pair, browser permission and supported PWA installation. Messages are stored until removed through future retention tooling; keep applicant data secure and avoid sharing login credentials.

### Cloudflare settings (do not put secrets in GitHub)

- `ADMIN_PASSWORD`: long, random administrator password, **required** before admin login works.
- `TURNSTILE_SITE_KEY`: site key for Cloudflare Turnstile widget on this domain.
- `TURNSTILE_SECRET_KEY`: corresponding secret.
- `RESEND_API_KEY`: optional API key for sending approval invitations and inquiry notices.
- `INQUIRY_FROM_EMAIL`: a Resend-verified sender address; optional for admin inbox, needed for automated invitation emails.
- `INQUIRY_TO_EMAIL`: optional destination for extra inquiry email notifications, as a secret.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: required for background web push notifications. Use a `mailto:` contact address for the subject **inside the secret only**, not public website HTML.

The `CHAT_HUB` Durable Object binding and `ChatHub` SQLite class migration are defined in `wrangler.toml`. Cloudflare will provision this database on successful deployment. Until Turnstile is set up, inquiry submissions are disabled rather than falsely reporting a delivery.

**Never put email addresses, passwords, API tokens, addresses, private photographs or home IP addresses in public HTML or source files.** Site-wide response headers block framing, request geolocation permission, and suppress referrer leakage. No web configuration can hide a device IP from its own ISP, the network it connects to, or all external services.


### Automatic inquiry and invitation emails

New private introductions trigger a styled notification email to the recipient configured in the Cloudflare Worker secret `INQUIRY_TO_EMAIL`. The email has a **Review this inquiry** link into the password-protected administrator inbox; it never allows approval directly from email. The photograph and full answers are accessed only after signing in.

**Approve** sends a tailored, one-time registration invitation automatically to the applicant's email when Resend is configured. **Decline** sends a considerate personal response. The admin dashboard reports whether Resend accepted either email; without configured delivery, the approval link is still available for manual private sharing, and declines still revoke access without claiming a message was sent.

To route inquiry notifications to the owner's preferred inbox, set `INQUIRY_TO_EMAIL` under the Cloudflare Worker settings to the correct recipient address. Keep that address private: do not put it in `wrangler.toml`, `README.md`, or client-side HTML. Set `RESEND_API_KEY` and `INQUIRY_FROM_EMAIL` with a verified sending domain before relying on automatic delivery. A notification on new inquiry is an additional convenience; the encrypted-transport admin login remains authoritative.

After registration, approved visitors are presented with the optional **Install private chat** guide. The visitor PWA and administrator PWA use different URL scopes and separate notifications.

## Cloudflare deploy

- Repository: `sleepypig321/fern_beyond_the_screen`, branch: `main`
- Build: `npm run build`
- Deploy: `npx wrangler deploy`
- Worker name: `fern-beyond-the-screen`
- Static directory: `public`

Changes in `main` should trigger a redeploy only if GitHub/Cloudflare automatic builds are connected. This repository update by itself is not proof of a live deployment.

Search engine indexing is discouraged with noindex + robots.txt but this **does not** restrict site access; anyone with the URL can view public content and public photos.

## Doorway interaction

Opening the black door on `/inquire/` rotates the door, then zooms the camera forward into `/inquire/letter/`, a separate page carrying the same marble water, rose petals, crimson light and letter styling. The form is only on the second page; the backend, 25+ age validation and Turnstile configuration remain unchanged. Direct links work without animation or JavaScript; reduced-motion visitors get immediate navigation. This is a visual entrance, not a security gate.
