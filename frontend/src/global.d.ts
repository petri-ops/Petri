// CSS module 类型声明（Vite SPA 无 Docusaurus 的全局声明）
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
declare module '*.css';
