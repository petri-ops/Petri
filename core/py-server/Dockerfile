# BioF3 Python Analysis Container
#
# Pre-installs the full bioinformatics Python stack.
# Used by py-server via `docker exec`.
#
# Build:
#   docker build -t biof3-python:latest -f py-server/Dockerfile .
#
# Run:
#   docker run -d --name biof3_python_1 \
#     -v /mnt/storage_16tb/omichub/biof3-py-tmp:/app/data/biof3-py-tmp \
#     biof3-python:latest

FROM python:3.11-slim

# W1-1 (2026-05-28): 使用国内镜像源加速构建
# - apt: 阿里云（已知稳定，国内 dell 主机可达）
# - pip: 清华源（速度最快、镜像新）
# 失败时可注释掉这两行 RUN，回到默认源
RUN sed -i 's|http://deb.debian.org|http://mirrors.aliyun.com|g; s|http://security.debian.org|http://mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null \
 || sed -i 's|http://deb.debian.org|http://mirrors.aliyun.com|g; s|http://security.debian.org|http://mirrors.aliyun.com|g' /etc/apt/sources.list 2>/dev/null \
 || true

# pip: 清华主源 + 阿里云备用源 + 大幅增加超时（torch 等大包跨海下载常卡）
RUN pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple \
 && pip config set global.extra-index-url "https://mirrors.aliyun.com/pypi/simple/ https://pypi.org/simple" \
 && pip config set global.trusted-host "pypi.tuna.tsinghua.edu.cn mirrors.aliyun.com pypi.org" \
 && pip config set global.timeout 300 \
 && pip config set global.retries 5

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ gfortran libhdf5-dev libffi-dev \
    libxml2-dev libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Core scientific stack
RUN pip install --no-cache-dir \
    numpy==1.26.4 \
    pandas==2.2.2 \
    scipy==1.13.1 \
    matplotlib==3.9.0 \
    seaborn==0.13.2 \
    scikit-learn==1.5.0 \
    h5py==3.11.0 \
    anndata==0.10.7 \
    scanpy==1.10.1

# Bioinformatics extensions — torch 单独装（最大依赖，分层避免重试浪费）
RUN pip install --no-cache-dir torch==2.3.0
RUN pip install --no-cache-dir scvi-tools==1.1.2
RUN pip install --no-cache-dir \
    squidpy==1.4.1 \
    cellrank==2.0.2 \
    bbknn==1.6.0 \
    scanorama==1.7.4 \
    leidenalg==0.10.2 \
    harmonypy==0.0.10 \
    pynndescent==0.5.12

# Spatial transcriptomics stack (W1-1, 2026-05-28)
# spatialdata: 空间数据通用容器（OME-NGFF 标准）
# spatialdata-io: 10x Visium / Stereo-seq / MERFISH 加载器
# cell2location: 空间细胞解卷积（NB 概率模型）
# tangram-sc: 空间-单细胞映射（迁移学习）
# liana: 配体-受体推断（含 spatial-aware 模式）
# celltypist: 自动细胞注释（用于解卷积参考集预处理）
RUN pip install --no-cache-dir spatialdata==0.2.6 spatialdata-io==0.1.7
RUN pip install --no-cache-dir cell2location==0.1.4
RUN pip install --no-cache-dir tangram-sc==1.0.4
RUN pip install --no-cache-dir liana==1.4.0 celltypist==1.6.3

# Utilities
RUN pip install --no-cache-dir \
    jsonlines==4.0.0 \
    tqdm==4.66.4 \
    requests==2.32.3

# Working directory
WORKDIR /app
RUN mkdir -p /app/data/biof3-py-tmp

# Keep container alive (py-server uses docker exec)
CMD ["tail", "-f", "/dev/null"]
