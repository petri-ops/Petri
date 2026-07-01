// FigInline — 桌面版降级实现
// 原版依赖 figcode/_data-lite + copilot（重），扫描显示仅 3 文件用。
// 桌面版降级为：渲染标题 + 图片占位 + "在 FigCode 打开"链接。
//
// MDX 用法（不变）:
//   import FigInline from '@site/src/components/FigInline';
//   <FigInline id="volcano" title="火山图" />

import React from 'react';
import { Link } from 'react-router-dom';

interface Props {
  id: string;
  title?: string;
  caption?: string;
  children?: React.ReactNode;
}

export default function FigInline({ id, title, caption, children }: Props) {
  return (
    <figure className="biof3-fig-inline">
      {title && <figcaption className="biof3-fig-inline__title">{title}</figcaption>}
      {caption && <p className="biof3-fig-inline__caption">{caption}</p>}
      {children}
      <Link to={`/figcode#${id}`} className="biof3-fig-inline__link">
        在 FigCode 打开 →
      </Link>
    </figure>
  );
}
