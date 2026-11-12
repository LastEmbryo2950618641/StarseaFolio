# Windows 持续发布

源码包版本维持 `0.0.1`。唯一入口 Build EXE and APK 在推送到 master、dev-0.0.1、版本标签或手动运行时自动构建 Windows 和 Android。Build 同时包含发布：EXE 与预览 APK 都成功后，将两端安装包及 Windows 更新清单上传到同一个 Release，再公开为 Latest；任一平台失败均不发布。

发布流水线跨分支串行执行，取已有 Release（包括草稿）最大构建号加一与自身运行序号的较大值。兼容旧版 `(build 17)` 发布名称，重跑不会覆盖已有版本；失败可能跳号。Windows 四段文件版本支持构建号至 65535，达到上限时流水线会拒绝打包。

对外版本、安装包文件名和清单使用 `0.0.1-N`；Git 标签为 `v0.0.1-N`，Windows 文件版本为 `0.0.1.N`。基础版本通过 electron-builder 的 extraMetadata 覆盖到包内，源码清单与锁文件无需每次改动。打包临时写入 build-info.json，并在退出时还原源文件。

先创建 Release 草稿并上传完整安装包和 latest.json，再公开并标记为 Latest。虽然版本含连字符，GitHub Release 明确设置为非 prerelease，以保持旧客户端 `/releases/latest/download/latest.json` 更新地址有效。每个发布均保留独立资产地址。

更新器比较基础版本，再比较数字构建号；兼容旧版无后缀版本和单独 buildNumber，同版本或旧版本不提示。Windows 更新清单和安装包都通过 Electron 网络层请求，以遵循桌面应用的系统代理设置。每次启动都静默检测，不受上次检测时间限制；未发现更新或网络失败时不自动弹窗。运行中默认每小时检测，按最近一次检测时间安排下一次；返回窗口或网络恢复时补查到期更新。书库侧栏始终提供检查/重试入口，并显示检测中、可更新或失败状态。同一个新版本每次应用会话自动弹出一次，可稍后下载；下载和安装均需用户确认。

本地 `pnpm package:exe` 可以用 BUILD_NUMBER 显式指定构建号，但不会分配公开序号或发布。正式分发应使用 Build EXE and APK。旧客户端的默认 any_change 模式能发现新格式；手动配置过旧版 semver 模式的安装可能需先下载安装新版一次。
