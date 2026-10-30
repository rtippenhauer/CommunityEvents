Working on the v2 stage deployment.

## Where it is

- Container **`CommunityEvents-v2-Stage`** on Unraid (192.168.2.241), defined by
  `docker/communityevents-v2-stage-unraid.xml`. That template is the answer to
  "what is it called" and "how do I get a shell".
- Host: **`https://stage.communityeventsproject.com`**. Per REQ-TENANT-01.7 this
  deployment is its own root tenant, not a tenant of production.
- Database **`communityevents_stage`** on the Unraid MySQL server, separate from
  `dinnerbears`. **Confirm the name from the container's own startup output**
  rather than from any document — it prints
  `Datasource "db": MySQL database "<name>" at <host>`.
- Image tag `rtippenhauer/community-events:v2-stage`, built by
  `scripts/publish-v2-stage.sh`. **Never `:stage` or `:latest`** — those are the
  live v1 deployment, published from the other repo.

## Getting in

The runtime image is **Alpine**: it has `/bin/sh` and `/bin/ash` and **no
`bash`**. Unraid's Console button used to open and close with no error because
the template asked for a shell the image does not contain; an existing container
keeps the old setting until its Shell field is edited or it is re-added from the
template.

```sh
docker exec -it CommunityEvents-v2-Stage sh
```

One-off Prisma commands run through the same path the entrypoint uses, rather
than `npx`, which does not reliably resolve in that image:

```sh
docker exec CommunityEvents-v2-Stage node /app/node_modules/prisma/build/index.js migrate status
```

## Checking a deploy

```sh
docker logs CommunityEvents-v2-Stage 2>&1 | grep -iE "entrypoint|migration|Datasource"
curl -s https://stage.communityeventsproject.com/api/v1/health
```

Health reports `status`, `database`, `tenant`, `version` and `gitCommit` —
compare `gitCommit` against `git rev-parse HEAD` to confirm which code is live.

**The entrypoint does not fail the container on a failed migration.** It runs
`migrate deploy ... || echo "WARNING: Migration failed"`, so Nest starts anyway
and a half-migrated database serves traffic. A failed migration blocks every
later one, so the symptom surfaces much later as an unrelated-looking 500 —
which is exactly how v2-10's achievements migration reached stage testing. The
line to look for is `[entrypoint] Migrations complete.`

## Building

The image is built from the **working tree**, not from git — never build with
uncommitted changes, and never with a CRLF checkout of `docker/entrypoint.sh`
(`.gitattributes` pins `*.sh` to LF; a CRLF shebang makes the container
restart-loop with a misleading "not found").

The full fresh-install sequence is `prisma migrate deploy` (on container start)
→ `seed.js` → `bootstrap.js`. That is the supported install path from `v2-1`
onward; the v1-era `typeorm migration:run` no longer exists.

## Secrets

Secrets go in the **appdata `.env`**, never the Unraid container template —
masked template variables do not persist. The container held two rows for
`CLOUDFLARE_EMAIL_SECRET` once, one blank, and `docker run` takes the last.

`/app/appdata` must be mapped in both the compose file and the Unraid template,
or each container recreate generates a new `SECRET_ENCRYPTION_KEY` while the log
says to back up a file that cannot survive.
