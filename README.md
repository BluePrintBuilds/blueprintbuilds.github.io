# Blueprint Builds — public site

Source for the Blueprint Builds public website: landing page plus the App
Store-required legal pages (privacy, terms, support with account deletion).

- **Deploy target:** the `blueprintbuilds/blueprintbuilds.github.io` repository
  (GitHub Pages org site — Pages activates automatically on push to the default
  branch). This folder is the source of truth; copy its contents verbatim.
- **Design:** the home page is the Blueprint command-centre surface (`assets/home.css` + `assets/home.js`) and presents the shipped Plan Desk, offline record, role access and proof system without pretending Blueprint is a CAD authoring tool. Legal pages retain the shared app palette and typography. Public marketing/legal pages are static and make zero external requests. The authenticated `/workspace/` and Plan Desk
  call only the Blueprint Supabase backend; there are no trackers, analytics,
  advertising cookies or third-party fonts.
- **Canonical domain:** `https://blueprintbuilds.app` is active on GitHub Pages with HTTPS enforced. The apex uses GitHub Pages A records and `www` CNAMEs to `blueprintbuilds.github.io`. Keep the Pages CNAME and Cloudflare DNS aligned.
- **Content source:** `docs/app-store-legal-content.md` — keep the two in sync
  when the app's data practices change.
- **Search/discovery:** `robots.txt`, `sitemap.xml`, canonical metadata and SoftwareApplication JSON-LD describe Blueprint as construction delivery software (plans + field proof), not a blueprint drafting service. The social preview is generated from the real landing hero at `assets/og-blueprint-builds.png`.
