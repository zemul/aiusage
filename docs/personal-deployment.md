# Personal deployment

This fork deploys the existing `aiusage` Cloudflare Worker and `aiusage-db` D1 database.

`.github/workflows/sync-deploy.yml` runs daily at 08:20 Asia/Shanghai, on manual dispatch, and on code pushes to `main`. Scheduled/manual runs merge `imetn/aiusage:main`, run type checks, tests, and builds, push the validated merge, apply D1 migrations, and deploy. A merge conflict or failed check stops deployment and appears as a failed GitHub Actions run.

Repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID`, `CLOUDFLARE_WORKER_NAME`. The API token needs Workers Scripts Edit and D1 Edit for this Cloudflare account. Existing Worker secrets stay in Cloudflare and are not copied into GitHub.

Upstream's npm publishing and deployment jobs are restricted to the upstream repository. This fork uses its own deployment workflow and does not publish upstream npm packages.

The pricing catalog updates with server deployments. Existing stored usage is not automatically repriced by this workflow. CLI updates on individual devices remain separate.
