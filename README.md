# PropriaterayDB Web Service

## Architecture cible

### Décisions retenues

```text
Frontend        : Angular
Backend         : Node.js + Express.js + TypeScript
Base de données : MariaDB
Auth            : SSO Active Directory via SAML 2.0
Cache / Session : Redis optionnel
Containerisation: Docker + Docker Compose
Orchestration   : OpenShift
Packaging       : Helm
Registry        : GitLab Container Registry (ou Nexus / Artifactory)
CI/CD           : GitLab CI/CD -> build -> push registry -> deploy Helm sur OpenShift
Versionning     : GitLab
Intégrations    : API ITK, flux PropriaterayDB XML/XSD, NAS XML
```

### Ce qui est acté

- `SAML` est imposé et la terminaison SSO se fait côté `backend`.
- Le backend passe en `TypeScript`.
- `MariaDB` existe en local et en production.
- En production, `MariaDB` tourne en `StatefulSet`, `1 replica`, sans HA.
- Le déploiement OpenShift se fait via `Helm`.
- Les images sont déployées par `digest`, pas par `latest`.
- Le pipeline principal est au chemin racine `.gitlab-ci.yml`.
- `Redis` reste optionnel : prévu dans l'architecture, désactivé par défaut.
- Le backend doit avoir un vrai `chien de garde` côté plateforme : probes, redémarrage automatique et supervision applicative.
- L'observabilité doit couvrir les logs `frontend`, `backend`, `nginx`, `MariaDB` et `Redis` en local comme sur OpenShift.

## Pourquoi SAML côté backend

`SAML` est un protocole historiquement orienté serveur. Le faire terminer dans le backend est le choix le plus propre pour ce contexte.

- Les certificats, clés privées et métadonnées `IdP/SP` restent côté serveur.
- Le backend peut transformer l'assertion `SAML` en session applicative simple pour Angular.
- Le frontend n'a pas à manipuler directement une assertion `SAML` ni de logique `SP` complexe.
- Le mapping des groupes `Active Directory` vers les rôles applicatifs est centralisé.
- Les cookies de session peuvent être émis en `HttpOnly`, `Secure`, `SameSite`.

En pratique :

- `Angular` consomme l'application.
- Le `backend` joue le rôle de `Service Provider SAML`.
- Après authentification, le backend crée une session applicative ou émet un cookie de session signé.

## Faut-il ajouter Redis

Oui, `Redis` devient utile si l'objectif est de conserver l'état de session quand le pod ou le process backend tombe.

Point important :

- `Redis` ne protège pas les écritures non persistées ni les traitements en cours.
- `Redis` aide surtout à conserver les sessions, tokens temporaires, cache partagé ou état applicatif court.
- Si le backend redémarre et que les sessions sont en mémoire locale, tout est perdu.
- Si les sessions sont dans `Redis`, un redémarrage backend ne déconnecte pas tous les utilisateurs.

### Redis est utile si

- on veut conserver les sessions après crash ou redéploiement du backend
- le backend tourne avec `2+ replicas` et stocke les sessions côté serveur
- on veut un magasin commun pour `express-session`
- on ajoute du cache applicatif
- on ajoute une file de traitement asynchrone
- on veut partager des données temporaires liées au flux d'authentification

### Redis n'est pas nécessaire si

- le backend reste à `1 replica`
- la session applicative reste simple
- on choisit une approche stateless après le login `SAML`
- on accepte de perdre les sessions en cas de redémarrage du backend
- on ne fait ni cache partagé ni queue

### Décision V1

- `MariaDB` est obligatoire partout.
- `Redis` est recommandé si on veut préserver les sessions après crash backend.
- `Redis` est prévu dans l'architecture locale et OpenShift.
- Si le backend reste simple, `Redis` peut rester désactivé au début.
- Si la continuité de session est requise, activer `Redis` dès la première version.

## Chien de garde backend

Le `chien de garde` ne doit pas être une logique maison dans le conteneur. Sur OpenShift, il faut s'appuyer sur les mécanismes natifs.

### Mécanismes retenus

- `startupProbe` pour laisser le temps au backend de démarrer
- `readinessProbe` pour ne router le trafic que vers un backend prêt
- `livenessProbe` pour détecter un backend bloqué et déclencher son redémarrage
- `Deployment` pour garantir le redémarrage automatique du pod
- logs centralisés et métriques applicatives pour l'observabilité

### Ce que ça couvre

- crash process Node.js
- deadlock ou backend non répondant
- pod démarré mais application pas encore prête
- retrait automatique du trafic pendant un état dégradé

### Ce que ça ne couvre pas

- perte d'une session stockée en mémoire locale
- perte d'un traitement métier non persistant
- corruption de données si l'application ne persiste pas correctement

Le bon couple pour ce besoin est donc :

- `OpenShift probes` comme chien de garde du process
- `Redis` comme stockage externe de session si on veut survivre au crash backend

## Observabilité et logs

Oui, il faut le prendre en compte explicitement. La règle à fixer dès maintenant est simple : tous les composants doivent écrire leurs logs sur `stdout/stderr`, pas dans des fichiers internes au conteneur.

### Cibles de logs

- `backend` : logs applicatifs structurés en `JSON`
- `frontend Angular` : erreurs fonctionnelles et techniques côté navigateur
- `nginx frontend` : `access log` et `error log`
- `MariaDB` : logs du serveur SQL
- `Redis` : logs runtime et erreurs

### Règles d'implémentation

- Le `backend` doit utiliser un logger structuré type `Pino` ou `Winston JSON`.
- Chaque log backend doit idéalement embarquer `timestamp`, `level`, `service`, `requestId`, `userId` si disponible, et message.
- `nginx` doit écrire ses `access_log` vers `/dev/stdout` et ses `error_log` vers `/dev/stderr`.
- `MariaDB` et `Redis` doivent laisser leurs logs remonter au runtime du conteneur.
- Le `frontend Angular` n'a pas de logs serveur par nature : ses erreurs runtime doivent être soit visibles dans le navigateur, soit remontées à une API de collecte si ce besoin existe.

### Local avec Docker Compose

En local, les logs doivent être consultables sans outil supplémentaire :

- `docker compose logs -f frontend`
- `docker compose logs -f backend`
- `docker compose logs -f db`
- `docker compose logs -f redis`
- `docker compose logs -f`

Pour `frontend`, il faut distinguer deux choses :

- les logs `nginx` du conteneur, visibles via `docker compose logs`
- les erreurs Angular dans le navigateur, visibles via DevTools ou une remontée centralisée future

### OpenShift

Sur OpenShift, les logs doivent être disponibles au minimum via les mécanismes natifs :

- `oc logs deployment/propriateraydb-backend`
- `oc logs deployment/propriateraydb-frontend`
- `oc logs statefulset/propriateraydb-mariadb`
- `oc logs statefulset/propriateraydb-redis`

Si la plateforme client expose une stack centralisée, il faut s'y brancher :

- `OpenShift Logging`
- `EFK` / `ELK`
- `Loki` / `Grafana`

### Niveau de maturité recommandé

- V1 minimale : logs disponibles via `docker compose logs` en local et `oc logs` sur OpenShift
- V2 recommandée : agrégation centralisée, rétention, recherche plein texte, dashboards et alerting

### Impacts sur la structure du dépôt

Les emplacements suivants sont à prévoir :

- `backend/src/config/logger.ts`
- `docker/nginx/nginx.conf`
- `docs/observability.md`

## Flux CI/CD cible

```text
feature/* branch
  -> lint
  -> test

main branch
  -> lint
  -> test
  -> build frontend image
  -> build backend image
  -> push images registry
  -> récupération des digests
  -> helm upgrade --install
  -> rollout status
```

### Règles CI/CD

- Ne pas déployer `latest`.
- Pousser des tags de traçabilité comme `:$CI_COMMIT_SHORT_SHA`.
- Déployer uniquement par `digest` : `image@sha256:...`.
- Ne pas modifier les manifests avec `sed`.
- Le chart `Helm` reçoit les digests via `--set`.

## Structure cible du dépôt

```text
propriateraydb-app/
│
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── core/
│   │   │   │   ├── auth/
│   │   │   │   └── interceptors/
│   │   │   ├── shared/
│   │   │   ├── features/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── analyse-soutien/
│   │   │   │   └── rapports/
│   │   │   └── app-routing.module.ts
│   │   └── environments/
│   ├── nginx.conf
│   └── Dockerfile
│
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── db.ts
│   │   │   ├── logger.ts
│   │   │   └── env.ts
│   │   ├── middleware/
│   │   │   ├── auth.ts
│   │   │   ├── error-handler.ts
│   │   │   └── validator.ts
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   │   ├── saml.strategy.ts
│   │   │   │   ├── auth.controller.ts
│   │   │   │   ├── auth.routes.ts
│   │   │   │   └── session.store.ts
│   │   │   ├── articles/
│   │   │   ├── analyses/
│   │   │   └── rapports/
│   │   ├── integrations/
│   │   │   ├── itk/
│   │   │   │   ├── itk.client.ts
│   │   │   │   └── itk.mock.ts
│   │   │   ├── propriateraydb/
│   │   │   │   ├── xml.parser.ts
│   │   │   │   ├── xsd.validator.ts
│   │   │   │   └── propriateraydb.mock.ts
│   │   │   └── nas/
│   │   │       └── nas.client.ts
│   │   ├── app.ts
│   │   └── server.ts
│   ├── tests/
│   │   ├── unit/
│   │   └── integration/
│   ├── tsconfig.json
│   └── Dockerfile
│
├── db/
│   ├── migrations/
│   ├── seeds/
│   └── schema.sql
│
├── docker/
│   ├── nginx/
│   │   └── nginx.conf
│   ├── mariadb/
│   │   └── init.sql
│   └── redis/
│       └── redis.conf
│
├── helm/
│   └── propriateraydb/
│       ├── Chart.yaml
│       ├── values.yaml
│       ├── values-recette.yaml
│       ├── values-production.yaml
│       └── templates/
│           ├── _helpers.tpl
│           ├── frontend-deployment.yaml
│           ├── frontend-service.yaml
│           ├── frontend-route.yaml
│           ├── backend-deployment.yaml
│           ├── backend-service.yaml
│           ├── backend-configmap.yaml
│           ├── backend-secret.yaml
│           ├── mariadb-statefulset.yaml
│           ├── mariadb-service.yaml
│           ├── mariadb-secret.yaml
│           ├── redis-statefulset.yaml
│           ├── redis-service.yaml
│           ├── redis-secret.yaml
│           ├── networkpolicy.yaml
│           └── serviceaccount.yaml
│
├── .gitlab-ci.yml
├── .gitlab/
│   └── ci/
│       ├── lint.yml
│       ├── test.yml
│       ├── build.yml
│       └── deploy.yml
│
├── docs/
│   ├── spec-logicielle.md
│   ├── env-deploiement.md
│   ├── itk-api-notes.md
│   ├── observability.md
│   └── openshift-setup.md
│
├── docker-compose.yml
├── docker-compose.dev.yml
├── docker-compose.test.yml
├── .env.example
└── README.md
```

## Architecture locale complète

### Vue d'ensemble

```text
Navigateur
   |
   v
frontend (Angular build servi par nginx)
   |
   v
backend (Express + TypeScript + SAML SP)
   |-------------------------------> ITK mock ou API réelle
   |-------------------------------> PropriaterayDB mock ou XML/XSD réel
   |-------------------------------> NAS XML
   |
   +--> MariaDB
   |
   +--> Redis pour sessions partagées ou survivance au crash (optionnel mais recommandé)
```

### Règles locales

- `MariaDB` est toujours présente.
- `Redis` peut être lancé via un profil `docker compose` dédié.
- Le backend doit pouvoir démarrer avec `SESSION_STORE=memory` ou `SESSION_STORE=redis`.
- Pour le dev isolé, prévoir `AUTH_MODE=mock` si l'`IdP SAML` n'est pas disponible.
- Pour les tests d'intégration SSO, prévoir un `IdP` de test ou un environnement client dédié.
- Les logs `frontend`, `backend`, `nginx`, `MariaDB` et `Redis` doivent être lisibles via `docker compose logs`.

### Exemple de `docker-compose.yml`

```yaml
services:
  frontend:
    build: ./frontend
    ports:
      - "4200:80"
    depends_on:
      - backend

  backend:
    build: ./backend
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: development
      AUTH_MODE: mock
      SESSION_STORE: redis
      DB_HOST: db
      DB_PORT: 3306
      DB_NAME: propriateraydb
      DB_USER: propriateraydb
      DB_PASSWORD: propriateraydb
      REDIS_HOST: redis
      REDIS_PORT: 6379
      ITK_MOCK: "true"
      PROPRIATERAYDB_MOCK: "true"
    depends_on:
      - db
      - redis

  db:
    image: mariadb:10.11
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: propriateraydb
      MYSQL_USER: propriateraydb
      MYSQL_PASSWORD: propriateraydb
    volumes:
      - db_data:/var/lib/mysql
      - ./docker/mariadb/init.sql:/docker-entrypoint-initdb.d/init.sql:ro

  redis:
    image: redis:7-alpine
    command: ["redis-server", "/usr/local/etc/redis/redis.conf"]
    profiles: ["session-store"]
    volumes:
      - ./docker/redis/redis.conf:/usr/local/etc/redis/redis.conf:ro
      - redis_data:/data

volumes:
  db_data:
  redis_data:
```

## Architecture OpenShift complète

### Vue d'ensemble

```text
Utilisateur
   |
   v
OpenShift Route
   |
   v
frontend Service
   |
   v
frontend Deployment
   |
   v
backend Service
   |
   v
backend Deployment
   |-------------------------------> Active Directory / IdP SAML
   |-------------------------------> API ITK
   |-------------------------------> NAS XML
   |
   +--> mariadb Service --> mariadb StatefulSet --> PVC
   |
   +--> redis Service --> redis StatefulSet      (recommandé si session persistante)
```

### Topologie minimale de production

- `frontend`: `Deployment` + `Service` + `Route`
- `backend`: `Deployment` + `Service` + `ConfigMap` + `Secret`
- `mariadb`: `StatefulSet` + `Service` + `PVC`
- `redis`: `StatefulSet` + `Service` si la session doit survivre à un redémarrage backend

### Position retenue pour la prod

- `MariaDB` doit être présente dans OpenShift.
- `MariaDB` tourne en `StatefulSet` mono-réplique.
- Pas de HA base de données au départ.
- Prévoir malgré tout une stratégie de sauvegarde et restauration.
- `Redis` est recommandé si l'application doit garder les sessions après crash du backend.
- Le backend doit être surveillé par probes et redémarré automatiquement par le `Deployment`.
- Les logs de chaque pod doivent être disponibles via `oc logs`, avec branchement sur la solution de centralisation du client si elle existe.

### Ce qu'un déploiement backend complet doit contenir

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: propriateraydb-backend
spec:
  replicas: 1
  selector:
    matchLabels:
      app: propriateraydb-backend
  template:
    metadata:
      labels:
        app: propriateraydb-backend
    spec:
      containers:
        - name: backend
          image: registry.gitlab.com/ton-groupe/propriateraydb-app/backend@sha256:IMAGE_DIGEST
          ports:
            - containerPort: 3000
          envFrom:
            - configMapRef:
                name: propriateraydb-backend-config
            - secretRef:
                name: propriateraydb-backend-secrets
          startupProbe:
            httpGet:
              path: /health/startup
              port: 3000
            failureThreshold: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 3000
          livenessProbe:
            httpGet:
              path: /health/live
              port: 3000
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            runAsNonRoot: true
```

### Ce qu'un StatefulSet MariaDB complet doit contenir

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: propriateraydb-mariadb
spec:
  serviceName: propriateraydb-mariadb
  replicas: 1
  selector:
    matchLabels:
      app: propriateraydb-mariadb
  template:
    metadata:
      labels:
        app: propriateraydb-mariadb
    spec:
      containers:
        - name: mariadb
          image: mariadb:10.11
          ports:
            - containerPort: 3306
          envFrom:
            - secretRef:
                name: propriateraydb-mariadb-secrets
          volumeMounts:
            - name: mariadb-data
              mountPath: /var/lib/mysql
  volumeClaimTemplates:
    - metadata:
        name: mariadb-data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 10Gi
```

### Redis côté OpenShift

Deux options raisonnables :

- `disabled` si on accepte de perdre les sessions au redémarrage
- `enabled` si `backend.sessionStore=redis` ou si la session doit survivre au crash backend

Si activé :

- `1 replica` suffit
- `Service` interne uniquement
- persistance facultative selon usage
- pas de HA nécessaire au départ

## Helm

### Exemple de `values-production.yaml`

```yaml
frontend:
  replicas: 1
  image:
    repository: registry.gitlab.com/ton-groupe/propriateraydb-app/frontend
    digest: ""

backend:
  replicas: 1
  image:
    repository: registry.gitlab.com/ton-groupe/propriateraydb-app/backend
    digest: ""
  auth:
    mode: saml
    sessionStore: redis

mariadb:
  enabled: true
  size: 10Gi

redis:
  enabled: true
```

### Règle de scaling

- Si `backend.replicas=1`, `sessionStore=memory` reste possible mais les sessions sautent au redémarrage.
- Si `backend.replicas>1`, passer `sessionStore=redis`.
- Si la continuité de session est requise, utiliser `sessionStore=redis` même avec `1 replica`.

## GitLab CI/CD

### Emplacement des fichiers

- Le pipeline principal doit être à la racine : `.gitlab-ci.yml`
- Les jobs factorisés restent dans `.gitlab/ci/`

### Exemple de `.gitlab-ci.yml`

```yaml
include:
  - local: .gitlab/ci/lint.yml
  - local: .gitlab/ci/test.yml
  - local: .gitlab/ci/build.yml
  - local: .gitlab/ci/deploy.yml

stages:
  - lint
  - test
  - build
  - deploy

variables:
  REGISTRY: registry.gitlab.com/ton-groupe/propriateraydb-app
  IMAGE_FRONTEND: $REGISTRY/frontend
  IMAGE_BACKEND: $REGISTRY/backend
```

### Déploiement Helm par digest

```yaml
deploy:
  stage: deploy
  image: alpine/helm:3.15.4
  only:
    - main
  script:
    - helm upgrade --install propriateraydb ./helm/propriateraydb \
        --namespace propriateraydb \
        --create-namespace \
        -f ./helm/propriateraydb/values-production.yaml \
        --set frontend.image.digest=$FRONTEND_IMAGE_DIGEST \
        --set backend.image.digest=$BACKEND_IMAGE_DIGEST
```

## Résumé de la cible

- `SAML` se termine côté backend.
- `Redis` est recommandé si l'application doit garder les sessions après crash backend.
- `MariaDB` existe en local et en prod.
- `MariaDB` en prod = `StatefulSet`, `1 replica`, sans HA.
- Le chien de garde backend repose sur `startupProbe`, `readinessProbe`, `livenessProbe` et le `Deployment` OpenShift.
- L'observabilité minimale impose des logs disponibles en local via `docker compose logs` et en distant via `oc logs`.
- L'architecture locale est complète avec `frontend`, `backend`, `MariaDB` et `Redis`.
- L'architecture OpenShift est complète avec `frontend`, `backend`, `MariaDB` et `Redis` selon le besoin de persistance de session.
- Le déploiement OpenShift passe par `Helm` et des images référencées par `digest`.
- Le pipeline principal est bien `.gitlab-ci.yml` à la racine.
