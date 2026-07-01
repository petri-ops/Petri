/// <reference types="vite/client" />

declare module 'virtual:biof3-blog-meta' {
  interface BlogMetaEntry {
    slug: string;
    title: string;
    date: string;
    authors: string[];
    tags: string[];
    description: string;
  }
  const metas: BlogMetaEntry[];
  export default metas;
}
