# The triage server. Serves plain HTTP on port 7171: put it behind a reverse
# proxy for HTTPS, and set TRIAGE_TRUST_PROXY=true when the proxy is the only
# way in. Data lives in /data, so mount a volume there. See compose.yaml.
#
# The default target runs as nonroot. The `app` target is the Home Assistant
# app, which runs as root because the Supervisor creates /data, and writes
# /data/options.json with mode 0600, as root. It also has journalctl, to read
# the host journal.

FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS build

WORKDIR /src

COPY package.json bun.lock bunfig.toml ./
COPY packages/effect-triage/package.json packages/effect-triage/
COPY packages/client/package.json packages/client/
COPY web/package.json web/

RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY packages packages
COPY web web
COPY src src

RUN bun run build

RUN mkdir /data

# journalctl and the libraries it needs beyond the distroless image's glibc and
# libstdc++, for the app to read the host journal the Supervisor mounts.
FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587 AS journal

RUN apt-get update \
    && apt-get install -y --no-install-recommends systemd \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir /out \
    && cp --parents /usr/bin/journalctl /out \
    && ldd /usr/bin/journalctl \
    | awk '$2 == "=>" && $3 ~ /^\// { print $3 }' \
    | grep -vE '/(libc|libm|libpthread|libdl|librt|libresolv|libgcc_s|libstdc\+\+)\.so' \
    | xargs -I {} cp --parents -L {} /out

FROM gcr.io/distroless/cc-debian12:nonroot@sha256:9dac0a79194e45a7da0158a9c6da57b217585af0786db3845d1f0ec1a0dd182f AS base

COPY --from=build /src/dist/triage /usr/local/bin/triage

ENV TRIAGE_HOSTNAME=:: \
    TRIAGE_PORT=7171 \
    TRIAGE_SERVER_DB=/data/server.db

EXPOSE 7171

ENTRYPOINT ["/usr/local/bin/triage"]

CMD ["serve"]

FROM base AS app

COPY --from=journal /out /

USER root

FROM base AS server

COPY --from=build --chown=nonroot:nonroot /data /data

USER nonroot

VOLUME /data
