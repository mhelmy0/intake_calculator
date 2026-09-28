/* ============================================================
   Module: Home — placeholder dashboard (the role-based dashboard is
   designed in the next Claude Design review round). Shows quick links to
   every live page and the roadmap summary per area.
   ============================================================ */
(function (RO) {
"use strict";

const esc = s => RO.util.escHtml(s);
let ROOT = null, META = null;

function render() {
  const u = RO.api.state.user;
  META.textContent = u ? `Signed in as ${u.display_name || u.username}` : "Guest — calculators and exports are available without signing in";
  const areas = RO.nav.AREAS.filter(a => a.id !== "home");
  ROOT.innerHTML = `
    <div class="home">
      <p class="home-lead">The role-based dashboard is designed in the next review round. Until then, jump straight to a page:</p>
      <div class="home-grid">${areas.map(a => {
        const live = a.items.filter(i => i[2] === "live" && (!i[3] || !i[3].minRole || RO.api.can(i[3].minRole)));
        const soon = a.items.filter(i => i[2] === "soon").length;
        return `<section class="blueprint home-card"><i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
          <div class="home-card-head">${RO.nav.icon(a.id, 18)}<h2>${esc(a.label)}</h2></div>
          ${live.length ? `<div class="home-links">${live.map(i => `<button class="btn btn-secondary" data-home-go="${i[0]}">${esc(i[1])}</button>`).join("")}</div>`
                        : `<p class="dim">No pages yet.</p>`}
          ${soon ? `<div class="dim home-soon">${soon} planned page${soon > 1 ? "s" : ""}</div>` : ""}
        </section>`;
      }).join("")}</div>
    </div>`;
}

RO.registerModule({
  id: "home",
  title: "Dashboard",
  mount(ctx) {
    ROOT = ctx.root; META = ctx.meta;
    ROOT.addEventListener("click", e => { const b = e.target.closest("[data-home-go]"); if (b) RO.app.go(b.dataset.homeGo); });
    RO.api.subscribe(render);
    render();
  },
  onShow: render
});
})(window.RO = window.RO || {});
