import { startDatabase, run, PEOPLE, ORG_IDS, personLabel } from "./data.js";

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const when = (d) => (d ? new Date(d).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");

const state = { uid: PEOPLE[2].id, tab: "watchlist", me: null, token: 0 };

const ROLE_TEXT = {
  staff_admin: "Staff admin. You can see every watchlist, manage the bill catalog, organizations and members, and read the activity log. You can't read partners' private notes.",
  staff_analyst: "Staff analyst. You can see every watchlist and the activity log, but you can't change anything, and you can't read partners' private notes.",
  partner_editor: "Partner editor. You can see and change your organization's watchlist and notes, and read its activity.",
  partner_viewer: "Partner viewer. You can read your organization's watchlist and notes, but you can't change them.",
};

// ---------------------------------------------------------------- helpers

function friendly(error) {
  const m = String((error && error.message) || error);
  if (/row-level security/.test(m)) return "Your role isn't allowed to write that row.";
  if (/permission denied/.test(m)) return "Your role has no permission to do that.";
  if (/must be owner/.test(m)) return "Only the database owner can do that.";
  if (/cannot be changed/.test(m)) return "That column is locked once a row exists.";
  if (/append only/.test(m)) return "The audit log can only be added to.";
  if (/duplicate key|unique/.test(m)) return "That already exists.";
  return m;
}

function say(text, bad = false) {
  const el = $("message");
  el.textContent = text;
  el.className = "message" + (bad ? " bad" : "");
  el.hidden = !text;
}

const refused = (error) => say("The database said no: " + friendly(error) + " (" + String(error.message) + ")", true);

const isStaff = () => state.me && (state.me.role === "staff_admin" || state.me.role === "staff_analyst");
const canEdit = () => state.me && state.me.role === "partner_editor";
const billName = (b) => `${esc(b.state)} ${esc(b.number)} (${esc(b.year)})`;
const statusBadge = (s) => `<span class="badge ${s === "Passed" ? "ok" : s === "Failed" ? "bad" : "warn"}">${esc(s === "Engrossed" ? "Passed one chamber" : s)}</span>`;
const empty = (text) => `<p class="empty">${esc(text)}</p>`;

// ---------------------------------------------------------------- who am I

async function loadMe() {
  state.me = await run(state.uid, async (q) => {
    const rows = await q(
      `select m.role, m.org_id, o.name as org_name
         from public.memberships m left join public.orgs o on o.id = m.org_id
        where m.user_id = auth.uid()`
    );
    return rows[0] || null;
  });
  const el = $("me");
  if (!state.me) {
    el.innerHTML = "<strong>The database doesn't know you.</strong> You're logged in, but you don't belong to anything, so you can't see or change anything.";
  } else {
    const org = state.me.org_name ? ` at ${esc(state.me.org_name)}` : "";
    el.innerHTML = `<strong>The database says:</strong> ${esc(state.me.role.replace("_", " "))}${org}. ${esc(ROLE_TEXT[state.me.role])}`;
  }
}

// ---------------------------------------------------------------- views

const views = {
  async watchlist() {
    const rows = await run(state.uid, (q) =>
      q(`select w.id, w.priority, w.created_at, o.name as org, b.state, b.number, b.year, b.status, b.summary
           from public.watchlist w
           join public.bills b on b.id = w.bill_id
           join public.orgs o on o.id = w.org_id
          order by o.name, b.state, b.number`)
    );
    let html = "<h2>Watchlist</h2>";
    html += isStaff()
      ? `<p class="hint">As staff you can read every organization's list. You can't change them: each partner owns their own.</p>`
      : canEdit()
        ? `<p class="hint">These are the bills your organization is watching. You can change the priority or remove a bill.</p>`
        : `<p class="hint">These are the bills your organization is watching.</p>`;
    if (!rows.length) return html + empty("Nothing to show. Either nothing is on the list yet, or the database isn't letting this person see any.");
    const groups = {};
    rows.forEach((r) => (groups[r.org] = groups[r.org] || []).push(r));
    for (const org of Object.keys(groups)) {
      html += `<h3>${esc(org)}</h3><ul class="rows">`;
      for (const r of groups[org]) {
        html += `<li class="row"><div class="row-head"><span class="row-title">${billName(r)}</span>${statusBadge(r.status)}</div>
          <p>${esc(r.summary)}</p><div class="row-actions">`;
        if (canEdit()) {
          html += `<label class="sr-only" for="pr-${r.id}">Priority for ${esc(r.number)}</label>
            <select id="pr-${r.id}" data-action="priority" data-id="${r.id}">
              ${["low", "medium", "high"].map((p) => `<option value="${p}"${p === r.priority ? " selected" : ""}>${p} priority</option>`).join("")}
            </select>
            <button type="button" class="btn small danger" data-action="unwatch" data-id="${r.id}">Remove</button>`;
        } else {
          html += `<span class="badge">${esc(r.priority)} priority</span>`;
        }
        html += `</div></li>`;
      }
      html += "</ul>";
    }
    return html;
  },

  async bills() {
    const rows = await run(state.uid, (q) =>
      q(`select b.id::int as id, b.state, b.number, b.year, b.status, b.summary, b.topics,
                exists (select 1 from public.watchlist w where w.bill_id = b.id) as watched
           from public.bills b order by b.state, b.number`)
    );
    let html = `<h2>Bill catalog</h2><p class="hint">Public bills, the same for everyone who is signed in to something.</p>`;
    if (!rows.length) return html + empty("The database shows you no bills. People who don't belong to anything see nothing.");
    html += `<label for="bill-search" class="sr-only">Search bills</label><input id="bill-search" type="search" placeholder="Search by state, number or word" style="width:100%;max-width:420px;margin-bottom:10px">`;
    html += `<ul class="rows" id="bill-list">`;
    for (const r of rows) {
      html += `<li class="row" data-search="${esc((r.state + " " + r.number + " " + r.summary + " " + (r.topics || []).join(" ")).toLowerCase())}">
        <div class="row-head"><span class="row-title">${billName(r)}</span>${statusBadge(r.status)}</div><p>${esc(r.summary)}</p>
        <div class="row-actions">${
          canEdit()
            ? r.watched
              ? `<span class="badge ok">On your watchlist</span>`
              : `<button type="button" class="btn small" data-action="watch" data-id="${r.id}">Watch this bill</button>`
            : r.watched
              ? `<span class="badge ok">On a watchlist you can see</span>`
              : ""
        }</div></li>`;
    }
    return html + "</ul>";
  },

  async notes() {
    const rows = await run(state.uid, (q) =>
      q(`select n.id, n.body, n.updated_at, n.author, b.state, b.number, b.year
           from public.notes n join public.bills b on b.id = n.bill_id
          order by n.updated_at desc`)
    );
    const watched = canEdit()
      ? await run(state.uid, (q) =>
          q(`select b.id::int as id, b.state, b.number, b.year
               from public.watchlist w join public.bills b on b.id = w.bill_id order by b.state, b.number`)
        )
      : [];
    let html = "<h2>Private notes</h2>";
    if (isStaff()) {
      return html + `<p class="hint">Staff can't read partners' notes. That's a deliberate rule, not a missing feature. A partner might write something candid, so only their own organization can read it.</p>` + empty("No notes are visible to you.");
    }
    html += `<p class="hint">Only people in your organization can read these.</p>`;
    if (canEdit()) {
      html += `<form class="stack card" id="note-form"><div><label for="note-bill">Bill</label>
        <select id="note-bill" required>${watched.map((b) => `<option value="${b.id}">${billName(b)}</option>`).join("")}</select></div>
        <div><label for="note-body">Note</label><textarea id="note-body" required maxlength="4000"></textarea></div>
        <div><button class="btn" type="submit">Add note</button></div></form>`;
    }
    if (!rows.length) return html + empty("No notes to show.");
    html += `<ul class="rows">`;
    for (const r of rows) {
      html += `<li class="row"><div class="row-head"><span class="row-title">${billName(r)}</span><span class="hint">${esc(personLabel(r.author))}, ${esc(when(r.updated_at))}</span></div>
        <p>${esc(r.body)}</p>${canEdit() ? `<div class="row-actions"><button type="button" class="btn small danger" data-action="delnote" data-id="${r.id}">Delete</button></div>` : ""}</li>`;
    }
    return html + "</ul>";
  },

  async activity() {
    const rows = await run(state.uid, (q) =>
      q(`select a.id::int as id, a.at, a.actor, a.actor_role, a.action, a.table_name, a.detail, o.name as org
           from public.audit_log a left join public.orgs o on o.id = a.org_id
          order by a.id desc limit 80`)
    );
    let html = `<h2>Activity</h2><p class="hint">Every change is recorded by the database itself. The log shows what changed and who did it, never the text of a note. Staff can read all of it, and a partner editor can read their own organization's entries.</p>`;
    if (!rows.length) return html + empty("Nothing to show. Viewers and people with no membership can't read the log.");
    html += `<div class="scroll"><table><thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th><th scope="col">Organization</th><th scope="col">Details</th></tr></thead><tbody>`;
    for (const r of rows) {
      html += `<tr><td>${esc(when(r.at))}</td><td>${esc(personLabel(r.actor))}</td><td>${esc(r.action.toLowerCase())} ${esc(r.table_name)}</td><td>${esc(r.org || "")}</td><td><code>${esc(JSON.stringify(r.detail))}</code></td></tr>`;
    }
    return html + "</tbody></table></div>";
  },

  async staff() {
    const rows = await run(state.uid, (q) =>
      q(`select b.state, b.number, b.year, c.orgs_watching::int as orgs, c.high_priority::int as high,
                (select string_agg(o.name, ', ' order by o.name)
                   from public.watchlist w join public.orgs o on o.id = w.org_id where w.bill_id = b.id) as who
           from public.watch_counts c join public.bills b on b.id = c.bill_id
          order by c.orgs_watching desc, b.state, b.number`)
    );
    let html = `<h2>Counts</h2><p class="hint">How many organizations are watching each bill. This page runs on a database view that follows the same rules as everything else, so it only counts what the person looking at it is allowed to see. Staff see every organization. A partner sees only their own.</p>`;
    if (!rows.length) return html + empty("Nothing to count for this person.");
    html += `<div class="scroll"><table><thead><tr><th scope="col">Bill</th><th scope="col">Organizations watching</th><th scope="col">High priority</th><th scope="col">Who</th></tr></thead><tbody>`;
    for (const r of rows) html += `<tr><td>${billName(r)}</td><td>${r.orgs}</td><td>${r.high}</td><td>${esc(r.who || "")}</td></tr>`;
    return html + "</tbody></table></div>";
  },

  async admin() {
    const members = await run(state.uid, (q) =>
      q(`select m.user_id, m.role, o.name as org from public.memberships m
           left join public.orgs o on o.id = m.org_id order by m.role, o.name`)
    );
    const orgs = await run(state.uid, (q) => q("select id, name from public.orgs order by name"));
    let html = `<h2>Admin</h2>`;
    html += state.me && state.me.role === "staff_admin"
      ? `<p class="hint">Only staff admins can change the catalog, organizations and members.</p>`
      : `<p class="hint">Only staff admins can change these. You can still try the forms: the database will say no, and that's the point.</p>`;
    html += `<h3>Members you can see</h3>`;
    html += members.length
      ? `<div class="scroll"><table><thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col">Organization</th></tr></thead><tbody>${members
          .map((m) => `<tr><td>${esc(personLabel(m.user_id))}</td><td>${esc(m.role.replace("_", " "))}</td><td>${esc(m.org || "none, staff")}</td></tr>`)
          .join("")}</tbody></table></div>`
      : empty("None visible.");
    html += `<h3>Add a bill</h3><form class="stack card" id="bill-form">
      <div class="who-row"><div><label for="bf-state">State (2 letters)</label><input id="bf-state" required maxlength="2" size="3" pattern="[A-Za-z]{2}"></div>
      <div><label for="bf-number">Number</label><input id="bf-number" required placeholder="HB 100"></div>
      <div><label for="bf-year">Year</label><input id="bf-year" required type="number" value="2026" min="2000" max="2100"></div>
      <div><label for="bf-status">Status</label><select id="bf-status"><option>Introduced</option><option>Engrossed</option><option>Passed</option><option>Failed</option></select></div></div>
      <div><label for="bf-summary">Short summary</label><textarea id="bf-summary" required></textarea></div>
      <div><button class="btn" type="submit">Add bill</button></div></form>`;
    html += `<h3>Rename an organization</h3><form class="card inline" id="org-form">
      <div><label for="of-org">Organization</label><select id="of-org">${orgs.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join("")}</select></div>
      <div><label for="of-name">New name</label><input id="of-name" required minlength="2" maxlength="80"></div>
      <div><button class="btn" type="submit">Rename</button></div></form>`;
    return html;
  },

  async attacks() {
    const me = state.me;
    let html = `<h2>Try to break it</h2><p class="hint">Each button runs one forbidden thing as <strong>${esc(personLabel(state.uid))}</strong>, using plain SQL sent straight to the database, the way someone skipping the screens would. Whatever happens is undone afterwards, so you can't hurt the demo. Switch people at the top and run them again.</p>
      <p><button type="button" class="btn" data-action="run-all">Run all of them</button></p><div class="rows">`;
    for (const a of ATTACKS) {
      html += `<div class="attack" id="attack-${a.id}"><h3>${esc(a.title)}</h3><p class="hint">${esc(a.why)}</p>
        <pre class="code">${esc(a.sql)}</pre>
        <button type="button" class="btn small" data-action="run-attack" data-id="${a.id}">Run it</button>
        <div class="outcome-slot" aria-live="polite"></div></div>`;
    }
    return html + "</div>";
  },
};

// ---------------------------------------------------------------- attacks

const otherOrg = () => ORG_IDS.find((id) => id !== (state.me && state.me.org_id)) || ORG_IDS[0];
const myOrgSql = "(select org_id from public.memberships where user_id = auth.uid())";

const ATTACKS = [
  {
    id: "read-notes",
    title: "Read another organization's private notes",
    why: "Partners should only ever get their own organization's notes, and staff get none.",
    sql: `select id from public.notes\n where org_id is distinct from ${myOrgSql}`,
    allowed: () => false,
  },
  {
    id: "read-lists",
    title: "Read every organization's watchlist",
    why: "Partners should only see their own list. Staff are allowed to see all of them.",
    sql: `select id from public.watchlist\n where org_id is distinct from ${myOrgSql}`,
    allowed: () => isStaff(),
  },
  {
    id: "add-other",
    title: "Add a bill to another organization's watchlist",
    why: "Nobody can write into an organization that isn't theirs.",
    sql: "insert into public.watchlist (org_id, bill_id, created_by)\nselect $1, id, auth.uid() from public.bills limit 1\nreturning id",
    params: () => [otherOrg()],
    allowed: () => false,
  },
  {
    id: "delete-other",
    title: "Delete another organization's watchlist",
    why: "Rows that belong to someone else can't be changed or removed.",
    sql: "delete from public.watchlist\n where org_id = $1\nreturning id",
    params: () => [otherOrg()],
    allowed: () => false,
  },
  {
    id: "move-note",
    title: "Move a note into another organization",
    why: "Even your own rows are locked to your organization once they exist.",
    sql: "update public.notes set org_id = $1\nreturning id",
    params: () => [otherOrg()],
    allowed: () => false,
  },
  {
    id: "promote",
    title: "Make myself a staff admin",
    why: "Nobody can promote themselves. Only a staff admin can change roles, and a staff admin already has the role.",
    sql: "update public.memberships set role = 'staff_admin'\n where user_id = auth.uid()\nreturning user_id",
    allowed: () => state.me && state.me.role === "staff_admin",
  },
  {
    id: "rewrite-log",
    title: "Rewrite the activity log",
    why: "The log can only be added to, by the database's own triggers.",
    sql: "update public.audit_log set action = 'edited'\nreturning id",
    allowed: () => false,
  },
  {
    id: "forge-log",
    title: "Forge an activity log entry",
    why: "Nobody can write to the log directly.",
    sql: "insert into public.audit_log (action, table_name)\nvalues ('forged', 'notes')\nreturning id",
    allowed: () => false,
  },
  {
    id: "switch-off",
    title: "Switch the security rules off",
    why: "Only the database owner can change the rules, and the app never is the owner.",
    sql: "alter table public.watchlist\n  disable row level security",
    ddl: true,
    allowed: () => false,
  },
];

async function runAttack(a) {
  const r = await run(state.uid, (q) => q.try(a.sql, a.params ? a.params() : undefined), { commit: false });
  let kind, text;
  if (r.error) {
    kind = "blocked";
    text = `Blocked. The database said: ${friendly(r.error)}`;
  } else if (a.ddl) {
    kind = "through";
    text = "It got through. This should never happen.";
  } else if (r.rows.length === 0) {
    kind = "blocked";
    text = "Blocked in effect. It ran, but it matched nothing this person can see or change.";
  } else if (a.allowed()) {
    kind = "allowed";
    text = `Allowed. ${r.rows.length} row${r.rows.length === 1 ? "" : "s"} came back, because this role is meant to be able to do this. It isn't an attack here, and it was undone afterwards.`;
  } else {
    kind = "through";
    text = `It got through: ${r.rows.length} row${r.rows.length === 1 ? "" : "s"}. This should never happen.`;
  }
  const slot = $("attack-" + a.id).querySelector(".outcome-slot");
  slot.innerHTML = `<div class="outcome ${kind}">${esc(text)}</div>`;
}

// ---------------------------------------------------------------- render loop

async function render() {
  const token = ++state.token;
  document.querySelectorAll(".tabs button").forEach((b) =>
    b.setAttribute("aria-current", b.dataset.tab === state.tab ? "page" : "false")
  );
  let html;
  try {
    html = await views[state.tab]();
  } catch (e) {
    html = `<p class="message bad">Something went wrong: ${esc(e.message)}</p>`;
  }
  if (token !== state.token) return; // a newer render started
  $("view").innerHTML = html;
}

async function act(sql, params, doneText) {
  const r = await run(state.uid, (q) => q.try(sql, params));
  if (r.error) refused(r.error);
  else if (r.rows.length === 0) say("Nothing changed. The database matched no rows you're allowed to change.", true);
  else say(doneText);
  await render();
}

function wire() {
  $("person").innerHTML = ["Staff", "Riverbend Tenants Union", "Highland Clean Energy Coalition", "Lakeside Ratepayers Alliance", "Nobody"]
    .map((g) => `<optgroup label="${esc(g)}">${PEOPLE.filter((p) => p.group === g).map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join("")}</optgroup>`)
    .join("");
  $("person").value = state.uid;

  $("person").addEventListener("change", async (e) => {
    state.uid = e.target.value;
    say("");
    await loadMe();
    await render();
  });

  document.querySelector(".tabs").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-tab]");
    if (!b) return;
    state.tab = b.dataset.tab;
    say("");
    await render();
    $("view").focus();
  });

  $("reset").addEventListener("click", async () => {
    if (!confirm("Reset the demo to its starting data? Anything you added will be lost.")) return;
    await startDatabase((t) => say(t));
    say("The demo data is back to how it started.");
    await loadMe();
    await render();
  });

  const view = $("view");

  view.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-action]");
    if (!b) return;
    const id = b.dataset.id;
    switch (b.dataset.action) {
      case "watch":
        return act("insert into public.watchlist (org_id, bill_id) values ($1, $2) returning id", [state.me.org_id, Number(id)], "Added to your watchlist.");
      case "unwatch":
        return act("delete from public.watchlist where id = $1 returning id", [id], "Removed from your watchlist.");
      case "delnote":
        return act("delete from public.notes where id = $1 returning id", [id], "Note deleted.");
      case "run-attack":
        return runAttack(ATTACKS.find((a) => a.id === id));
      case "run-all":
        for (const a of ATTACKS) await runAttack(a);
        return;
    }
  });

  view.addEventListener("change", (e) => {
    if (e.target.dataset && e.target.dataset.action === "priority") {
      act("update public.watchlist set priority = $1 where id = $2 returning id", [e.target.value, e.target.dataset.id], "Priority updated.");
    }
  });

  view.addEventListener("input", (e) => {
    if (e.target.id !== "bill-search") return;
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll("#bill-list .row").forEach((li) => (li.hidden = q && !li.dataset.search.includes(q)));
  });

  view.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target.id;
    if (f === "note-form") {
      await act(
        "insert into public.notes (org_id, bill_id, body) values ($1, $2, $3) returning id",
        [state.me.org_id, Number($("note-bill").value), $("note-body").value],
        "Note added."
      );
    } else if (f === "bill-form") {
      await act(
        "insert into public.bills (state, number, year, status, summary) values (upper($1), $2, $3, $4, $5) returning id",
        [$("bf-state").value, $("bf-number").value, Number($("bf-year").value), $("bf-status").value, $("bf-summary").value],
        "Bill added to the catalog."
      );
    } else if (f === "org-form") {
      await act("update public.orgs set name = $1 where id = $2 returning id", [$("of-name").value, $("of-org").value], "Organization renamed.");
    }
  });
}

// ---------------------------------------------------------------- start

(async function start() {
  try {
    await startDatabase((t) => ($("loading-text").textContent = t || "Almost ready"));
    wire();
    await loadMe();
    $("loading").hidden = true;
    $("app").hidden = false;
    await render();
  } catch (e) {
    $("loading-text").textContent =
      "The demo couldn't start. The database engine loads from a public file host, so check your connection and try again. (" + e.message + ")";
  }
})();
