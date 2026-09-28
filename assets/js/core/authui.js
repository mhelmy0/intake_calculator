/* ============================================================
   Sign-in and password dialogs (the shell draws the account button / menu).
   Guests can use everything and export; saving needs an account (PRD §9.1).
   ============================================================ */
(function (RO) {
"use strict";

const esc = s => RO.util.escHtml(s);

function loginDialog() {
  RO.ui.modal({
    title: "Sign in",
    body: `<form id="login-form" class="form-grid" autocomplete="on">
             <div class="input-row"><label for="lg-user">Username</label><input id="lg-user" name="username" autocomplete="username" required></div>
             <div class="input-row"><label for="lg-pass">Password</label><input id="lg-pass" name="password" type="password" autocomplete="current-password" required></div>
             <div class="form-error" id="lg-err"></div>
             <p class="hint">Accounts are created by the administrator. Guests can use every calculator and export results without logging in.</p>
           </form>`,
    actions: [
      { label: "Cancel" },
      { label: "Sign in", primary: true, onClick: (close, root) => submit(close, root) }
    ],
    onOpen: (root, close) => root.querySelector("#login-form").addEventListener("submit", e => { e.preventDefault(); submit(close, root); })
  });
  async function submit(close, root) {
    const err = root.querySelector("#lg-err");
    err.textContent = "";
    try {
      const u = await RO.api.login(root.querySelector("#lg-user").value.trim(), root.querySelector("#lg-pass").value);
      close();
      RO.ui.toast(`Logged in as ${u.username}`, "ok");
    } catch (e) { err.textContent = e.message; }
  }
}

function passwordDialog(forced) {
  RO.ui.modal({
    title: forced ? "Set a new password" : "Change password",
    body: `<form id="pw-form" class="form-grid">
             ${forced ? `<p class="hint">Your password was set by an administrator. Choose your own password to continue.</p>` : ""}
             <div class="input-row"><label for="pw-cur">Current password</label><input id="pw-cur" type="password" autocomplete="current-password"></div>
             <div class="input-row"><label for="pw-new">New password (min. 10 characters)</label><input id="pw-new" type="password" autocomplete="new-password"></div>
             <div class="input-row"><label for="pw-new2">Repeat new password</label><input id="pw-new2" type="password" autocomplete="new-password"></div>
             <div class="form-error" id="pw-err"></div>
           </form>`,
    actions: [
      forced ? { label: "Log out", onClick: async c => { c(); await RO.api.logout(); } } : { label: "Cancel" },
      { label: "Save", primary: true, onClick: async (close, root) => {
          const err = root.querySelector("#pw-err");
          const a = root.querySelector("#pw-new").value, b = root.querySelector("#pw-new2").value;
          if (a !== b) { err.textContent = "New passwords do not match"; return; }
          try {
            await RO.api.changePassword(root.querySelector("#pw-cur").value, a);
            close();
            RO.ui.toast("Password changed", "ok");
          } catch (e) { err.textContent = e.message; }
        } }
    ]
  });
}

/* A user whose password was set by an admin must choose a new one — also after a page reload. */
RO.api.subscribe(st => { if (st.user && st.user.must_change_password && !document.getElementById("pw-form")) passwordDialog(true); });
RO.authui = { loginDialog, passwordDialog };
})(window.RO = window.RO || {});
