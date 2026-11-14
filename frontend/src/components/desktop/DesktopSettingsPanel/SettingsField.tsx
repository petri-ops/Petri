/**
 * SettingsField — 设置项统一行（BLOCK-425 排版重构）。
 *
 * 参照 reference/ZCode `docs/ui/settings-form-layout.md` 的信息密度原则：
 * 每项只保留「图标 + 名称 + 一句说明 + 控件」，说明压到一行以内，用户扫读即可判断作用。
 * 此前每项是「裸 label + 控件 + 两三行长 hint」，读起来像文档而不是设置面板。
 *
 * 语义不变：`label` 仍与控件 `id` 关联（`htmlFor`），图标 `aria-hidden`。
 */
import React from 'react';
import type { IconName } from '@/components/icons/Icon';
import { Icon } from '@/components/icons/Icon';

interface Props {
  /** 左侧语义图标：与分区图标同族，帮助快速定位。 */
  icon: IconName;
  /** 设置项名称（功能名，名词短语）。 */
  label: string;
  /** 一句话说明「这项是干什么的」；超过一行的信息应下沉到详情而不是堆在这里。 */
  hint?: string;
  /** 说明右侧的补充读数（如「当前：日间」）。 */
  meta?: React.ReactNode;
  /** 控件 `id`，用于 label 关联。 */
  htmlFor?: string;
  /** 开关类设置：控件贴右侧与标题同行（`hint` 落到标题下方），而不是独占下一行。 */
  trailing?: boolean;
  children: React.ReactNode;
}

export function SettingsField({ icon, label, hint, meta, htmlFor, trailing, children }: Props): React.ReactElement {
  return (
    <div className="petri-field petri-field--iconed">
      <span className="petri-field__icon" aria-hidden="true">
        <Icon name={icon} size={16} />
      </span>
      <div className="petri-field__main">
        {trailing ? (
          <div className="petri-field__head petri-field__head--trailing">
            <div className="petri-field__text">
              <label className="petri-field__label" htmlFor={htmlFor}>{label}</label>
              {hint && <p className="petri-field__hint">{hint}</p>}
            </div>
            <div className="petri-field__control">{children}</div>
          </div>
        ) : (
          <>
            <div className="petri-field__head">
              <label className="petri-field__label" htmlFor={htmlFor}>{label}</label>
              {meta && <span className="petri-field__meta">{meta}</span>}
            </div>
            <div className="petri-field__control">{children}</div>
            {hint && <p className="petri-field__hint">{hint}</p>}
          </>
        )}
      </div>
    </div>
  );
}
