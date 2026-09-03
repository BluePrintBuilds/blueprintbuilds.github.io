/* Blueprint Builds — official site interactions.
   100% client-side. No network calls, no trackers, no external libs. */
(function () {
  "use strict";

  /* ---- Mobile menu ---- */
  var toggle = document.querySelector("[data-testid='nav-menu-toggle']");
  var menu = document.querySelector("[data-testid='mobile-menu']");
  if (toggle && menu) {
    toggle.addEventListener("click", function () {
      menu.classList.toggle("open");
    });
    menu.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () { menu.classList.remove("open"); });
    });
  }

  var reveals = document.querySelectorAll(".reveal");
  reveals.forEach(function (el, i) {
    el.style.animationDelay = (Math.min(i, 6) * 40) + "ms";
  });

  /* ---- Toast ---- */
  function toast(msg) {
    var t = document.querySelector("[data-testid='toast']");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove("show"); }, 3800);
  }

  /* ---- SHA-256 helper (Web Crypto, local only) ---- */
  async function sha256(str) {
    try {
      var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
      return Array.from(new Uint8Array(buf)).map(function (b) {
        return b.toString(16).padStart(2, "0");
      }).join("");
    } catch (e) {
      // deterministic fallback if Web Crypto unavailable (e.g. non-secure context)
      var h = 0, out = "";
      for (var i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) >>> 0; }
      for (var j = 0; j < 8; j++) { h = (h * 1103515245 + 12345) >>> 0; out += h.toString(16).padStart(8, "0"); }
      return out;
    }
  }

  /* ---- Offline evidence simulator ---- */
  var sw = document.querySelector("[data-testid='offline-simulator-toggle']");
  var swLabel = document.querySelector("[data-testid='sim-network-label']");
  var capBtn = document.querySelector("[data-testid='sim-capture-button']");
  var capOut = document.querySelector("[data-testid='sim-capture-output']");
  var counter = 1;
  var offline = false;

  function renderNetState() {
    if (!sw) return;
    sw.classList.toggle("offline", offline);
    sw.setAttribute("aria-checked", offline ? "true" : "false");
    if (swLabel) {
      swLabel.innerHTML = offline
        ? "<span class='dot on'></span> Zero Signal — offline capture active"
        : "<span class='dot sync'></span> 5G Sync — connected";
    }
  }
  if (sw) {
    sw.addEventListener("click", function () { offline = !offline; renderNetState(); });
    sw.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); offline = !offline; renderNetState(); }
    });
    renderNetState();
  }

  if (capBtn && capOut) {
    capBtn.addEventListener("click", async function () {
      var now = new Date();
      var ts = now.toISOString();
      var id = "EVD-" + String(counter++).padStart(4, "0");
      var payload = id + "|" + ts + "|site-14b|sam.mitchell";
      var hash = await sha256(payload);
      var short = hash.slice(0, 40);
      var line = document.createElement("div");
      line.className = "log-line reveal in";
      line.innerHTML =
        "<div><span class='k'>id</span> " + id +
        " &nbsp; <span class='k'>ts</span> " + ts + "</div>" +
        "<div><span class='k'>sha256</span> <span class='v-hash'>" + short + "…</span></div>" +
        "<div><span class='k'>state</span> " + (offline
          ? "<span class='v-wait'>queued offline — will sync when online</span>"
          : "<span class='v-ok'>synced — audit event recorded</span>") + "</div>";
      capOut.prepend(line);
      while (capOut.children.length > 4) { capOut.removeChild(capOut.lastChild); }
      toast(offline ? "Evidence " + id + " captured offline & queued." : "Evidence " + id + " captured & recorded.");
    });
  }

  /* ---- Role-curated view switcher ---- */
  var tabs = document.querySelectorAll("[data-role-tab]");
  var rows = document.querySelectorAll("[data-role-visible]");
  if (tabs.length && rows.length) {
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var role = tab.getAttribute("data-role-tab");
        tabs.forEach(function (t) { t.classList.toggle("active", t === tab); });
        rows.forEach(function (row) {
          var allowed = row.getAttribute("data-role-visible").split(" ");
          row.classList.toggle("hidden-row", allowed.indexOf(role) === -1);
        });
      });
    });
  }

  /* ---- Footer year ---- */
  var y = document.querySelector("[data-testid='footer-year']");
  if (y) { y.textContent = new Date().getFullYear(); }

  /* ---- Cloudflare Web Analytics (cookieless, privacy-first) ----
     Paste your token below to activate. Until then the site makes ZERO external
     requests. Token: Cloudflare dashboard -> Web Analytics -> your site -> the
     value of "token" in the provided JS snippet. */
  var CF_ANALYTICS_TOKEN = ""; // e.g. "0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d"
  if (CF_ANALYTICS_TOKEN) {
    var beacon = document.createElement("script");
    beacon.defer = true;
    beacon.src = "https://static.cloudflareinsights.com/beacon.min.js";
    beacon.setAttribute("data-cf-beacon", JSON.stringify({ token: CF_ANALYTICS_TOKEN }));
    document.head.appendChild(beacon);
  }
})();
