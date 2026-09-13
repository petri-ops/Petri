# 指引：aliyun 反向隧道一次性配置（BLOCK-70 P3 · 无域名/IP 版）

> 目标：让手机在**任何网络**（4G/5G/公司 WiFi）通过 `https://<你的aliyun IP>` 打开 Gewu 移动页。
> 安全模型：家里电脑**不开任何入站端口**；桌面端只发起出站 `ssh -R`（钉 aliyun 回环）；
> 公网只有 aliyun 的 443（TLS 在 aliyun 终结）。以下均为**你自己的服务器**上的一次性操作。
>
> 本指引按 `root@112.120.48.126`（ECS Ubuntu，`~/.ssh/config` 别名 `aliyun`）示例；IP 换成你的。

## ① 生成自签证书（IP 版，无域名）

```bash
ssh aliyun
mkdir -p /etc/nginx/ssl
openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
  -keyout /etc/nginx/ssl/gewu.key -out /etc/nginx/ssl/gewu.crt \
  -subj "/CN=112.120.48.126" \
  -addext "subjectAltName=IP:112.120.48.126"
```

> 手机首次打开会弹「您的连接不是私密连接」——点「高级 → 继续访问」一次即可。
> 自签的加密强度与正规证书相同，只是没有 CA 背书。想去掉警告可后续给 IP 签
> ZeroSSL 免费 IP 证书（90 天一续），替换证书路径即可。

## ② 安装 nginx 并配置反代

```bash
apt update && apt install -y nginx
```

写入 `/etc/nginx/sites-available/gewu-mobile`：

```nginx
server {
    listen 443 ssl;
    server_name 112.120.48.126;

    ssl_certificate     /etc/nginx/ssl/gewu.crt;
    ssl_certificate_key /etc/nginx/ssl/gewu.key;

    # 移动页走 SSE 实时流，必须关缓冲
    proxy_buffering off;
    proxy_cache off;

    location / {
        proxy_pass http://127.0.0.1:2233;   # 端口=桌面端隧道配置的 remotePort
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 1h;              # SSE 长连接
        proxy_send_timeout 1h;
    }
}
```

启用并重载：

```bash
ln -sf /etc/nginx/sites-available/gewu-mobile /etc/nginx/sites-enabled/gewu-mobile
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

## ③ 阿里云安全组放行 443

控制台 → ECS → 安全组 → 添加入方向规则：TCP 443，源 0.0.0.0/0。
（这一步只能你在阿里云控制台做，服务器内无法代替。）

## ④ 桌面端配置

打开 Gewu 设置 →「计算与数据」→「手机连接」面板（或左栏底部「手机连接」）：

- SSH 主机别名：`aliyun`
- 公网地址：`https://112.120.48.126`
- 点「启用隧道」→ 状态变 **✓ 已连接·公网可用**
- 点「生成配对二维码」→ 此时二维码内容自动切换为公网地址

## ⑤ 验证

```bash
# 本机验证公网入口（-k 跳过自签校验）
curl -k https://112.120.48.126/m/api/health
# 期望：{"ok":true,"service":"gewu-mobile-gateway"}
```

手机（任意网络）浏览器打开 `https://112.120.48.126/m` → 警告页点继续 →
应显示「尚未配对」诚实空态 → 回桌面扫码即通。

## 排障

| 现象 | 处置 |
| --- | --- |
| 隧道状态「断开，重连中」 | 看 `~/.ssh/config` 的 aliyun 别名是否免密（`ssh aliyun echo ok`） |
| curl -k 超时 | 安全组 443 未放行，或 nginx 未启动（`systemctl status nginx`） |
| curl -k 返回 502 | 桌面端隧道未连接（remotePort 未监听），先看面板隧道状态 |
| 二维码还是局域网地址 | 隧道状态不是 connected，或公网地址没填/没保存 |

## 安全边界（务必知晓）

- ssh 全程 key-only（BatchMode），服务器侧无需 `GatewayPorts`（转发钉在回环）
- 公网面=nginx 443；移动面所有业务端点都有会话 token 鉴权 + 限速 + 审计
- 自签证书无法防「假服务器」钓鱼（没有第三方背书）；介意者配 ZeroSSL IP 证书或域名
- 不想在公网暴露时，随时在面板点「停用隧道」，公网入口立即消失
