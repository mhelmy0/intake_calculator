"""
API integration tests — run against a TEST database only.

    ROCALC_CONFIG=<test config> php -S 127.0.0.1:8099 -t .
    ROCALC_CONFIG=<test config> php db/migrate.php --create-admin=testadmin > admin.txt
    python tests/api_test.py http://127.0.0.1:8099 admin.txt
"""
import http.cookiejar
import json
import re
import sys
import urllib.error
import urllib.request

BASE = sys.argv[1].rstrip("/") + "/api/index.php"
ADMIN_PW = re.search(r"One-time password: (\S+)", open(sys.argv[2], encoding="utf-8").read()).group(1)
ROOT = __file__.replace("\\", "/").rsplit("/tests/", 1)[0]

fails = 0


def check(name, cond, detail=""):
    global fails
    if not cond:
        fails += 1
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  -> {detail}"))


class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = None
        self.me()

    def req(self, method, path, body=None, csrf=True):
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(BASE + path, data=data, method=method)
        r.add_header("Content-Type", "application/json")
        if csrf and self.csrf:
            r.add_header("X-CSRF-Token", self.csrf)
        try:
            with self.op.open(r) as resp:
                raw = resp.read().decode("utf-8")
                ctype = resp.headers.get("Content-Type", "")
                return resp.status, (json.loads(raw) if "json" in ctype else raw)
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8")
            try:
                return e.code, json.loads(raw)
            except ValueError:
                return e.code, raw

    def me(self):
        s, j = self.req("GET", "/auth/me")
        self.csrf = j["csrf"]
        return j

    def login(self, user, pw):
        s, j = self.req("POST", "/auth/login", {"username": user, "password": pw})
        if s == 200:
            self.csrf = j["csrf"]
        return s, j


# ---------- guest ----------
g = Client()
check("guest /auth/me user null", g.me()["user"] is None)
s, j = g.req("POST", "/auth/login", {"username": "x", "password": "y"}, csrf=False)
check("write without CSRF -> 403", s == 403, s)
s, j = g.req("GET", "/fittings/recommended")
check("guest recommended list = 62 items", s == 200 and len(j["items"]) == 62, (s, j if s != 200 else len(j["items"])))
check("recommended item numeric types", isinstance(j["items"][8]["n_ld"], (int, float)), j["items"][8])
s, j = g.req("GET", "/values")
check("guest values = 90", s == 200 and len(j["values"]) == 90 and j["values"]["surge.psi_pe"]["value"] == 0.8, j)

tmpl = open(ROOT + "/assets/data/fittings/fittings_import_template.csv", encoding="utf-8-sig").read()
s, j = g.req("POST", "/fittings/import", {"csv": tmpl, "validate_only": True})
check("guest validate template ok", s == 200 and not j["errors"] and len(j["items"]) == 4 and j["saved"] is False, j)
bad = "code,name,category,basis,n_LD,K\nA1,Elbow,elbow,n,,\nA1,Dup,valve,K,,0.2\nB2,Thing,widget,zz,,\nC3,Neg,valve,K,,-1\n"
s, j = g.req("POST", "/fittings/import", {"csv": bad, "validate_only": True})
msgs = [(e["row"], e["column"]) for e in j["errors"]]
check("bad CSV errors reported per row", (2, "n_LD") in msgs and (3, "code") in msgs and (4, "category") in msgs
      and (4, "basis") in msgs and (5, "K") in msgs, j["errors"])
s, j = g.req("POST", "/fittings/import", {"csv": tmpl, "name": "x"})
check("guest cannot save import -> 401", s == 401, s)
s, j = g.req("GET", "/users")
check("guest cannot list users -> 401", s == 401, s)

# ---------- admin ----------
a = Client()
s, j = a.login("testadmin", ADMIN_PW)
check("admin login", s == 200 and j["user"]["role"] == "admin" and j["user"]["must_change_password"], j)
s, j = a.req("POST", "/auth/password", {"current": ADMIN_PW, "new": "short"})
check("weak password rejected", s == 422, s)
NEWPW = "Admin-Test-Password-123"
s, j = a.req("POST", "/auth/password", {"current": ADMIN_PW, "new": NEWPW})
check("admin password changed", s == 200, j)
for u, role in [("eng1", "engineer"), ("eng2", "engineer"), ("appr1", "approver"), ("view1", "viewer")]:
    s, j = a.req("POST", "/users", {"username": u, "role": role, "password": "Initial-Pass-" + u})
    check(f"admin creates {u} ({role})", s == 201, j)
s, j = a.req("POST", "/users", {"username": "eng1", "role": "engineer", "password": "Initial-Pass-x1"})
check("duplicate username -> 409", s == 409, s)
s, j = a.req("GET", "/users")
admin_id = [u["id"] for u in j["users"] if u["username"] == "testadmin"][0]
s, j = a.req("PATCH", f"/users/{admin_id}", {"role": "viewer"})
check("admin cannot demote self", s == 422, s)

# ---------- engineer ----------
e = Client()
s, j = e.login("eng1", "Initial-Pass-eng1")
check("engineer login", s == 200, j)
s, j = e.req("GET", "/users")
check("engineer cannot list users -> 403", s == 403, s)
s, j = e.req("POST", "/fittings/import", {"csv": tmpl, "name": "Consultant XYZ", "source": "Test", "filename": "t.csv"})
check("engineer imports draft list", s == 201 and j["saved"] and j["version"] == 1, j)
vid, lid = j.get("version_id"), j.get("list_id")
s, j = e.req("POST", "/fittings/import", {"csv": tmpl, "name": "consultant xyz"})
check("duplicate list name (case-insensitive) -> 409", s == 409, (s, j))
s, j = g.req("GET", f"/fittings/versions/{vid}")
check("guest cannot see draft -> 404", s == 404, s)
e2 = Client(); e2.login("eng2", "Initial-Pass-eng2")
s, j = e2.req("GET", f"/fittings/versions/{vid}")
check("other engineer cannot see draft", s == 404, s)
s, j = e.req("GET", f"/fittings/versions/{vid}")
check("owner sees own draft (4 items)", s == 200 and len(j["items"]) == 4, s)
s, j = e.req("POST", f"/fittings/versions/{vid}/approve")
check("engineer cannot approve -> 403", s == 403, s)
v2csv = tmpl.replace("0.35", "0.40") + "MY-NEW,New row,valve,K,,0.5,,,,,segment,,,yes,flanged,verified,Test,\n"
v2csv = "\n".join(l for l in v2csv.splitlines() if not l.startswith("MY-ELB90-3K"))
s, j = e.req("POST", "/fittings/import", {"csv": v2csv, "mode": "version", "list_id": lid, "validate_only": True})
check("version diff added/removed/changed", s == 200 and j["diff"]["added"] == ["MY-NEW"] and j["diff"]["removed"] == ["MY-ELB90-3K"]
      and j["diff"]["changed"] == [{"code": "MY-BFV", "fields": ["k"]}], j.get("diff"))
s, j = e.req("POST", "/fittings/import", {"csv": v2csv, "mode": "version", "list_id": lid})
check("save version 2", s == 201 and j["version"] == 2, j)
v2id = j.get("version_id")
s, j = e.req("GET", f"/fittings/versions/{vid}/csv")
check("CSV export round-trips header", s == 200 and isinstance(j, str) and j.lstrip("﻿").startswith("code,name,category,basis"), str(j)[:80])

# ---------- approver ----------
p = Client()
p.login("appr1", "Initial-Pass-appr1")
s, j = p.req("POST", f"/fittings/versions/{v2id}/recommend")
check("cannot recommend a draft -> 409", s == 409, s)
s, j = p.req("POST", f"/fittings/versions/{v2id}/approve")
check("approver approves", s == 200 and j["version"]["status"] == "approved", j)
s, j = p.req("POST", f"/fittings/versions/{v2id}/recommend")
check("approver recommends", s == 200 and j["version"]["is_recommended"], j)
s, j = g.req("GET", "/fittings/recommended")
check("recommended switched (guest sees 4 items)", s == 200 and len(j["items"]) == 4, s)
s, j = p.req("POST", f"/fittings/versions/{v2id}/retire")
check("cannot retire the recommended list", s == 409, s)
s, j = g.req("GET", "/fittings/lists")
check("guest list shows only approved", s == 200 and all(v["status"] == "approved" for v in j["versions"]), j)
s, j = e.req("DELETE", f"/fittings/versions/{vid}")
check("owner deletes own draft v1", s == 200, j)
# restore seed list as recommended
s, j = p.req("GET", "/fittings/lists")
seed = [v for v in j["versions"] if v["list_name"] == "RO-Calc Recommended Fittings"][0]
s, j = p.req("POST", f"/fittings/versions/{seed['id']}/recommend")
check("seed list recommended again", s == 200, j)

# ---------- pumps ----------
pump = {"vendor": "TestVendor", "model": "TV-300", "pump_type": "submersible", "speed_rpm": 1480, "motor_kw": 45,
        "bep_flow_m3h": 750, "points": [{"q_m3h": 0, "h_m": 40}, {"q_m3h": 500, "h_m": 36, "eff_pct": 70, "npshr_m": 3},
                                        {"q_m3h": 750, "h_m": 30, "eff_pct": 78, "npshr_m": 4},
                                        {"q_m3h": 1000, "h_m": 21, "eff_pct": 70, "npshr_m": 5.5}]}
s, j = g.req("POST", "/pumps", pump)
check("guest cannot create pump", s == 401, s)
v = Client(); v.login("view1", "Initial-Pass-view1")
s, j = v.req("POST", "/pumps", pump)
check("viewer cannot create pump -> 403", s == 403, s)
s, j = e.req("POST", "/pumps", {**pump, "points": pump["points"][:2]})
check("pump needs >= 3 points", s == 422, s)
s, j = e.req("POST", "/pumps", {**pump, "points": pump["points"] + [{"q_m3h": 500, "h_m": 35}]})
check("duplicate flows rejected", s == 422, s)
s, j = e.req("POST", "/pumps", pump)
check("engineer creates pump draft", s == 201 and j["pump"]["status"] == "draft" and len(j["pump"]["points"]) == 4, j)
pid = j["pump"]["id"]
s, j = g.req("GET", "/pumps")
check("guest does not see draft pump", s == 200 and all(x["id"] != pid for x in j["pumps"]), j)
s, j = e2.req("PUT", f"/pumps/{pid}", pump)
check("other engineer cannot edit", s in (403, 404), s)
s, j = e.req("PUT", f"/pumps/{pid}", {**pump, "model": "TV-300B"})
check("owner edits draft", s == 200 and j["pump"]["model"] == "TV-300B", j)
s, j = p.req("POST", f"/pumps/{pid}/approve")
check("approver approves pump", s == 200 and j["pump"]["status"] == "approved", j)
s, j = g.req("GET", f"/pumps/{pid}")
check("guest sees approved pump with points", s == 200 and j["pump"]["points"][2]["h_m"] == 30, j)
s, j = e.req("PUT", f"/pumps/{pid}", pump)
check("owner cannot edit approved pump", s == 403, s)
s, j = e.req("DELETE", f"/pumps/{pid}")
check("owner cannot delete approved pump", s == 403, s)

# ---------- pretreatment equipment list ----------
vessel = {"category": "mmf_vessel", "vendor": "FilterCo", "model": "PF-3000", "specs": {"orientation": "vertical", "diameter_m": 3.0, "design_pressure_bar": 6}}
s, j = g.req("POST", "/equipment", vessel)
check("guest cannot create equipment", s == 401, s)
s, j = v.req("POST", "/equipment", vessel)
check("viewer cannot create equipment -> 403", s == 403, s)
s, j = e.req("POST", "/equipment", {**vessel, "specs": {"orientation": "vertical"}})
check("equipment: required spec (diameter) enforced", s == 422, (s, j))
s, j = e.req("POST", "/equipment", {**vessel, "specs": {**vessel["specs"], "colour": "blue"}})
check("equipment: unknown spec field rejected", s == 422, (s, j))
s, j = e.req("POST", "/equipment", {"category": "cartridge_element", "vendor": "C", "model": "X", "specs": {"type": "standard", "length_in": 40, "micron": 5}})
check("cartridge element needs a rated flow", s == 422, (s, j))
s, j = e.req("POST", "/equipment", vessel)
check("engineer creates equipment draft", s == 201 and j["equipment"]["status"] == "draft" and j["equipment"]["specs"]["diameter_m"] == 3.0, j)
eqid = j["equipment"]["id"]
s, j = g.req("GET", "/equipment?category=mmf_vessel")
check("guest does not see draft equipment", s == 200 and all(x["id"] != eqid for x in j["equipment"]), j)
s, j = e2.req("PUT", f"/equipment/{eqid}", vessel)
check("other engineer cannot edit equipment", s in (403, 404), s)
s, j = p.req("POST", f"/equipment/{eqid}/approve")
check("approver approves equipment", s == 200 and j["equipment"]["status"] == "approved", j)
s, j = g.req("GET", "/equipment?category=mmf_vessel")
check("guest sees approved equipment", s == 200 and any(x["id"] == eqid for x in j["equipment"]), j)
s, j = e.req("DELETE", f"/equipment/{eqid}")
check("owner cannot delete approved equipment", s == 403, s)

# ---------- values ----------
s, j = e.req("PUT", "/values/surge.psi_pe", {"value": 0.9})
check("engineer cannot edit values", s == 403, s)
s, j = p.req("PUT", "/values/surge.psi_pe", {"value": 0.85})
check("approver edits value", s == 200, j)
s, j = p.req("PUT", "/values/surge.psi_pe", {"value": 0.8})
s, j = p.req("PUT", "/values/nope.key", {"value": 1})
check("unknown value key -> 404", s == 404, s)

# ---------- logout / throttling ----------
s, j = e.req("POST", "/auth/logout")
check("logout", s == 200 and j["user"] is None, j)
s, j = e.req("GET", f"/fittings/versions/{v2id}")
check("after logout: approved list still visible to guest", s == 200, s)
t = Client()
codes = [t.login("eng2", "wrong-password-" + str(i))[0] for i in range(6)]
check("login throttled after 5 failures -> 429", codes[:5] == [401] * 5 and codes[5] == 429, codes)
s, j = t.login("eng2", "Initial-Pass-eng2")
check("correct password also blocked while throttled", s == 429, s)
# regression: unknown users used a dummy bcrypt of raw random bytes, which could contain NUL → HTTP 500 (~6 % of attempts)
unk = [Client().login(f"ghost{i}", "wrong-password")[0] for i in range(12)]
check("unknown-user logins never fail with 500", all(c in (401, 429) for c in unk), unk)
s, j = g.req("GET", "/nope")
check("unknown route -> 404", s == 404, s)

print(f"\n=== {fails} failure(s) ===")
sys.exit(1 if fails else 0)
