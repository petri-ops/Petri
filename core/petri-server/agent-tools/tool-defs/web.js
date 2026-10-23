/**
 * agent-tools/tool-defs/web.js — 联网检索与抓取工具 Schema（BLOCK-247 / Q2b）。
 * 由 tool-defs.js facade 汇编，勿直接 require（统一走 facade）。
 * 执行元数据（readOnly/destructive/...）见 ../tool-metadata.js。
 *
 * 描述里刻意写明「默认关 + 需要配置」：模型在未授权时应当去要授权，而不是反复重试。
 */

module.exports = [
  {
    "type": "function",
    "function": {
      "name": "web_search",
      "description": "联网检索（只读外部请求）。返回带 title/url/snippet 与来源主机名的结果列表；结果条数与单条摘要均有上限。默认关闭：未在「设置 → 网络与联网」开启时返回 web_access_disabled；已开启但未配置检索后端时返回 web_search_not_configured（这两种都不是「搜索无结果」，不要据此断言网上没有该内容）。",
      "parameters": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "description": "检索词（≤400 字符）。用关键词而非整句提问，效果更好"
          },
          "count": {
            "type": "integer",
            "description": "返回条数，默认取设置里的 maxResults（1–20）"
          }
        },
        "required": [
          "query"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "web_fetch",
      "description": "抓取单个网页并转成可读纯文本（只读外部请求）。逐跳校验重定向目标、拒绝本机/内网/保留地址、只接受文本类 content-type、超时与字节/字符双上限；返回正文、标题、最终 URL、重定向链与成本（请求数/字节数）。默认关闭（web_access_disabled）。正文超限会截断并标注，引用请以来源链接为准。",
      "parameters": {
        "type": "object",
        "properties": {
          "url": {
            "type": "string",
            "description": "要抓取的 http(s) 绝对 URL（不传凭据、不支持 file:/ftp:）"
          }
        },
        "required": [
          "url"
        ]
      }
    }
  },
];
