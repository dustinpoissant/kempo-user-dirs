# Changelog

All notable changes to `kempo-user-dirs` are documented in this file.

## [Unreleased]

First release.

A private per-user file space built on kempo-files. Every uploaded byte is an ordinary kempo-files entry in an ordinary folder; this extension records only which folder belongs to whom and how much they may store there.

### Access

- `userdirs:access` is the entitlement — nobody has a space without it. The shipped `kempo-user-dirs:member` group grants it, but any group can, so a site or an ecommerce extension can own that decision.
- Spaces are created lazily the first time an eligible member opens theirs, or by an admin ahead of time. `auto_provision` turns the lazy path off for sites that want provisioning to be deliberate.
- Every route resolves the folder it was given **up its ancestry** and refuses anything outside the caller's own space. Moves are checked twice — the thing being moved and where it is going.
- A `file:before_download` handler keeps a private file in a space unreadable by other users, including anyone holding kempo-files' own `files:download`. kempo-files fires that hook after its own gate, so the rule can only narrow access.
- Everything a member uploads is stored `reviewable: false`, so it can never be approved to run — not by an admin from the file library, not from the API, not at all. A personal folder accepts anything from anyone with a subscription; nobody is in a position to vouch for it, so the option is removed rather than left available. The bytes are still stored and returned untouched: only execution is off the table.

### Storage

- Named **plans** (a shared allowance) plus an optional **per-user override** that replaces the plan's number rather than adding to it. `null` is unlimited throughout, and one Unlimited plan is created on install so the feature works before a site has decided on tiers.
- **Suspension** makes a space read-only. Downloads and deletes keep working — a lapsed subscription should stop new storage, not hold existing files hostage.
- Usage is cached and kept honest by reserve-then-measure: an upload reserves its bytes synchronously before it is allowed through, and a filesystem walk replaces the estimate straight after. Never optimistic, so a race cannot bust a quota.
- The limit is enforced in `file:before_upload` rather than in this extension's own route, so an admin uploading through the file library — or kempo-thumbs writing a generated thumbnail — hits the same limit.

### Interface

- `/my-files/` — a member's own browser: drag-and-drop upload with progress, folders, rename, move, share, download, delete, and a usage meter.
- Admin → **User Files** — every space with its person, plan, usage and status; provisioning; plan and limit editing; suspend/restore; and the same browser pointed at anyone's space via `?userId=`.
- Orphaned spaces (the user account was deleted) are reported rather than hidden, since kempo fires no hook for account deletion.

### Notes for anyone building on it

- `kempo-user-dirs/sdk` exposes the space, plan and quota operations. `provisionSpace`, `updateSpace` and `updateSpace({ suspended })` are the three calls an ecommerce extension needs, and none of them touch a file.
- Uninstalling deletes nothing. The tables go; every folder stays in the library, and re-installing picks them back up.

### Shipped alongside

- **kempo-files** — added `getDirectory`, `directoryAncestry` and `directorySubtree` to its SDK (walking a folder's ancestry is how containment is decided here), and a `reviewable` flag on files so member-supplied content can be marked permanently unapprovable. Requires the release carrying both (`>=0.1.4`).
- **kempo core** — added `upload` and `create_new_folder` to the shared icon set (`>=4.2.39`). Both are generic file-management glyphs that were missing from every set kempo serves, and a missing icon renders as nothing at all with no error anywhere — which is what `tests/icons.node-test.js` now exists to catch.
