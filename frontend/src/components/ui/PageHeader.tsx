// PageHeader — 桌面版（Vite SPA）
// 去 Docusaurus Link，用 react-router-dom Link；去 IS_DESKTOP 分支（恒为桌面）

import React from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '@/components/icons/Icon';
import './PageHeader.css';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  breadcrumb?: BreadcrumbItem[];
}

export function PageHeader({
  title,
  subtitle,
  icon,
  breadcrumb,
}: PageHeaderProps): React.ReactElement {
  return (
    <div className="biof3-page-header biof3-page-header--desktop">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="biof3-page-header__breadcrumb" aria-label="面包屑">
          {breadcrumb.map((item, i) => {
            const isLast = i === breadcrumb.length - 1;
            return (
              <span key={i} className="biof3-page-header__crumb-wrap">
                {item.href && !isLast ? (
                  <Link to={item.href} className="biof3-page-header__crumb">
                    {item.label}
                  </Link>
                ) : (
                  <span
                    className={`biof3-page-header__crumb ${isLast ? 'biof3-page-header__crumb--current' : ''}`}
                  >
                    {item.label}
                  </span>
                )}
                {!isLast && <span className="biof3-page-header__sep">/</span>}
              </span>
            );
          })}
        </nav>
      )}
      <div className="biof3-page-header__main">
        {icon && (
          <span className="biof3-page-header__icon">
            <Icon name={icon} size={22} />
          </span>
        )}
        <div className="biof3-page-header__titles">
          <h1 className="biof3-page-header__title">{title}</h1>
          {subtitle && <p className="biof3-page-header__subtitle">{subtitle}</p>}
        </div>
      </div>
    </div>
  );
}

export default PageHeader;
