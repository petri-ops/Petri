/**
 * BLOCK-154 波次 1 — highlight.js core + 宽语言清单按需注册（全仓唯一注册位）。
 *
 * 演进链：BLOCK-106 P1 把全量 highlight.js（190 语言）移出首屏关键 chunk，但刻意保留
 * 全量（「语言覆盖一份不减」，es.js chunk 实测 291,911 gzip 为最大单资产）。BLOCK-154
 * 经用户批量授权改按需注册，保留该初衷：清单覆盖全栈 + 科学计算/生物信息面
 * （R/Python/Julia/LaTeX/Fortran/MATLAB 等），只裁掉长尾（elixir/clojure 等未在列语言
 * 由 CodeHighlight 既有语义诚实降级纯文本，不崩、不猜语言）。
 *
 * 维护约定：新增语言 = 本文件加一对 import + registerLanguage（唯一注册位，无第二套
 * 语言清单），并视需要在 CodeHighlight.test.tsx 的锚断言补一条。
 */
import hljs from 'highlight.js/lib/core';

// Web / 文档
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import scss from 'highlight.js/lib/languages/scss';
import markdown from 'highlight.js/lib/languages/markdown';
import diff from 'highlight.js/lib/languages/diff';
import http from 'highlight.js/lib/languages/http';

// 脚本 / 标记
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import ini from 'highlight.js/lib/languages/ini';

// Shell
import bash from 'highlight.js/lib/languages/bash';
import powershell from 'highlight.js/lib/languages/powershell';

// 系统级 / 全栈
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import java from 'highlight.js/lib/languages/java';
import kotlin from 'highlight.js/lib/languages/kotlin';
import swift from 'highlight.js/lib/languages/swift';
import objectivec from 'highlight.js/lib/languages/objectivec';
import dart from 'highlight.js/lib/languages/dart';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import groovy from 'highlight.js/lib/languages/groovy';

// 数据 / API
import sql from 'highlight.js/lib/languages/sql';
import graphql from 'highlight.js/lib/languages/graphql';
import protobuf from 'highlight.js/lib/languages/protobuf';

// 科学计算 / 生物信息
import python from 'highlight.js/lib/languages/python';
import r from 'highlight.js/lib/languages/r';
import ruby from 'highlight.js/lib/languages/ruby';
import perl from 'highlight.js/lib/languages/perl';
import lua from 'highlight.js/lib/languages/lua';
import matlab from 'highlight.js/lib/languages/matlab';
import fortran from 'highlight.js/lib/languages/fortran';
import julia from 'highlight.js/lib/languages/julia';
import latex from 'highlight.js/lib/languages/latex';
import haskell from 'highlight.js/lib/languages/haskell';
import scala from 'highlight.js/lib/languages/scala';

// 工程文件
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import makefile from 'highlight.js/lib/languages/makefile';

hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('scss', scss);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('http', http);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('powershell', powershell);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('java', java);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('objectivec', objectivec);
hljs.registerLanguage('dart', dart);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('groovy', groovy);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('graphql', graphql);
hljs.registerLanguage('protobuf', protobuf);
hljs.registerLanguage('python', python);
hljs.registerLanguage('r', r);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('perl', perl);
hljs.registerLanguage('lua', lua);
hljs.registerLanguage('matlab', matlab);
hljs.registerLanguage('fortran', fortran);
hljs.registerLanguage('julia', julia);
hljs.registerLanguage('latex', latex);
hljs.registerLanguage('haskell', haskell);
hljs.registerLanguage('scala', scala);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('makefile', makefile);

export default hljs;
