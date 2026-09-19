FROM alpine@sha256:4bcff63911fcb4448bd4fdacec207030997caf25e9bea4045fa6c8c44de311d1

ARG TARGETARCH
ARG OMP_VERSION=18.1.14

RUN apk add --no-cache \
      ca-certificates=20260909-r0 \
      git=2.49.1-r0 \
      libgcc=14.2.0-r6 \
      libstdc++=14.2.0-r6 \
    && case "$TARGETARCH" in \
      arm64) \
        asset="omp-linux-musl-arm64"; \
        checksum="b5401be8afee11bd706b452660844101985f89774ecb2aeee03d588d60b942aa" ;; \
      amd64) \
        asset="omp-linux-musl-x64"; \
        checksum="617d67627154f2e1a07d5bae36e190a47240a55379a3308cd61e7f62b4ce2e82" ;; \
      *) echo "Unsupported OMP image architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && wget -q "https://github.com/can1357/oh-my-pi/releases/download/v${OMP_VERSION}/${asset}" -O /usr/local/bin/omp \
    && echo "${checksum}  /usr/local/bin/omp" | sha256sum -c - \
    && chmod 0755 /usr/local/bin/omp \
    && omp --version | grep -Fx "omp/${OMP_VERSION}"

LABEL org.opencontainers.image.title="Code Nest OMP participant"
LABEL org.opencontainers.image.version="18.1.14"
LABEL org.opencontainers.image.source="https://github.com/can1357/oh-my-pi"

ENTRYPOINT ["/bin/sh"]
