# Local Path Map

> 历史检查点：这是旧 Windows 开发机的路径关系，不适用于当前 macOS 工作区，也不是当前路径规范。

最后更新：2026-07-11

这份说明只讲本机 `Documents` 下这几个目录的真实关系，避免以后把源码仓、教程仓和运行数据目录混在一起。

## 目录关系

```text
C:\Users\devah\Documents\
├─ BioF3/             # 教程 / 文档站源码仓
├─ biof3-tutorials/   # 另一份独立的教程站源码仓
├─ biof3-desktop/     # 桌面壳源码仓
└─ BioF3-Local/       # 本机运行数据目录
```

## 各自定位

### `C:\Users\devah\Documents\BioF3`

- 这是 BioF3 教程站源码仓，远端是 `https://github.com/ShengXinF3/BioF3.git`
- 主要内容是 Docusaurus 教程、博客、静态站资源
- 它是“内容站 / 教程站”，不是桌面壳，也不是运行数据目录

### `C:\Users\devah\Documents\biof3-tutorials`

- 这是另一份独立的教程站源码仓，远端是 `https://github.com/ShengXinF3/biof3-tutorials.git`
- 和 `BioF3` 同属教程内容线，但它是单独仓库，不是 `biof3-desktop` 的子目录
- 如果以后要改教程内容，先确认改的是哪一个教程仓

### `C:\Users\devah\Documents\biof3-desktop`

- 这是桌面应用源码仓，远端是 `https://github.com/ShengXinF3/biof3-desktop.git`
- 它负责 Electron 壳、前端工作台、IPC、Harness 调度
- 仓内 `vendor/biof3-core` 是 core 子模块，对应上游 `BioF3` 核心仓的一份嵌入式 checkout

### `C:\Users\devah\Documents\BioF3-Local`

- 这是桌面应用的本机运行数据目录，不是源码仓
- 默认由代码当作 `BIOF3_LOCAL_DATA_DIR` 使用
- `runtimes/` 下面放的是运行时插件的安装记录和 runtime 目录；它们是按平台区分的，不同系统不能共用同一份二进制
- 这台 Windows 机当前真正可用的 runtime 是系统安装的 `D:\Programs\Python\Python312` 和 `C:\Program Files\R\R-4.6.1`
- 旧的 mac 版 `BioF3-Local\runtimes\Python` / `BioF3-Local\runtimes\R` 目录还在，但只能作为历史遗留参考，不能当作 Windows 可执行 runtime
- 典型内容：
  - `biof3.db`
  - `results/`
  - `uploads/`
  - `projects/`
  - `plugins/`
  - `runtimes/`
  - `logs/`
  - `tmp/`
- `BioF3-Local.zip` 只是这个目录的历史备份，不是运行目录本身

## 关系结论

1. `BioF3`、`biof3-tutorials`、`biof3-desktop` 是三个并列的源码仓。
2. `BioF3-Local` 是运行数据仓，不参与源码管理。
3. `biof3-desktop/vendor/biof3-core` 是桌面仓内嵌的 core 子模块，不等于旁边那个 `BioF3` 目录，但两者都指向 BioF3 核心代码线。
4. 以后改桌面壳，看 `biof3-desktop`。
5. 以后改教程内容，先分清是 `BioF3` 还是 `biof3-tutorials`。
6. 以后找本机分析结果、运行日志、插件、runtime，去 `BioF3-Local`。
7. 运行时插件是平台绑定的，Windows 不会直接加载 macOS 版 runtime 目录。
