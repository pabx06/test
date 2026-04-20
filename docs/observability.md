# Observability

## Minimum baseline

- All containers write logs to `stdout` and `stderr`.
- Backend logs are structured JSON via `pino`.
- Frontend container logs come from `nginx` access and error logs.
- MariaDB and Redis logs are exposed by the container runtime.

## Local

Use:

- `docker compose logs -f frontend`
- `docker compose logs -f backend`
- `docker compose logs -f db`
- `docker compose logs -f redis`

## OpenShift

Use:

- `oc logs deployment/propriateraydb-frontend`
- `oc logs deployment/propriateraydb-backend`
- `oc logs statefulset/propriateraydb-mariadb`
- `oc logs statefulset/propriateraydb-redis`

## Next step

Add centralized collection with either:

- OpenShift Logging
- ELK / EFK
- Loki + Grafana
