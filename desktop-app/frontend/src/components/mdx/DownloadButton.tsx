// DownloadButton — 桌面版 MDX 组件（去 Docusaurus useBaseUrl）

import React from 'react';

interface DownloadButtonProps {
  fileUrl: string;
  fileName: string;
  fileSize?: string;
  children?: React.ReactNode;
}

const DownloadButton: React.FC<DownloadButtonProps> = ({
  fileUrl,
  fileName,
  fileSize,
  children,
}) => {
  const isExternalUrl = /^https?:\/\//.test(fileUrl);
  // 桌面版无 baseUrl，直接用原路径
  const resolvedFileUrl = fileUrl;

  return (
    <div className="biof3-download">
      <div className="biof3-download__meta">
        <span className="biof3-download__name">{fileName}</span>
        {fileSize && <span className="biof3-download__size">{fileSize}</span>}
      </div>
      <a
        className="biof3-download__button"
        href={resolvedFileUrl}
        download={isExternalUrl ? undefined : fileName}
      >
        <span className="biof3-download__icon" aria-hidden="true">
          ↓
        </span>
        <span>{children || '下载文件'}</span>
      </a>
    </div>
  );
};

export default DownloadButton;
