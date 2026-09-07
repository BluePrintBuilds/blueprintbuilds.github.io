# Blueprint Builds — public site

Source for the Blueprint Builds public website: landing page plus the App
Store-required legal pages (privacy, terms, support with account deletion).

- **Deploy target:** the `blueprintbuilds/blueprintbuilds.github.io` repository
  (GitHub Pages org site — Pages activates automatically on push to the default
  branch). This folder is the source of truth; copy its contents verbatim.
- **Design:** matches the app (`src/constants/theme.ts` palette, blueprint grid
  from `docs/design-system.md`). The public marketing/legal pages are static and
  make zero external requests. The authenticated `/workspace/` and Plan Desk
  call only the Blueprint Supabase backend; there are no trackers, analytics,
  advertising cookies or third-party fonts.
- **Canonical domain:** `https://blueprintbuilds.app` is active on GitHub Pages with HTTPS enforced. The apex uses GitHub Pages A records and `www` CNAMEs to `blueprintbuilds.github.io`. Keep the Pages CNAME and Cloudflare DNS aligned.
- **Content source:** `docs/app-store-legal-content.md` — keep the two in sync
  when the app's data practices change.
