// Docusaurus useBaseUrl 的桌面版 mock
// Docusaurus 用 useBaseUrl('/img/x.png') 给路径加 baseUrl 前缀（如 /Gewu/）
// 桌面版 SPA 无 baseUrl，直接返回原路径
export function useBaseUrl(url: string | undefined): string {
  return url ?? '';
}

export default useBaseUrl;
