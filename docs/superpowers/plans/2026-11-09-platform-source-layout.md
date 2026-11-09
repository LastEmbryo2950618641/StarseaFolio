# Platform Source Layout Migration

User-approved objective: organize source under win/, android/, common/ with shared code in common/.

Implementation preserves existing package identities and runtime data. The earlier plan placed the backend and shared renderer under win/; this was corrected to respect the shared-code requirement.

## Layout

- win/desktop: Electron Main, Preload, Windows resources and packaging.
- android/mobile: standalone Expo project and Android platform entry.
- common/backend: shared business rules, lifecycle gates and existing Node runtime adapters.
- common/renderer: shared React workbench and its UI tests.
- common/web: browser entry and HTTP bridge.
- common/packages: contracts, configuration and prompt contracts.

## Work

- [x] Move source trees and renderer tests.
- [x] Extract platform bridge types into common contracts; keep Electron implementation in win/.
- [x] Update TypeScript references, workspace manifests, lint and test discovery.
- [x] Update Windows packaging, CI, scripts, resource discovery and debugger paths.
- [x] Preserve dependency versions while relocating lockfile importers; verify frozen offline install.
- [x] Update Android contracts paths and npm lockfile.
- [x] Pass all workspace typechecks and Android typecheck/tests.
- [x] Complete Windows and Web build verification; export Android Web bundle.
- [x] Complete regression checks: 1326 passed, 54 failed; HEAD snapshot reproduces all 54 failures with no new failed cases.
- [x] Verify HTTP startup and workspace access from an arbitrary working directory with zero model calls.
- [x] Review final diff and stale references.

See docs/platform-source-layout.md for developer entry points and Android local-runtime boundaries. This migration does not implement the independent APK runtime or claim mobile feature parity.
