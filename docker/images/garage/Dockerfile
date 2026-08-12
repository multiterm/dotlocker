# syntax=docker/dockerfile:1.7
ARG GARAGE_VERSION=v1.1.0
FROM dxflrs/garage:${GARAGE_VERSION}

LABEL org.opencontainers.image.title="Dotlocker Garage"
LABEL org.opencontainers.image.description="Garage object storage runtime for encrypted Dotlocker objects"

COPY garage.toml /etc/garage.toml
ENTRYPOINT ["/garage"]
CMD ["server"]
