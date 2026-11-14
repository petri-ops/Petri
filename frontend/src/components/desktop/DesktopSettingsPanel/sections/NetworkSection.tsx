/**
 * NetworkSection — 联网与代理分区（BLOCK-424 信息架构拆分）。
 *
 * 从「计算与数据」抽出：HTTP/HTTPS 代理与自签 CA、联网检索与抓取授权。
 * 这两块是「对外网络访问」的同一关注点；原分区把 SSH / 数据目录 / 联邦 /
 * 代理 / 检索 / 回收站六件事压在一起，用户找不到也读不完。
 */
import React from 'react';
import { NetworkProxyPanel } from './NetworkProxyPanel';
import { WebAccessPanel } from './WebAccessPanel';

export function NetworkSection(): React.ReactElement {
  return (
    <section className="petri-settings-section">
      <div className="petri-settings-section__heading">
        <h3>联网与代理</h3>
        <p>出网代理、自签证书与联网检索授权（默认关闭，开启前请确认范围）。</p>
      </div>
      <NetworkProxyPanel />
      <hr className="petri-section-divider" />
      <WebAccessPanel />
    </section>
  );
}
