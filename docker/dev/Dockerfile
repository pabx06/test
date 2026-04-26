FROM registry.access.redhat.com/ubi9/ubi:9.5

ARG NODEJS_STREAM=20
ARG HELM_VERSION=v3.15.4
ARG OC_VERSION=4.16.0
ARG DOCKER_CLI_VERSION=27.3.1
ARG DOCKER_COMPOSE_VERSION=v2.29.7
ARG TARGETARCH

RUN set -eux; \
    dnf -y update; \
    dnf -y module enable "nodejs:${NODEJS_STREAM}"; \
    dnf -y install \
      ca-certificates \
      curl \
      findutils \
      git \
      gzip \
      hostname \
      jq \
      make \
      nodejs \
      npm \
      openssh-clients \
      openssl \
      procps-ng \
      tar \
      unzip \
      which \
      xz; \
    dnf clean all; \
    rm -rf /var/cache/dnf

RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) helm_arch=amd64; oc_archive=openshift-client-linux.tar.gz; docker_arch=x86_64 ;; \
      arm64) helm_arch=arm64; oc_archive=openshift-client-linux-arm64.tar.gz; docker_arch=aarch64 ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://get.helm.sh/helm-${HELM_VERSION}-linux-${helm_arch}.tar.gz" -o /tmp/helm.tgz; \
    tar -xzf /tmp/helm.tgz -C /tmp; \
    mv "/tmp/linux-${helm_arch}/helm" /usr/local/bin/helm; \
    curl -fsSL "https://mirror.openshift.com/pub/openshift-v4/clients/ocp/${OC_VERSION}/${oc_archive}" -o /tmp/oc.tgz; \
    tar -xzf /tmp/oc.tgz -C /usr/local/bin oc kubectl; \
    curl -fsSL "https://download.docker.com/linux/static/stable/${docker_arch}/docker-${DOCKER_CLI_VERSION}.tgz" -o /tmp/docker.tgz; \
    tar -xzf /tmp/docker.tgz -C /tmp; \
    mv /tmp/docker/docker /usr/local/bin/docker; \
    mkdir -p /usr/local/lib/docker/cli-plugins; \
    curl -fsSL "https://github.com/docker/compose/releases/download/${DOCKER_COMPOSE_VERSION}/docker-compose-linux-${helm_arch}" -o /usr/local/lib/docker/cli-plugins/docker-compose; \
    chmod +x /usr/local/bin/helm /usr/local/bin/oc /usr/local/bin/kubectl /usr/local/bin/docker /usr/local/lib/docker/cli-plugins/docker-compose; \
    rm -rf /tmp/*

WORKDIR /workspace

CMD ["/bin/bash"]
