# PropriaterayDB Web Service

## Architecture cible

### Décisions retenues

```text
Frontend        : Angular
Backend         : Node.js + Express.js + TypeScript
Base de données : MariaDB
Auth            : SSO Active Directory via OpenID Connect (OIDC)
Cache / Session : Redis optionnel
Containerisation: Docker + Docker Compose
Orchestration   : OpenShift
Packaging       : Helm
Registry images : Harbor on-premise
Registry npm    : Sonatype Nexus entreprise
CI/CD           : GitLab CI/CD -> build -> push registry -> deploy Helm sur OpenShift
Versionning     : GitLab
Intégrations    : API ITK, flux PropriaterayDB XML/XSD, dossier NAS Samba monté côté backend
```

### Ce qui est acté

- `OpenID Connect` remplace `SAML` et la terminaison SSO se fait côté `backend`.
- Le backend passe en `TypeScript`.
- `MariaDB` existe en local et en production.
- En production, `MariaDB` tourne en `StatefulSet`, `1 replica`, sans HA.
- Le déploiement OpenShift se fait via `Helm`.
- Les images sont déployées par `digest`, pas par `latest`.
- Le pipeline principal est au chemin racine `.gitlab-ci.yml`.
- Les images Docker sont poussées dans `Harbor` on-premise.
- Les dépendances npm passent par le `Sonatype Nexus` entreprise via `.npmrc`.
- Le développement se fait dans un conteneur basé sur `Red Hat UBI` contenant les outils requis.
- Le `NAS` est un dossier partagé via `SMB/Samba`, monté comme dossier local dans le pod ou le conteneur backend.
- `Redis` reste optionnel : prévu dans l'architecture, désactivé par défaut.
- Le backend doit avoir un vrai `chien de garde` côté plateforme : probes, redémarrage automatique et supervision applicative.
- L'observabilité doit couvrir les logs `frontend`, `backend`, `nginx`, `MariaDB` et `Redis` en local comme sur OpenShift.

## Pourquoi OIDC côté backend

`OpenID Connect` est le protocole SSO cible. Le faire terminer dans le backend reste le choix le plus propre pour ce contexte, car l'application peut utiliser un client confidentiel et garder les secrets côté serveur.

- Le `client secret` OIDC reste côté serveur.
- Le backend peut transformer les tokens OIDC en session applicative simple pour Angular.
- Le frontend n'a pas à manipuler directement les tokens OIDC ni le secret client.
- Le mapping des groupes `Active Directory` vers les rôles applicatifs est centralisé.
- Les cookies de session peuvent être émis en `HttpOnly`, `Secure`, `SameSite`.

En pratique :

- `Angular` consomme l'application.
- Le `backend` joue le rôle de client confidentiel OIDC.
- Après authentification, le backend crée une session applicative ou émet un cookie de session signé.
- Les paramètres attendus sont `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI` et `OIDC_SCOPE`.

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
- on choisit une approche stateless après le login `OIDC`
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

Le smoke test local vérifie que la stack Compose démarre, que le backend est prêt, que le frontend répond, et que le proxy `/api/health` du frontend rejoint bien le backend :

```bash
scripts/smoke-compose.sh
```

Le script nettoie la stack à la fin avec `docker compose down --volumes --remove-orphans`. Les variables `COMPOSE_PROJECT_NAME`, `SMOKE_FRONTEND_URL`, `SMOKE_BACKEND_URL` et `SMOKE_TIMEOUT_SECONDS` permettent d'adapter le test si les ports locaux sont différents.

### Réseau frontend / backend

Le frontend est le seul point d'entrée HTTP public recommandé. Il sert les fichiers statiques Angular avec `nginx` et reverse-proxy les chemins backend nécessaires.

```text
Navigateur
  -> frontend nginx
     -> /           : fichiers statiques Angular
     -> /api/*      : proxy vers backend:3000
     -> /auth/*     : proxy vers backend:3000 pour OIDC login/callback/logout
```

En local Docker Compose :

- `http://localhost:4200` expose le frontend `nginx` sur le port conteneur `80`.
- `http://localhost:3000` expose aussi le backend directement pour debug local.
- Le frontend joint le backend avec le nom réseau `propriateraydb-backend:3000`, défini comme alias Compose.
- Le backend joint `db:3306`, `redis:6379`, le NAS monté sur `/mnt/nas/xml`, et l'IdP OIDC externe si `AUTH_MODE=oidc`.

En OpenShift :

- La `Route` publique pointe vers le `frontend Service`.
- Le `backend Service` reste interne au namespace.
- Le navigateur ne doit pas appeler directement le backend ; il passe par le même host frontend pour `/api/*` et `/auth/*`.
- Les `NetworkPolicy` autorisent explicitement `frontend -> backend`, puis `backend -> MariaDB/Redis/DNS`.

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
  -> lint + helm lint/template
  -> test
  -> quality sonarqube

main branch
  -> lint + helm lint/template
  -> test
  -> quality sonarqube
  -> smoke backend avec services MariaDB/Redis
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
- La quality gate `SonarQube` bloque le pipeline avant le smoke, le build image et le déploiement.
- Le pipeline GitLab par défaut ne nécessite pas de Docker daemon : les images sont construites avec `buildah`, et le smoke CI utilise des services GitLab `MariaDB`/`Redis` au lieu de `Docker-in-Docker`.
- Le smoke Docker Compose reste un test local ou un test à lancer sur runner dédié disposant déjà d'un moteur Docker. Un vrai `docker compose up` en CI nécessite forcément un moteur Docker, via runner privilégié, socket hôte ou runtime équivalent.

## Inventaire des images Docker

Cet inventaire liste les images référencées directement par le dépôt. En environnement entreprise fermé, les images publiques doivent être recopiées ou proxyfiées dans `Harbor` avant usage par la CI/CD ou OpenShift.

### Images applicatives produites

| Image | Usage | Source de configuration |
| --- | --- | --- |
| `harbor.example.com/propriateraydb/frontend` | Image frontend servie par `nginx`, construite depuis `frontend/Dockerfile` puis poussée dans Harbor | `IMAGE_FRONTEND`, `frontend.image.repository` |
| `harbor.example.com/propriateraydb/backend` | Image backend Node.js/Express, construite depuis `backend/Dockerfile` puis poussée dans Harbor | `IMAGE_BACKEND`, `backend.image.repository` |
| `harbor.example.com/propriateraydb/ci-tools:ubi9` | Image d'outillage CI/dev basée sur UBI, contenant `node`, `npm`, `helm`, `oc`, `docker`, `docker compose`, `openssl` | `CI_TOOLS_IMAGE`, `docker/dev/Dockerfile` |

### Images de base des Dockerfiles

| Image | Usage | Fichier |
| --- | --- | --- |
| `node:22-alpine` | Build et runtime du backend | `backend/Dockerfile` |
| `nginx:1.27-alpine` | Runtime du frontend statique | `frontend/Dockerfile` |
| `registry.access.redhat.com/ubi9/ubi:9.5` | Base du conteneur de développement et d'outillage CI | `docker/dev/Dockerfile` |

### Images de services locaux et Helm

| Image | Usage | Source de configuration |
| --- | --- | --- |
| `mariadb:10.11` | Base de données locale Docker Compose, service GitLab de smoke CI, et StatefulSet OpenShift via Helm | `docker-compose.yml`, `smoke_backend_services`, `mariadb.image.repository`, `mariadb.image.tag` |
| `redis:7-alpine` | Store de session/cache local Docker Compose, service GitLab de smoke CI, et StatefulSet OpenShift via Helm | `docker-compose.yml`, `smoke_backend_services`, `redis.image.repository`, `redis.image.tag` |

### Images CI/CD

| Image | Usage | Source de configuration |
| --- | --- | --- |
| `quay.io/buildah/stable:v1.43.1` | Build et push des images applicatives sans Docker daemon | `BUILDAH_IMAGE`, `.gitlab/ci/build.yml` |
| `sonarsource/sonar-scanner-cli:5.0.1` | Analyse SonarQube et attente de quality gate | `SONAR_SCANNER_IMAGE`, `.gitlab/ci/quality.yml` |
| `$CI_TOOLS_IMAGE` | Jobs `lint`, `test`, `smoke_backend_services` et `deploy` | `.gitlab/ci/*.yml` |

### Règles de gestion

- Les images applicatives doivent être poussées dans `Harbor` avec le tag `:$CI_COMMIT_SHORT_SHA`.
- Le déploiement OpenShift doit utiliser les digests produits par la CI, pas `latest`.
- Les images publiques `node`, `nginx`, `mariadb`, `redis`, `buildah`, `sonar-scanner-cli` et `ubi` doivent être validées par l'entreprise et idéalement mirrorées dans `Harbor`.
- Les valeurs Helm `repository` et `tag` restent paramétrables pour remplacer les images publiques par des miroirs internes.

## Configuration enterprise

Les adresses enterprise ne doivent pas être codées en dur dans le code applicatif. Elles sont portées par les variables CI/CD GitLab, les fichiers `values-*.yaml` Helm et, pour le poste de dev, par l'environnement du conteneur de développement.

### Task list de démarrage enterprise

Cette liste sert à préparer l'environnement avant le premier déploiement. L'objectif est de récupérer les contacts, accès, URLs et secrets nécessaires sans bloquer la CI/CD au dernier moment.

| Priorité | Sujet | Contact à identifier | À demander | Livrable attendu |
| --- | --- | --- | --- | --- |
| P0 | OpenShift | Équipe plateforme OpenShift | URL API, namespaces `dev/recette/prod`, quotas, storage classes, contraintes réseau, standard Route/TLS | `OPENSHIFT_SERVER`, `OPENSHIFT_NAMESPACE`, règles projet, contraintes SCC/NetworkPolicy |
| P0 | Déploiement OpenShift | Équipe plateforme OpenShift ou DevOps | Service account de déploiement, token, droits Helm, accès `oc`, règle de création namespace | `OPENSHIFT_TOKEN` masqué dans GitLab, compte de service documenté |
| P0 | Harbor | Équipe registry / container platform | Projet Harbor, robot account push/pull, règles de rétention, scan d'images, mirroring images publiques | `HARBOR_REGISTRY`, `HARBOR_PROJECT`, `HARBOR_USERNAME`, `HARBOR_PASSWORD` |
| P0 | Nexus npm | Équipe artifact repository | URL du repo npm group/proxy, token technique, CA entreprise, règles de publication si besoin | `NPM_REGISTRY_URL`, `NPM_REGISTRY_AUTH_PATH`, `NPM_TOKEN` |
| P0 | OIDC / SSO | Équipe IAM / Active Directory | Création client OIDC confidentiel, redirect URI, scopes, claims groupes, utilisateurs de test | `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, mapping groupes/rôles |
| P0 | Secrets | Équipe sécurité / plateforme | Mécanisme cible pour secrets OpenShift : Vault, ExternalSecret, SealedSecret ou injection CI | Secrets applicatifs créés hors Helm avant déploiement |
| P0 | DNS / FQDN | Équipe DNS / réseau | Nom public de l'application, zone DNS, routage vers OpenShift Apps | `OPENSHIFT_ROUTE_HOST` réservé et routable |
| P0 | PKI TLS | Équipe PKI / cybersécurité | Processus CSR, CA utilisée, chaîne de certificats, durée, renouvellement | Certificat signé ou confirmation d'un wildcard/ingress cert géré plateforme |
| P1 | NAS Samba | Équipe stockage / plateforme | Partage SMB, mode lecture/écriture, compte technique si requis, montage OpenShift via PV/PVC | `backend.nas.existingClaim`, `NAS_XML_PATH`, test de lecture fichier |
| P1 | Réseau / firewall | Équipe réseau / sécurité | Flux sortants backend vers IdP OIDC, API ITK, DNS, NAS si applicable, accès Harbor/Nexus/Sonar depuis runners | Matrice de flux validée et règles firewall ouvertes |
| P1 | SonarQube | Équipe qualité / DevSecOps | Projet SonarQube, quality gate, token technique, image scanner mirrorée si requis | `SONAR_HOST_URL`, `SONAR_PROJECT_KEY`, `SONAR_TOKEN` |
| P1 | GitLab | Équipe GitLab / DevOps | Variables masquées/protégées, runners non privilégiés, protection branches/tags, règles merge request | Variables CI créées, pipeline MR et `main` validés |
| P1 | Images de base | Équipe sécurité container | Validation ou mirroring de `node`, `nginx`, `mariadb`, `redis`, `buildah`, `sonar-scanner-cli`, `ubi` | Liste d'images internes Harbor ou exceptions validées |
| P1 | Observabilité | Équipe exploitation | Stack logs, rétention, dashboards, alerting, accès `oc logs` | Process de consultation logs et alertes de base |
| P1 | Base de données | DBA / équipe plateforme | Politique MariaDB embarquée vs service managé, backup/restore, stockage, mot de passe root/app | Stratégie DB validée et test restauration prévu |
| P2 | Poste de dev | Équipe poste / sécurité | Accès Docker ou Podman, proxy entreprise, CA racine, accès Nexus/Harbor/OpenShift | Conteneur dev UBI buildable et utilisable |

### Ordre recommandé

1. Valider les contacts et propriétaires pour `OpenShift`, `Harbor`, `Nexus`, `OIDC`, `PKI`, `GitLab`.
2. Créer les projets techniques : namespace OpenShift, projet Harbor, projet SonarQube, client OIDC.
3. Créer les comptes techniques et variables GitLab masquées/protégées.
4. Valider le build CI sans Docker daemon avec `buildah`.
5. Valider le smoke backend avec services GitLab `MariaDB` et `Redis`.
6. Valider le chart Helm en recette avec images par digest.
7. Valider la Route frontend, le certificat TLS, les flux `/api/*` et `/auth/*`.
8. Valider les flux externes backend : IdP OIDC, API ITK, DNS, NAS.
9. Valider observabilité, sauvegarde MariaDB et procédure rollback.
10. Promouvoir en production seulement après quality gate SonarQube, smoke, scan image et validation exploitation.

### Critères de prêt pour recette

- Les variables GitLab `OPENSHIFT_*`, `HARBOR_*`, `NPM_*` et `SONAR_*` sont créées et protégées.
- Les valeurs applicatives `OIDC_*`, `SESSION_SECRET`, mots de passe DB/Redis et configuration NAS sont injectées par Helm ou secret manager.
- Les images applicatives sont construites et poussées dans Harbor par digest.
- La Route OpenShift répond en HTTPS avec certificat validé entreprise.
- Le frontend proxy `/api/*` et `/auth/*` vers le backend.
- Le backend accède à MariaDB, Redis si activé, OIDC, ITK et NAS selon les règles réseau validées.
- Les secrets ne sont plus stockés en clair dans les values de production.
- Les logs sont consultables via `oc logs` ou la stack centralisée.
- Le rollback Helm et la restauration MariaDB ont une procédure identifiée.

### Variables CI GitLab à créer

Les variables dérivées suivantes existent déjà dans `.gitlab-ci.yml` et ne sont pas à créer manuellement sauf si l'entreprise veut surcharger les valeurs : `REGISTRY`, `IMAGE_FRONTEND`, `IMAGE_BACKEND`, `CI_TOOLS_IMAGE`.

| Variable GitLab | Obligatoire | Protection | Exemple | Utilisée par |
| --- | --- | --- | --- | --- |
| `HARBOR_REGISTRY` | Oui | Non masquée, protégée | `harbor.example.com` | Tous les jobs, build images |
| `HARBOR_PROJECT` | Oui | Non masquée, protégée | `propriateraydb` | Tous les jobs, build images |
| `HARBOR_USERNAME` | Oui | Masquée, protégée | `robot$propriateraydb+ci` | `build` |
| `HARBOR_PASSWORD` | Oui | Masquée, protégée | mot de passe robot Harbor | `build` |
| `BUILDAH_IMAGE` | Oui si image mirrorée | Non masquée, protégée | `harbor.example.com/tools/buildah:v1.43.1` | `build` |
| `SONAR_SCANNER_IMAGE` | Oui si image mirrorée | Non masquée, protégée | `harbor.example.com/tools/sonar-scanner-cli:5.0.1` | `sonarqube` |
| `NPM_REGISTRY_URL` | Oui en entreprise | Non masquée, protégée | `https://nexus.example.com/repository/npm-group/` | `test`, `smoke_backend_services`, `build` |
| `NPM_REGISTRY_AUTH_PATH` | Oui si Nexus requiert auth | Non masquée, protégée | `nexus.example.com/repository/npm-group/` | `test`, `smoke_backend_services`, `build` |
| `NPM_TOKEN` | Oui si Nexus requiert auth | Masquée, protégée | token npm technique | `test`, `smoke_backend_services`, `build` |
| `NPM_STRICT_SSL` | Optionnelle | Non masquée | `true` | `test`, `smoke_backend_services`, `build` |
| `SONAR_HOST_URL` | Oui | Non masquée, protégée | `https://sonarqube.example.com` | `sonarqube` |
| `SONAR_PROJECT_KEY` | Oui | Non masquée, protégée | `propriateraydb-web-service` | `sonarqube` |
| `SONAR_TOKEN` | Oui | Masquée, protégée | token projet SonarQube | `sonarqube` |
| `OPENSHIFT_SERVER` | Oui pour deploy | Non masquée, protégée | `https://api.ocp.example.com:6443` | `deploy` |
| `OPENSHIFT_NAMESPACE` | Oui pour deploy | Non masquée, protégée | `propriateraydb-recette` | `deploy` |
| `OPENSHIFT_TOKEN` | Oui pour deploy | Masquée, protégée | token service account OpenShift | `deploy` |
| `OPENSHIFT_ROUTE_HOST` | Oui pour deploy | Non masquée, protégée | `propriateraydb.apps.ocp.example.com` | `deploy`, Helm Route |
| `OPENSHIFT_INSECURE_SKIP_TLS_VERIFY` | Optionnelle | Non masquée | `false` | `deploy` |
| `OPENSHIFT_CA_PEM` | Optionnelle | Non masquée, protégée | certificat CA PEM | `deploy` |

### Variables applicatives à injecter par Helm ou secret manager

Ces valeurs ne sont pas toutes consommées directement par `.gitlab-ci.yml` aujourd'hui. Elles doivent être injectées dans Helm via values d'environnement, `ExternalSecret`, Vault, SealedSecret ou mécanisme équivalent.

| Variable / value | Obligatoire | Sensible | Exemple | Usage |
| --- | --- | --- | --- | --- |
| `backend.oidc.issuerUrl` / `OIDC_ISSUER_URL` | Oui en OIDC | Non | `https://idp.example.com/realms/propriateraydb` | Découverte OIDC |
| `backend.oidc.clientId` / `OIDC_CLIENT_ID` | Oui en OIDC | Non | `propriateraydb-backend` | Client OIDC |
| `backend.secret.existingName` / `OIDC_CLIENT_SECRET` | Oui en OIDC | Oui | secret client | Backend auth |
| `backend.oidc.redirectUri` / `OIDC_REDIRECT_URI` | Oui en OIDC | Non | `https://propriateraydb.example.com/auth/callback` | Callback OIDC |
| `backend.oidc.scope` / `OIDC_SCOPE` | Oui en OIDC | Non | `openid profile email` | Scopes OIDC |
| `backend.secret.existingName` / `SESSION_SECRET` | Oui | Oui | secret long aléatoire | Signature session |
| `mariadb.secret.existingName` / `MYSQL_PASSWORD` / `DB_PASSWORD` | Oui | Oui | mot de passe app DB | Backend vers MariaDB |
| `mariadb.secret.existingName` / `MYSQL_ROOT_PASSWORD` | Oui si MariaDB embarquée | Oui | mot de passe root DB | Init MariaDB |
| `redis.secret.existingName` / `REDIS_PASSWORD` | Oui si Redis activé | Oui | mot de passe Redis | Sessions Redis |
| `backend.nas.existingClaim` | Oui si NAS activé | Non | `propriateraydb-nas-pvc` | Montage NAS OpenShift |
| `backend.nas.mountPath` / `NAS_XML_PATH` | Oui si NAS activé | Non | `/mnt/nas/xml` | Lecture fichiers NAS |

### OpenShift

L'adresse de l'API OpenShift se configure dans `OPENSHIFT_SERVER` pour la CI/CD. En local, elle se configure avec `oc login`.

```bash
export OPENSHIFT_SERVER="https://api.ocp.example.com:6443"
export OPENSHIFT_NAMESPACE="propriateraydb"
oc login "$OPENSHIFT_SERVER"
oc project "$OPENSHIFT_NAMESPACE"
```

Le host public de l'application n'est pas l'adresse API OpenShift. Il se configure via `OPENSHIFT_ROUTE_HOST` dans la CI/CD ou `frontend.route.host` dans Helm.

### Harbor

Le repository d'images cible est construit comme suit :

```text
HARBOR_REGISTRY/HARBOR_PROJECT/frontend
HARBOR_REGISTRY/HARBOR_PROJECT/backend
HARBOR_REGISTRY/HARBOR_PROJECT/ci-tools:ubi9
```

La CI/CD pousse les images avec le tag `:$CI_COMMIT_SHORT_SHA`, récupère les digests et déploie Helm avec `frontend.image.digest` et `backend.image.digest`.

### Nexus npm

Le fichier `.npmrc.example` sert de modèle. Ne pas committer un `.npmrc` contenant un token personnel.

```bash
export NPM_REGISTRY_URL="https://nexus.example.com/repository/npm-group/"
export NPM_REGISTRY_AUTH_PATH="nexus.example.com/repository/npm-group/"
export NPM_TOKEN="***"
cp .npmrc.example .npmrc
npm ci --prefix backend
```

En CI, le fichier `backend/.npmrc.example` est remplacé temporairement à partir des variables GitLab avant le build `buildah`. Ce fichier est utilisé uniquement dans les stages intermédiaires du `backend/Dockerfile`, puis supprimé avant la copie vers l'image finale. Le build `buildah` utilise `--layers=false` pour éviter de publier une couche intermédiaire contenant la configuration npm.

### SonarQube

L'analyse qualité est configurée par `sonar-project.properties` et exécutée par le job GitLab `sonarqube`. Le job utilise `SONAR_HOST_URL`, `SONAR_PROJECT_KEY` et `SONAR_TOKEN`, puis attend la quality gate avec `sonar.qualitygate.wait=true`.

```bash
export SONAR_HOST_URL="https://sonarqube.example.com"
export SONAR_PROJECT_KEY="propriateraydb-web-service"
export SONAR_TOKEN="***"
sonar-scanner \
  -Dsonar.host.url="$SONAR_HOST_URL" \
  -Dsonar.token="$SONAR_TOKEN" \
  -Dsonar.projectKey="$SONAR_PROJECT_KEY" \
  -Dsonar.qualitygate.wait=true
```

Le token doit être un token technique GitLab masqué et protégé. Si l'entreprise impose un scanner mirroré, remplacer `SONAR_SCANNER_IMAGE` par l'image interne Harbor équivalente.

### Conteneur de développement UBI

Le développement doit se faire dans l'image `docker/dev/Dockerfile`, basée sur `Red Hat UBI`. Elle contient au minimum `node`, `npm`, `openssl`, `helm`, `oc`, `kubectl`, `docker`, `docker compose`, `git` et `jq`.

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile devtools build devtools
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile devtools run --rm devtools bash
```

Pour construire et pousser l'image d'outillage dans Harbor :

```bash
docker build -t "$HARBOR_REGISTRY/$HARBOR_PROJECT/ci-tools:ubi9" -f docker/dev/Dockerfile .
docker push "$HARBOR_REGISTRY/$HARBOR_PROJECT/ci-tools:ubi9"
```

### NAS Samba

Le NAS n'est pas un service applicatif. C'est un dossier partagé via `SMB/Samba` qui doit être monté dans le filesystem visible du backend.

- En local, monter le partage Samba sur la machine hôte, puis exposer ce dossier dans `docker-compose.yml` vers `/mnt/nas/xml`. Pour du dev sans NAS réel, le dossier `./data/nas` est monté au même endroit.
- Sur OpenShift, demander à l'équipe plateforme un `PV/PVC` connecté au partage Samba via le mécanisme standard de l'entreprise, puis configurer `backend.nas.enabled=true`, `backend.nas.existingClaim` et `backend.nas.mountPath`.
- Le backend lit les fichiers via `NAS_XML_PATH`. Il ne doit pas embarquer de logique de montage SMB ni de credentials Samba.

### Certificat TLS/SSL

Le certificat de la Route OpenShift doit suivre le processus PKI de l'entreprise. Les personnes à faire intervenir sont généralement l'équipe PKI/cybersécurité pour la signature, l'équipe DNS/réseau pour le FQDN, et l'équipe OpenShift pour l'installation sur la Route ou l'ingress.

Commandes rapides pour générer une clé et une CSR :

```bash
export TLS_CN="propriateraydb.apps.ocp.example.com"
openssl genrsa -out tls.key 2048
openssl req -new -key tls.key -out tls.csr -subj "/C=FR/O=Entreprise/CN=${TLS_CN}"
openssl req -in tls.csr -noout -text
```

Le fichier `tls.csr` est transmis à la PKI entreprise. Le fichier `tls.key` reste secret et ne doit jamais être committé. Après signature, l'équipe OpenShift installe le certificat signé sur la Route selon le standard de la plateforme. Si la plateforme utilise un certificat wildcard ou un ingress certificate géré centralement, aucune clé applicative n'est à générer dans ce dépôt.

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
│   │   │   │   ├── oidc.client.ts
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
│   ├── dev/
│   │   └── Dockerfile
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
│           ├── mariadb-statefulset.yaml
│           ├── mariadb-service.yaml
│           ├── redis-statefulset.yaml
│           ├── redis-service.yaml
│           ├── networkpolicy.yaml
│           └── serviceaccount.yaml
│
├── .gitlab-ci.yml
├── .gitlab/
│   └── ci/
│       ├── lint.yml
│       ├── test.yml
│       ├── quality.yml
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
├── .npmrc.example
├── sonar-project.properties
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
   | /api/* et /auth/* proxy nginx
   |
   v
backend (Express + TypeScript + client confidentiel OIDC)
   |-------------------------------> ITK mock ou API réelle
   |-------------------------------> PropriaterayDB mock ou XML/XSD réel
   |-------------------------------> dossier NAS Samba monté sur /mnt/nas/xml
   |
   +--> MariaDB
   |
   +--> Redis pour sessions partagées ou survivance au crash (optionnel mais recommandé)
```

### Règles locales

- `MariaDB` est toujours présente.
- `Redis` peut être lancé via un profil `docker compose` dédié.
- Le backend doit pouvoir démarrer avec `SESSION_STORE=memory` ou `SESSION_STORE=redis`.
- Pour le dev isolé, prévoir `AUTH_MODE=mock` si l'`IdP OIDC` n'est pas disponible.
- Pour les tests d'intégration SSO, prévoir un `IdP` de test ou un environnement client dédié.
- Les logs `frontend`, `backend`, `nginx`, `MariaDB` et `Redis` doivent être lisibles via `docker compose logs`.

### Secrets locaux

- Copier `.env.example` vers `.env` pour le developpement local.
- `.env` est ignore par Git et ne doit jamais contenir de valeurs reutilisables en production.
- `docker-compose.yml` lit les secrets via interpolation `${...}` et echoue au demarrage si une valeur obligatoire manque.
- Le backend reste portable : il lit uniquement `process.env`, que les variables viennent de Docker Compose ou d'OpenShift.

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
      SESSION_SECRET: ${SESSION_SECRET:?SESSION_SECRET is required}
      NAS_XML_PATH: /mnt/nas/xml
      DB_HOST: db
      DB_PORT: 3306
      DB_NAME: propriateraydb
      DB_USER: propriateraydb
      DB_PASSWORD: ${DB_PASSWORD:?DB_PASSWORD is required}
      REDIS_HOST: redis
      REDIS_PORT: 6379
      REDIS_PASSWORD: ${REDIS_PASSWORD:?REDIS_PASSWORD is required}
      ITK_MOCK: "true"
      PROPRIATERAYDB_MOCK: "true"
    depends_on:
      - db
      - redis
    volumes:
      - ./data/nas:/mnt/nas/xml:ro

  db:
    image: mariadb:10.11
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD is required}
      MYSQL_DATABASE: propriateraydb
      MYSQL_USER: propriateraydb
      MYSQL_PASSWORD: ${DB_PASSWORD:?DB_PASSWORD is required}
    volumes:
      - db_data:/var/lib/mysql
      - ./docker/mariadb/init.sql:/docker-entrypoint-initdb.d/init.sql:ro

  redis:
    image: redis:7-alpine
    command: ["sh", "-c", "redis-server /usr/local/etc/redis/redis.conf --requirepass \"$${REDIS_PASSWORD}\""]
    profiles: ["session-store"]
    environment:
      REDIS_PASSWORD: ${REDIS_PASSWORD:?REDIS_PASSWORD is required}
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
frontend Service (seul point d'entrée public)
   |
   v
frontend Deployment nginx
   |
   | /api/* et /auth/* proxy nginx
   |
   v
backend Service interne
   |
   v
backend Deployment
   |-------------------------------> Active Directory / IdP OIDC
   |-------------------------------> API ITK
   |-------------------------------> dossier NAS Samba monté sur /mnt/nas/xml
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

### Secrets OpenShift hors Helm

Les pods OpenShift n'ont pas besoin d'un fichier `.env`. Le chart reference des `Secret` deja presents dans le namespace, et Kubernetes injecte les variables dans les containers.

Avec le release Helm par defaut `propriateraydb`, creer ou mettre a jour les secrets hors Helm avec `oc` :

```sh
oc new-project propriateraydb || oc project propriateraydb

SESSION_SECRET="$(openssl rand -base64 48)"
OIDC_CLIENT_SECRET="$(openssl rand -base64 32)"
DB_PASSWORD="$(openssl rand -base64 32)"
MYSQL_ROOT_PASSWORD="$(openssl rand -base64 32)"
REDIS_PASSWORD="$(openssl rand -base64 32)"

oc create secret generic propriateraydb-backend-secrets \
  --from-literal=SESSION_SECRET="${SESSION_SECRET}" \
  --from-literal=OIDC_CLIENT_SECRET="${OIDC_CLIENT_SECRET}" \
  --dry-run=client -o yaml | oc apply -f -

oc create secret generic propriateraydb-mariadb-secrets \
  --from-literal=MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD}" \
  --from-literal=MYSQL_PASSWORD="${DB_PASSWORD}" \
  --dry-run=client -o yaml | oc apply -f -

oc create secret generic propriateraydb-redis-secrets \
  --from-literal=REDIS_PASSWORD="${REDIS_PASSWORD}" \
  --dry-run=client -o yaml | oc apply -f -
```

Apres une mise a jour de secret, redemarrer les workloads concernes :

```sh
oc rollout restart deploy/propriateraydb-backend
oc rollout restart statefulset/propriateraydb-redis
```

La rotation du mot de passe MariaDB demande aussi de modifier l'utilisateur dans la base de donnees. Mettre a jour uniquement le `Secret` Kubernetes et redemarrer le `StatefulSet` ne suffit pas pour une rotation complete.

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
          image: harbor.example.com/propriateraydb/backend@sha256:IMAGE_DIGEST
          ports:
            - containerPort: 3000
          envFrom:
            - configMapRef:
                name: propriateraydb-backend-config
            - secretRef:
                name: propriateraydb-backend-secrets
          env:
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: propriateraydb-mariadb-secrets
                  key: MYSQL_PASSWORD
            - name: REDIS_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: propriateraydb-redis-secrets
                  key: REDIS_PASSWORD
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
          env:
            - name: MYSQL_DATABASE
              value: propriateraydb
            - name: MYSQL_USER
              value: propriateraydb
            - name: MYSQL_ROOT_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: propriateraydb-mariadb-secrets
                  key: MYSQL_ROOT_PASSWORD
            - name: MYSQL_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: propriateraydb-mariadb-secrets
                  key: MYSQL_PASSWORD
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
- `enabled` si `backend.auth.sessionStore=redis` ou si la session doit survivre au crash backend

Si activé :

- `1 replica` suffit
- `Service` interne uniquement
- persistance facultative selon usage
- `REDIS_PASSWORD` vient du `Secret` OpenShift et Redis demarre avec `requirepass`
- pas de HA nécessaire au départ

## Runbook incident OpenShift

Cette procédure sert quand un déploiement provoque une erreur massive, des crashloops, une saturation de logs, ou un comportement dangereux pour les dépendances. L'ordre recommandé est : stopper le flux si nécessaire, préserver les preuves, rollback, puis nettoyer.

### 1. Identifier le contexte

```bash
export NS="propriateraydb-recette"
export RELEASE="propriateraydb"
oc project "$NS"
oc get pods
oc get deploy,statefulset,svc,route
helm status "$RELEASE" -n "$NS"
helm history "$RELEASE" -n "$NS"
```

### 2. Stopper le trafic si l'incident est actif

Si le backend surcharge une dépendance, génère une tempête d'erreurs, ou doit être arrêté immédiatement :

```bash
oc scale deployment/propriateraydb-backend --replicas=0 -n "$NS"
```

Si le problème vient du frontend public, il est aussi possible de couper temporairement le frontend :

```bash
oc scale deployment/propriateraydb-frontend --replicas=0 -n "$NS"
```

Privilégier un rollback direct si la version précédente est connue comme saine.

### 3. Préserver les preuves avant nettoyage

Ne pas supprimer les pods avant d'avoir récupéré les informations minimales :

```bash
oc get pods -n "$NS"
oc logs deployment/propriateraydb-backend -n "$NS" --tail=500
oc logs deployment/propriateraydb-frontend -n "$NS" --tail=500
oc describe pod <pod-name> -n "$NS"
oc get events -n "$NS" --sort-by=.lastTimestamp
helm get values "$RELEASE" -n "$NS"
helm get manifest "$RELEASE" -n "$NS" > "manifest-${RELEASE}.yaml"
```

Si une stack centralisée existe, noter l'intervalle d'incident, le namespace, la release Helm et le digest d'image déployé.

### 4. Rollback Helm

Le cas nominal est de revenir à la dernière révision saine :

```bash
helm history "$RELEASE" -n "$NS"
helm rollback "$RELEASE" <revision_saîne> -n "$NS"
oc rollout status deployment/propriateraydb-backend -n "$NS"
oc rollout status deployment/propriateraydb-frontend -n "$NS"
```

Après rollback, vérifier les endpoints :

```bash
oc get route -n "$NS"
oc logs deployment/propriateraydb-backend -n "$NS" --tail=100
oc logs deployment/propriateraydb-frontend -n "$NS" --tail=100
```

### 5. Nettoyage sûr

Actions généralement sûres :

- supprimer des pods crashlooping après collecte des logs
- redémarrer un deployment après correction de configuration
- supprimer des ReplicaSets anciens si le rollback n'est plus nécessaire
- supprimer des ConfigMaps ou Secrets temporaires créés manuellement

Commandes utiles :

```bash
oc delete pod -l app.kubernetes.io/component=backend -n "$NS"
oc rollout restart deployment/propriateraydb-backend -n "$NS"
oc rollout restart deployment/propriateraydb-frontend -n "$NS"
```

Actions à éviter sans validation explicite :

- supprimer des `PVC`
- supprimer les données MariaDB
- modifier ou supprimer le montage NAS
- supprimer des Secrets applicatifs sans sauvegarde
- supprimer la Route ou changer le DNS pendant l'incident
- supprimer les anciennes images Harbor nécessaires à un rollback

### 6. Cas release Helm bloquée

Si Helm est dans un état incohérent :

```bash
helm status "$RELEASE" -n "$NS"
helm list -n "$NS"
helm get all "$RELEASE" -n "$NS" > "helm-${RELEASE}-debug.txt"
```

En dernier recours seulement :

```bash
helm uninstall "$RELEASE" -n "$NS"
```

Cette commande supprime les ressources gérées par Helm. Elle ne doit pas être utilisée comme premier réflexe si un rollback est possible. Vérifier les `PVC` et la politique de rétention avant toute suppression de données.

### 7. Post-incident

- identifier le commit, les digests image et la révision Helm en cause
- vérifier si la quality gate, le smoke test ou les probes auraient dû détecter le problème
- créer une action corrective dans le Kanban
- conserver les images nécessaires au rollback jusqu'à clôture de l'incident
- documenter la cause, l'impact, la correction et le test de non-régression

## Helm

### Exemple de `values-production.yaml`

```yaml
frontend:
  replicas: 1
  image:
    repository: harbor.example.com/propriateraydb/frontend
    digest: ""

backend:
  replicas: 1
  image:
    repository: harbor.example.com/propriateraydb/backend
    digest: ""
  auth:
    mode: oidc
    sessionStore: redis
  secret:
    existingName: propriateraydb-backend-secrets
  oidc:
    issuerUrl: https://idp.example.com/realms/propriateraydb
    clientId: propriateraydb-backend
    redirectUri: https://propriateraydb.example.com/auth/callback
    scope: openid profile email
  nas:
    enabled: true
    existingClaim: propriateraydb-nas-pvc
    mountPath: /mnt/nas/xml
    readOnly: true

mariadb:
  enabled: true
  secret:
    existingName: propriateraydb-mariadb-secrets
  persistence:
    storage: 10Gi

redis:
  enabled: true
  secret:
    existingName: propriateraydb-redis-secrets
```

### Règle de scaling

- Si `backend.replicas=1`, `sessionStore=memory` reste possible mais les sessions sautent au redémarrage.
- Si `backend.replicas>1`, passer `sessionStore=redis`.
- Si la continuité de session est requise, utiliser `sessionStore=redis` même avec `1 replica`.

## GitLab CI/CD

### Emplacement des fichiers

- Le pipeline principal doit être à la racine : `.gitlab-ci.yml`
- Les jobs factorisés restent dans `.gitlab/ci/`

- Le job `helm_lint` valide le chart avec `helm lint` et `helm template` pour `values.yaml`, `values-recette.yaml` et `values-production.yaml`.

### Exemple de `.gitlab-ci.yml`

```yaml
include:
  - local: .gitlab/ci/lint.yml
  - local: .gitlab/ci/test.yml
  - local: .gitlab/ci/quality.yml
  - local: .gitlab/ci/build.yml
  - local: .gitlab/ci/deploy.yml

stages:
  - lint
  - test
  - quality
  - smoke
  - build
  - deploy

variables:
  HARBOR_REGISTRY: harbor.example.com
  HARBOR_PROJECT: propriateraydb
  REGISTRY: $HARBOR_REGISTRY/$HARBOR_PROJECT
  IMAGE_FRONTEND: $REGISTRY/frontend
  IMAGE_BACKEND: $REGISTRY/backend
  CI_TOOLS_IMAGE: $REGISTRY/ci-tools:ubi9
  BUILDAH_IMAGE: quay.io/buildah/stable:v1.43.1
  SONAR_SCANNER_IMAGE: sonarsource/sonar-scanner-cli:5.0.1
  OPENSHIFT_SERVER: https://api.ocp.example.com:6443
  OPENSHIFT_NAMESPACE: propriateraydb
```

### Déploiement Helm par digest

```yaml
deploy:
  stage: deploy
  image: $CI_TOOLS_IMAGE
  needs:
    - job: build
      artifacts: true
  only:
    - main
  before_script:
    - |
      set -eu
      for var in FRONTEND_IMAGE_DIGEST BACKEND_IMAGE_DIGEST OPENSHIFT_SERVER OPENSHIFT_TOKEN OPENSHIFT_NAMESPACE OPENSHIFT_ROUTE_HOST; do
        eval "value=\${$var:-}"
        if [ -z "$value" ]; then
          echo "$var is required" >&2
          exit 1
        fi
      done
    - |
      if [ -n "${OPENSHIFT_CA_PEM:-}" ]; then
        printf '%s\n' "$OPENSHIFT_CA_PEM" > openshift-ca.crt
        oc login "$OPENSHIFT_SERVER" --token="$OPENSHIFT_TOKEN" --certificate-authority=openshift-ca.crt
      else
        oc login "$OPENSHIFT_SERVER" --token="$OPENSHIFT_TOKEN" --insecure-skip-tls-verify="${OPENSHIFT_INSECURE_SKIP_TLS_VERIFY:-false}"
      fi
    - oc project "$OPENSHIFT_NAMESPACE" || oc new-project "$OPENSHIFT_NAMESPACE"
  script:
    - helm upgrade --install propriateraydb ./helm/propriateraydb \
        --namespace "$OPENSHIFT_NAMESPACE" \
        -f ./helm/propriateraydb/values-production.yaml \
        --set frontend.image.repository="$IMAGE_FRONTEND" \
        --set backend.image.repository="$IMAGE_BACKEND" \
        --set-string frontend.route.host="$OPENSHIFT_ROUTE_HOST" \
        --set frontend.image.digest="${FRONTEND_IMAGE_DIGEST}" \
        --set backend.image.digest="${BACKEND_IMAGE_DIGEST}"
```

Si le cluster utilise une autorite de certification privee, fournir `OPENSHIFT_CA_PEM` comme variable CI protegee. Le job de deploiement l'ecrit dans `openshift-ca.crt` et l'utilise pour `oc login`.

## Résumé de la cible

- `OpenID Connect` se termine côté backend.
- `Redis` est recommandé si l'application doit garder les sessions après crash backend.
- `MariaDB` existe en local et en prod.
- `MariaDB` en prod = `StatefulSet`, `1 replica`, sans HA.
- Le `NAS` est un partage `SMB/Samba` monté dans le backend, pas un service applicatif embarqué.
- Les adresses enterprise `OpenShift`, `Nexus`, `Harbor`, `OIDC` et `NAS` sont configurées via variables CI/CD et values Helm.
- Le chien de garde backend repose sur `startupProbe`, `readinessProbe`, `livenessProbe` et le `Deployment` OpenShift.
- L'observabilité minimale impose des logs disponibles en local via `docker compose logs` et en distant via `oc logs`.
- L'architecture locale est complète avec `frontend`, `backend`, `MariaDB` et `Redis`.
- L'architecture OpenShift est complète avec `frontend`, `backend`, `MariaDB` et `Redis` selon le besoin de persistance de session.
- Le déploiement OpenShift passe par `Helm` et des images référencées par `digest`.
- Le pipeline principal est bien `.gitlab-ci.yml` à la racine.
