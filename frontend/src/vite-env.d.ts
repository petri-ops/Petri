/// <reference types="vite/client" />

declare module 'virtual:petri-docs-sidebar' {
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
