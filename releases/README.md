# Historical release directories

The old single-file `Code.gs` artifacts were **removed from the public repository** because they contained an obsolete hard-coded workbook binding and an outdated support ticket workflow. **Do not restore or deploy them from Git history.**

For the current release, generate the combined bundle from an approved Git commit using `npm run gas:build` and the current script properties, then follow [the authoritative release runbook](../docs/RELEASE_RUNBOOK.md). Prior deployable versions and private backups belong in restricted operations storage, not this public repository.

**Removing files from HEAD does not purge historical Git objects.** Security owners must review the access controls on any referenced Sheets and determine whether history cleanup/replacement is necessary.
