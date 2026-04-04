# Medusa Admin Backend Deployment on Railway

This repository's `medusa-admin` service is the Medusa backend and also serves the Admin UI at `/admin`.

## 1. Create Services in Railway

Create these Railway services in one project:

1. PostgreSQL service (managed database).
2. Redis service (managed cache/session store).
3. Backend service from this GitHub repo.

For the backend service, set:

- Root Directory: `medusa-admin`
- Builder: Dockerfile
- Dockerfile Path: `Dockerfile`

## 2. Configure Backend Environment Variables

Set these variables in the backend service:

- `NODE_ENV=production`
- `DISABLE_MEDUSA_ADMIN=false`
- `MEDUSA_WORKER_MODE=server`
- `ADMIN_PATH=/admin`
- `JWT_SECRET=<long-random-secret>`
- `COOKIE_SECRET=<long-random-secret>`
- `DATABASE_URL=<reference from PostgreSQL service>`
- `REDIS_URL=<reference from Redis service>`
- `STORE_CORS=https://<storefront-domain>`
- `ADMIN_CORS=https://<backend-domain>`
- `AUTH_CORS=https://<storefront-domain>,https://<backend-domain>`
- `MEDUSA_BACKEND_URL=https://<backend-domain>`
- `MEDUSA_STOREFRONT_URL=https://<storefront-domain>`

If your storefront is not deployed yet, use the backend domain temporarily for `STORE_CORS` and `AUTH_CORS`, then update after storefront deployment.

## 3. Deploy and Assign Domain

1. Trigger the first deploy.
2. Generate a Railway domain for the backend service.
3. Update `<backend-domain>` values above.
4. Redeploy.

The container startup runs:

1. `npm run predeploy` (database migrations and link sync)
2. `npm run start`

## 4. Verify

After deployment, confirm:

- `https://<backend-domain>/health` returns success.
- `https://<backend-domain>/admin` loads the admin panel.

## 5. Notes

- This setup deploys only server mode for now (`MEDUSA_WORKER_MODE=server`).
- A separate worker deployment can be added later with:
  - `MEDUSA_WORKER_MODE=worker`
  - `DISABLE_MEDUSA_ADMIN=true`