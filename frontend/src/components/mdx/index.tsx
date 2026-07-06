// MDX 组件注册表 — 桌面版 docs/blog 渲染用
// 通过 @mdx-js/react 的 MDXProvider 注入，让 .md/.mdx 里的
// <DownloadButton> <TryOnline> <FigInline> 能解析。
//
// 注意：docs 里 import 的是 '@site/src/components/X'，
// 桌面版 Vite 无此 alias，MDX 编译时会找不到。
// 解决：在 vite.config.ts 的 mdx 选项里用 remark 插件改写 import 路径，
// 或在这里统一映射。当前用 remark-mdx-import-rewrite（见 vite 配置）。

import React from 'react';
import type { Components } from '@mdx-js/react';
import DownloadButton from './DownloadButton';
import TryOnline from './TryOnline';
import FigInline from './FigInline';

// 链接改写：docs 里 /docs/xxx 根绝对路径 → react-router Link
function MDXLink({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  // 外部链接走 <a>
  if (href && /^https?:\/\//.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  }
  // 内部链接用 props（MDX 默认渲染 a，浏览器 hash 路由能处理）
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}

export const mdxComponents: Components = {
  DownloadButton,
  TryOnline,
  FigInline,
  a: MDXLink,
};

export { DownloadButton, TryOnline, FigInline };
