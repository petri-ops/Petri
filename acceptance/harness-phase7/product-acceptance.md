# Harness Phase 7 P7-H 产品验收

- 时间：2026-07-20T23:41:06.067Z
- 基线 Commit：`80ca1990bb4aa7e261939b361de56b1a3b816788`
- 模式：离线临时项目，经生产 interceptor / policy / preflight / workspace handler 完整链路。
- 隐私：不访问真实项目、用户数据库、Provider、凭据或科学分析 Job；不保存文件正文和绝对路径。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| list_hides_sensitive_entries | PASS | ok=true, path=., truncated=false, entryCount=2 |
| find_project_csv | PASS | ok=true, truncated=false, matchCount=1 |
| search_returns_path_and_line | PASS | ok=true, truncated=false, matchCount=1 |
| read_is_bounded_and_hashed | PASS | ok=true, path=data/genes.csv, sha256=64ce4a52f507fbb974590392d68f06fb3773ac1c846944c4ec27e7cd7c9e5475, truncated=true, startLine=2, endLine=2, totalLines=4 |
| write_dry_run_has_no_side_effect | PASS | ok=true, path=notes/session.txt, created=true, dryRun=true, sha256=3873d3053d4624cc8b8ec32df26bcbbe0c19ea4ae68885e7c7dba32c0c020042, previousSha256=null |
| write_then_read | PASS | ok=true, path=notes/session.txt, created=true, dryRun=false, sha256=3873d3053d4624cc8b8ec32df26bcbbe0c19ea4ae68885e7c7dba32c0c020042, previousSha256=null, contentSha256=3873d3053d4624cc8b8ec32df26bcbbe0c19ea4ae68885e7c7dba32c0c020042 |
| replace_dry_run_preserves_file | PASS | ok=true, path=notes/review.txt, dryRun=true, replacements=1, sha256=0ecc08d8ea6c4ee44c5d85cbb8937ec94c1f9957f7c131e022b1b269da666714, previousSha256=8bb933304cb4e2c36af0d2d95b7afc64110fedd334c3b824e33b0aea375e3470 |
| sha_guarded_replace_then_read | PASS | ok=true, path=notes/review.txt, dryRun=false, replacements=1, sha256=0ecc08d8ea6c4ee44c5d85cbb8937ec94c1f9957f7c131e022b1b269da666714, previousSha256=8bb933304cb4e2c36af0d2d95b7afc64110fedd334c3b824e33b0aea375e3470, contentSha256=0ecc08d8ea6c4ee44c5d85cbb8937ec94c1f9957f7c131e022b1b269da666714 |
| allowlisted_exec_uses_project_cwd | PASS | ok=true, exitCode=0, truncated=false, cwdRedacted=[project workspace] |
| read_only_policy_blocks_side_effects | PASS | writeError=execution_not_allowed, execError=execution_not_allowed |
| path_policy_blocks_sensitive_and_escape | PASS | sensitiveError=sensitive_path, escapeError=path_escape |
| command_policy_blocks_remote_git | PASS | ok=false, error=command_blocked |
| project_ownership_is_enforced | PASS | ok=false, error=permission_denied |

总计：13/13 PASS
