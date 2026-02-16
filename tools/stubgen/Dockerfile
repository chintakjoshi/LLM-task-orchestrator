FROM node:22-bookworm-slim

ENV PIP_NO_CACHE_DIR=1

WORKDIR /workspace

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m pip install --break-system-packages \
    grpcio==1.62.3 \
    grpcio-tools==1.62.3 \
    protobuf==4.25.8

RUN npm install -g \
    grpc-tools@1.13.0 \
    ts-proto@2.7.7
