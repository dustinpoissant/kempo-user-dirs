# kempo-user-dirs

A private folder for every member, built on [kempo-files](https://github.com/dustinpoissant/kempo-files). Upload, organise, share — a personal file space, with storage limits you can sell.

Nobody gets one automatically. A user has a space when they hold `userdirs:access`, normally by being in a group — which is the seam a paid tier hooks into later without any of this changing.

---

## What it is, and what it deliberately isn't

Every byte a member uploads is an **ordinary kempo-files entry in an ordinary folder on disk**. This extension stores no files of its own. What it adds is the two things kempo-files has no opinion about:

- which folder belongs to which person, and who may look inside it
- how much they are allowed to put there

That choice is what makes the rest cheap. Files in a user space inherit kempo-files' serving rules, its trusted/untrusted handling, its `file:before_download` veto and its placement in `files/` — a sibling of `public/`, never inside it, so nothing here can be served by accident. An uploaded `.js` in somebody's folder comes back as inert `text/plain`, for free, because kempo-files already decided that.

It also means the escape hatch is always open: an administrator can open the file library and see exactly what is there, and uninstalling this extension leaves every file where it is.

---

## How access works

Three separate questions, deliberately not collapsed into one:

| Question | Answered by |
|---|---|
| May this person have a space at all? | The `userdirs:access` permission |
| Do they have one yet? | A `kempoUserDir` row |
| How much may they store in it? | Their plan, or a limit set just for them |

Keeping the permission and the row apart is what lets a subscription lapse without destroying anything. Revoke the permission and the folder stays exactly where it is; grant it again and they are back in.

### Permissions

| Permission | Allows |
|---|---|
| `userdirs:access` | Have a personal file space, and manage everything inside it |
| `userdirs:share` | Make a file in your own space downloadable by anyone with the link |
| `userdirs:others:browse` | Open and download from any user's space |
| `userdirs:others:manage` | Upload to, rename, move and delete inside any user's space |
| `userdirs:provision` | Create and remove user spaces |
| `userdirs:quotas` | Change storage plans, per-user limits, and suspend or restore a space |

### Groups

Two ship, and the first is the one that matters:

- **`kempo-user-dirs:member`** — `userdirs:access` + `userdirs:share`. Adding somebody to this group is what gives them a space. This is the paywall seam.
- **`kempo-user-dirs:administrator`** — the whole set, for whoever manages everyone's storage.

A site can grant `userdirs:access` from any group it likes — its own "Subscribers", or one an ecommerce extension manages. Nothing here checks for the shipped group by name.

---

## Containment

A member's request names a folder id, which is an entirely ordinary-looking thing to send. Every route resolves that id **up its folder chain** and refuses anything that does not land in the space the caller is allowed to touch.

It walks the ancestry rather than comparing paths, because a path is a string that changes the moment anything above it is renamed, while the chain is what kempo-files itself goes by. The two can never disagree.

A move is checked twice — the file *and* the destination — since the destination is the one field that can take something out of a space.

### Privacy is enforced twice, on purpose

kempo-files' own download route admits anybody holding `files:download`, and its shipped `kempo-files:contributor` group grants exactly that. Correct for a shared library; completely wrong for a personal folder.

So this extension also answers `file:before_download`, which kempo-files fires **after** its own gate has passed — meaning a handler there can only ever narrow access, never widen it. A file inside a space is readable by its owner, by someone holding `userdirs:others:browse`, and by anyone at all if it has been shared. Nothing else in the library is affected.

Members are not given `files:download` at all; they use this extension's own download route, which streams through kempo-server so a video in a personal folder seeks exactly like a static one.

---

## Uploads are never up for review

Everything a member uploads is stored with kempo-files' `reviewable: false`. That is stronger than "arrives unapproved" — it means approval is impossible:

- the file never appears in the file library's **Needs review** queue, so a member's holiday photos are not somebody's review backlog
- an admin holding `files:upload_trusted` gets a **409** if they try to approve it, from the library's own screens or straight from the API
- it is served as inert text at the response regardless, so even a flag set some other way changes nothing

This matters because the alternative is a real hole. A personal folder accepts anything, uploaded by anyone with a subscription; approving one of those files means the site will hand it back as an executable script on its own origin. There is nobody in a position to make that judgement, so the judgement is removed rather than left available.

**What this does not affect is reading your files.** The bytes are stored and returned untouched, and only the browser's *treatment* differs by type:

| Type | How it comes back |
|---|---|
| Images, video, audio, archives, fonts, 3D models | Their real content type — previews inline, `<img src>` works, video seeks |
| `.js`, `.html`, `.css`, `.svg`, `.json`, any `text/*` | `text/plain` + `nosniff` — readable as source, impossible to execute or render as markup |
| PDFs, Office files, unknown binaries | `application/octet-stream` as an attachment — downloads rather than previewing in the tab |

That last row is the one real difference from a consumer file-sync product, and it is deliberate: a PDF viewer runs script and an Office file carries macros, so an inline-rendered one on your own origin is a genuine vector rather than a theoretical one. Previewing those safely means a separate origin or a sandboxed frame, which is a larger piece of work than a header change.

---

## Storage plans and limits

A **plan** is a named allowance many spaces share, so changing what a tier is worth is one edit rather than one per member. A per-user **override** replaces a plan's number outright rather than adding to it — "plan 10 GB, override 25 GB" means 25, because the second time somebody has to work out why a user is at 37 the design has already failed.

`null` means unlimited, all the way through. It ships that way: one plan called **Unlimited** with no limit, set as the default, so the feature works before anyone has decided what to charge for it.

| Setting | What it decides |
|---|---|
| Plan's `quotaBytes` | The allowance for everyone on that plan. Blank is unlimited |
| `quotaOverrideBytes` | A limit for one person, replacing their plan's |
| `suspended` | Read-only. Downloads and deletes still work; uploads do not |

**Suspension is not deletion.** A lapsed subscription should stop somebody adding more storage they are no longer paying for, not hold their existing files hostage — so a suspended space keeps everything, and deleting still works, since leaving somebody stuck over a limit with no way down is the opposite of the point.

### How usage stays honest

The real number is what is on disk, and reading it is a filesystem walk — cheap after a change, far too expensive on every request that wants to draw a usage bar. So `bytesUsed` is a cache with two rules:

1. **An upload reserves its bytes before it is allowed through.** Two large uploads arriving together therefore cannot both measure against the same stale figure and both be let in.
2. **A walk runs straight after and replaces the cache with the real number** — correcting a reservation for an upload that then failed, or a replacement that freed as much as it added.

The cache is briefly pessimistic and then exact. The other way round — optimistic and eventually right — is what lets somebody over their limit.

The walk counts what is **on the disk**, not what has rows: a file somebody dropped in by hand occupies exactly as much space as a tracked one. It also means the number needs no reconciliation pass of its own. "Recalculate" on the admin screen is there for the cases nothing fired a hook for — a restore from backup, files moved onto the server by hand.

---

## The quota lives in a hook, not in a route

A user space is an ordinary kempo-files folder, so an administrator can upload into one from the file library's own admin, and [kempo-thumbs](https://github.com/dustinpoissant/kempo-thumbs) writes generated thumbnails next to the files it made them from. Both are real bytes landing in somebody's space.

If the limit were enforced only on the route this extension owns, either would walk straight past it. So it lives in `file:before_upload`, which kempo-files fires for every upload it accepts, whatever route it arrived at.

The consequence worth knowing: **a thumbnail counts against its owner's quota, and a full space can refuse one.** That is correct — it is disk they are using — but it shows up as a failed row in kempo-thumbs rather than as anything about storage.

---

## Install

```bash
npm install kempo-user-dirs
```

Then enable it from the admin's Extensions screen. kempo-files must be installed and enabled first; kempo refuses with a 409 otherwise.

Installing creates the two tables, registers the permissions, settings and groups, and creates the default **Unlimited** plan. It does **not** create any folders — the shared root and each member's folder are created the first time they are actually needed, so a site that never adds anybody to the group never grows an empty `users/` folder in its library.

---

## Using it

### For members — `/my-files/`

A file browser: drag-and-drop upload with progress, folders, rename, move, delete, download, and a usage meter. An unlimited space gets a sentence rather than a bar at 0% — a meter that can never move makes "unlimited" look like "empty".

Someone without `userdirs:access` gets an explanation rather than an error.

### For administrators — Admin → User Files

- Every space, with the person, their plan, a usage meter and their status
- Open any space in the same browser members use — `?userId=` on the same component, so the read-only case is the same code with the write controls absent rather than a second implementation
- Create a space for anyone who holds `userdirs:access` but has none yet
- Change a plan, set a limit for one person, suspend or restore
- Edit the plans themselves

A space whose user account has been deleted is shown as **Orphaned** rather than hidden. kempo fires no hook when an account goes, so nothing here could have cleaned up — and surfacing it is the only way it ever gets dealt with.

---

## Settings

| Setting | Default | What it does |
|---|---|---|
| `root_folder` | `users` | The library folder every space is created inside |
| `auto_provision` | `true` | Create a member's space the first time they open it. Off means an admin has to create it first — which is what a paywall wants |
| `usage_stale_minutes` | `60` | How old a cached usage figure may get before opening a space re-measures it in the background |

The single-file upload cap is kempo-files' own `max_upload_size_mb` setting, deliberately not duplicated here.

---

## Why folders are named with a user id

A space's folder on disk is named with the user's id, not their name or email. Both of those change, and a rename on disk that this extension did not perform is how a space silently loses its contents. The id is the only handle stable for as long as the account is.

The admin screens show the person, never the folder name, so nothing is lost by it being opaque. Members never see it at all — their own root is presented as **Home**, and the breadcrumb is cut there rather than climbing into `users/`, which is a step they are not allowed to take anyway.

---

## Building on it

The server SDK is the surface an ecommerce extension needs. Selling storage is three calls and no files:

```javascript
import { provisionSpace, updateSpace, getSpace } from 'kempo-user-dirs/sdk';

// Somebody subscribed
await provisionSpace({ userId, planId: proPlan.id });

// They bought more room
await updateSpace({ userId, quotaOverrideBytes: 250_000_000_000 });

// Their payment lapsed — read-only, nothing deleted
await updateSpace({ userId, suspended: true });
```

Nothing in that list deletes anything, deliberately: a billing failure should never be able to.

Also exported: `resolveSpace` / `resolveSpaceForFile` (which space a folder or file belongs to), `listSpaces`, `describeSpace`, `effectiveLimit`, `measureSpace`, `recalculateUsage`, the plan CRUD, and `formatBytes`.

The browser SDK is served at `/my-files/sdk.js` and mirrors those names, so a call reads the same on either side. Every call takes an optional `userId` — left off it means your own space.

---

## Deliberately out of scope

Not gaps — decisions:

- **No sharing with named users.** A file is private or it has a public link. Per-user grants need an ACL table and a UI for it, which is a larger feature than this.
- **No aliases.** kempo-files lets a public file claim a bare path like `scripts/app.js` on the site. That is a site-wide namespace, and handing every member of a paid tier the ability to claim URLs on the front page is not a feature. Shared files get the canonical `/kempo-files/api/files/<id>` link.
- **Nothing in a user space can ever be approved.** See *Uploads are never up for review* above — this is enforced, not merely defaulted, and there is no control to change it.
- **No recursive folder delete from the browser.** kempo-files refuses to delete a folder with anything in it, and that refusal is inherited rather than worked around. One request that destroys an arbitrary subtree with no undo is worth making impossible. (An admin removing a whole space *can* purge it, explicitly.)
- **No versioning, no trash, no undo.** Deleting is final, exactly as in kempo-files.
- **No cleanup when a user account is deleted.** kempo fires no hook for it. Orphaned spaces are reported on the admin screen instead.
- **Uploads buffer in memory** rather than streaming to disk, inheriting kempo-files' own approach.

---

## Development

```bash
npm install
npm run link:local          # symlink the sibling checkouts

docker compose up -d        # a throwaway Postgres on port 5438
export DATABASE_URL="postgresql://kempo:kempo@localhost:5438/kempo_user_dirs_test"
npx drizzle-kit push --force

npm test
```

The database-backed suite **skips itself when no database is reachable, which reads as a pass**. Check for `(SKIPPED)` before believing a green run covered the containment, quota and download-privacy paths — they are the ones worth having.

---

## License

MIT
