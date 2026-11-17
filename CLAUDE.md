# PieDesk — notes for Claude Code

Desktop boxes & widgets for Windows. Tauri 2 + Rust (`src-tauri/src`) + React 19 / Zustand / Tailwind 4 (`src`).
Standalone app in `Gogo_Gadgets/PieDesk` — open Claude Code sessions **in this folder** (not in a sibling project).
Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). History: [docs/CHANGELOG.md](docs/CHANGELOG.md).

## Commands
- `npm run dev` — UI only, fake backend (`src/dev/mock.ts`): `/?view=manager&tab=tools`, `/?view=surface&widgets=agents,photo`.
  Preview config: `.claude/launch.json` (`piedesk-ui`, port 1470).
- `npm run typecheck` · `npm test` (cargo tests) · `npm run check` (both).
- `cargo test <name> -- --ignored --nocapture` in `src-tauri` runs the live, read-only probes
  (e.g. `live_list` for the uninstaller, `live_scan` for agents).
- Release: `./scripts/release.ps1 -Version X.Y.Z -Notes "…" -Publish` (bumps versions, signed NSIS build with
  `~/.tauri/piedesk.key`, commits "Release vX.Y.Z", pushes, creates the GitHub release). Notes go in docs/CHANGELOG.md first.

## Where things are
- Surfaces (one transparent window per monitor): `src/surface/*`, `src-tauri/src/surfaces.rs`.
  Drops from Explorer / browsers: `src-tauri/src/dropzone.rs` → `drop://event` → `Surface.tsx` → box or widget.
- Snap layouts (Win 11 style) for boxes/widgets: `src/lib/snap.ts`, `src/surface/SnapBar.tsx`, `src/lib/drag.ts`.
- Widgets: `src/widgets/*`, registered in `src/widgets/registry.ts`. The media frame is `player.tsx` (type `photo`);
  with `config.onTop` (default on) it floats in its own always-on-top window: `src-tauri/src/pins.rs` + `src/surface/Pin.tsx`
  (`?view=pin&id=photo&widgets=photo` in the browser preview).
- Agents widget + Claude plan-usage limits: `src-tauri/src/agents.rs`, `src/widgets/agents.tsx`.
- Utilities tab (Clean up, Uninstaller, Optimize): `src/manager/utilities/*`, `src-tauri/src/{cleanup,uninstall,optimize}.rs`;
  admin work goes through `src-tauri/src/elevate.rs`: the admin helper task `PieDesk\AdminHelper`, granted once by the
  installer (`src-tauri/windows/hooks.nsh`), else one UAC prompt. `cargo test live_helper -- --ignored` tests it
  unprivileged; from inside the Claude app it needs the sandbox off (MSIX virtualises %LOCALAPPDATA%).

## Conventions
- UI text is bilingual: `tr("Tiếng Việt", "English")`.
- Anything destructive must be undoable: Recycle Bin for files, `.reg` backup before deleting registry keys.
- Add mock responses in `src/dev/mock.ts` for every new IPC command so the browser preview keeps working.
- `.claude/sessions/` holds exported session transcripts for reference; it is git-ignored (may contain private data).
