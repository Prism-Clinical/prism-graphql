FROM pgvector/pgvector:pg15

# Install build dependencies for AGE compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    postgresql-server-dev-15 \
    git \
    ca-certificates \
    flex \
    bison \
    && rm -rf /var/lib/apt/lists/*

# Clone and compile Apache AGE 1.5.0 (pinned release — not main branch)
RUN git clone --branch PG15/v1.5.0-rc0 --depth 1 https://github.com/apache/age.git /tmp/age \
    && cd /tmp/age \
    && make \
    && make install \
    && rm -rf /tmp/age

# Clean up build dependencies to reduce image size
RUN apt-get purge -y build-essential postgresql-server-dev-15 git flex bison \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Pre-load AGE for all connections so LOAD 'age' is not needed per-session
RUN echo "shared_preload_libraries = 'age'" >> /usr/share/postgresql/postgresql.conf.sample
