# R Server 远程部署指南

## 服务器信息

```
Host: biof3.com
Port: 6022
User: root
R: /usr/bin/Rscript
```

## 1. 上传 r-server 到服务器

```bash
# 本地执行
scp -P 6022 -r r-server root@biof3.com:/opt/biof3-r-server
```

## 2. 在服务器上安装 Node.js 依赖

```bash
# SSH 到服务器
ssh -p 6022 root@biof3.com

# 安装 Node.js（如果没有）
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 安装依赖
cd /opt/biof3-r-server
npm install
```

## 3. 安装 R 包

```bash
Rscript -e '
pkgs <- c("ggplot2", "ggrepel", "pheatmap", "RColorBrewer",
          "survival", "survminer", "circlize", "igraph", "ggraph", "patchwork")
install.packages(pkgs, repos = "https://mirrors.tuna.tsinghua.edu.cn/CRAN/")

# Bioconductor 包
if (!require("BiocManager", quietly = TRUE)) install.packages("BiocManager")
BiocManager::install(c("maftools"))
'
```

## 4. 启动服务

```bash
# 前台测试
cd /opt/biof3-r-server
node server.js

# 后台运行（推荐用 pm2）
npm install -g pm2
pm2 start server.js --name biof3-r-server
pm2 save
pm2 startup
```

## 5. 开放端口

确保服务器安全组/防火墙放行 **3001** 端口（TCP 入站）。

阿里云控制台 → 安全组 → 添加规则：
- 协议: TCP
- 端口: 3001
- 来源: 0.0.0.0/0

## 6. 验证

```bash
# 本地测试
curl http://biof3.com:3001/api/health

# 应返回
# {"status":"ok","timestamp":"..."}
```

## 7. 前端已配置

`RunModal.tsx` 已配置：
- 本地开发（localhost）→ 连 `localhost:3001`
- 线上部署 → 连 `http://biof3.com:3001`

## 环境变量（可选）

如需修改端口：
```bash
R_SERVER_PORT=3001 node server.js
```
