# Blueprint Builds — public site

Source for the Blueprint Builds public website: landing page plus the App
Store-required legal pages (privacy, terms, support with account deletion).

- **Deploy target:** the `blueprintbuilds/blueprintbuilds.github.io` repository
  (GitHub Pages org site — Pages activates automatically on push to the default
  branch). This folder is the source of truth; copy its contents verbatim.
- **Design:** matches the app (`src/constants/theme.ts` palette, blueprint grid
  from `docs/design-system.md`). Static HTML/CSS, zero external requests — no
  cookies, trackers, or third-party fonts, as stated on the privacy page.
- **Custom domain later:** buy `blueprintbuilds.app` at any registrar, set it
  as the custom domain in the Pages repo settings (Settings → Pages), and add
  DNS at the registrar: four A records `185.199.108.153`, `185.199.109.153`,
  `185.199.110.153`, `185.199.111.153` on the apex, plus a CNAME
  `www → blueprintbuilds.github.io`. Enable "Enforce HTTPS". No site changes
  needed (`.app` requires HTTPS; GitHub issues the certificate automatically).
- **Content source:** `docs/app-store-legal-content.md` — keep the two in sync
  when the app's data practices change.
