# Releases

Pi Desktop uses GitHub Actions for CI and cross-platform release bundling.

## Workflows

- `.github/workflows/ci.yml`
  - TypeScript checks and frontend build
  - Rust check
- `.github/workflows/release.yml`
  - Builds release artifacts for macOS, Windows, Linux
  - Publishes artifacts to a GitHub Release

---

## Release process (maintainer)

## 1) Ensure main is green

- CI passes
- manual smoke pass completed

## 2) Pick version

Example: `v1.0.0`

## 3) Tag and push

```bash
git checkout main
git pull --ff-only
git tag v1.0.0
git push origin main --tags
```

This triggers the release workflow.

## 4) Review release page

Open GitHub Releases and verify artifacts for:
- macOS (`.dmg`, `.app.tar.gz`)
- Windows (`.msi` / `nsis` bundles)
- Linux (`.AppImage`, `.deb`)

## 5) Edit release notes

Use Highlights / Fixes / Known limitations format.

---

## Manual workflow dispatch

You can run `release.yml` manually from the Actions tab and provide a tag input.

---

## In-app desktop update behavior

Pi Desktop now checks for new desktop releases in-app (startup + periodic check).

- Update detection source: GitHub `releases/latest`
- Update entry points: Sidebar update banner and Settings → Desktop updates
- Update action: opens the best-matching installer asset for the current platform (or release page fallback)

This reduces manual steps for users (no need to browse releases manually each time).

## Notes about signing

Current workflow produces unsigned artifacts unless signing secrets/certificates are configured.

For production distribution, configure platform signing:
- macOS: Apple Developer signing + notarization
- Windows: code signing certificate (recommended)
- Linux: optional signature strategy depending on distro/channel

Without macOS signing/notarization, some users may see Gatekeeper warnings (“app is damaged”).
Include these workarounds in release notes while unsigned builds are shipped:

1. Terminal workaround:

```bash
xattr -cr /Applications/Pi\ Desktop.app
```

2. System Settings workaround:
   - Open **System Settings → Privacy & Security**
   - Find the blocked Pi Desktop launch warning
   - Click **Open Anyway** and confirm
