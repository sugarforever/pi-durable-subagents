# Project Instructions

## Releases

When preparing an npm release, follow the Publishing section in `README.md`
and treat `.github/workflows/publish.yml` as authoritative.

Release only `@sugarforever/pi-durable-subagents`; the unscoped package belongs
to another project. Update both package manifests, run the repository
verification commands, and publish a non-prerelease GitHub Release whose tag is
exactly `v<package.json version>`. Preserve published tags and versions.

Publishing uses npm trusted publishing through GitHub OIDC. Keep that as the
authentication path unless the release design is intentionally changed.
