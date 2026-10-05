# The triage server. Serves plain HTTP on port 7171: put it behind a reverse
# proxy for HTTPS, and set TRIAGE_TRUST_PROXY=true when the proxy is the only
# way in. Data lives in /data, so mount a volume there. See compose.yaml.

FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS build

WORKDIR /src

COPY package.json bun.lock ./
COPY packages/effect-triage/package.json packages/effect-triage/
COPY packages/client/package.json packages/client/

RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY packages packages
COPY src src

RUN bun run build

RUN mkdir /data

FROM gcr.io/distroless/cc-debian12:nonroot

COPY --from=build /src/dist/triage /usr/local/bin/triage
COPY --from=build --chown=nonroot:nonroot /data /data

ENV TRIAGE_HOSTNAME=0.0.0.0 \
    TRIAGE_PORT=7171 \
    TRIAGE_SERVER_DB=/data/server.db

VOLUME /data

EXPOSE 7171

ENTRYPOINT ["/usr/local/bin/triage"]

CMD ["serve"]
