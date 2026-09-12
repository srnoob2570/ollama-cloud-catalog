FROM oven/bun:1.4.0-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY docker/run-pipeline.sh /usr/local/bin/run-pipeline
RUN chmod +x /usr/local/bin/run-pipeline

# The container is only an exec target for Dokploy Schedule Jobs; it serves
# nothing, so keep the main process alive with a no-op.
CMD ["sleep", "infinity"]
