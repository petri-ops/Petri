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

declare module 'virtual:biof3-docs-sidebar' {
  interface DocItem {
    id: string;
    title: string;
    position: number;
  }
  interface DocCategory {
    id: string;
    label: string;
    position: number;
    items: DocItem[];
  }
  interface DocsSidebarTree {
    root: DocItem[];
    categories: DocCategory[];
  }
  const tree: DocsSidebarTree;
  export default tree;
}
