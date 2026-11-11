# 贡献指南

欢迎通过 fork 贡献：在自己的 fork 中新建分支，以自己的 Git 作者身份提交，再向本仓库的 `main` 发起 Pull Request（PR）。多人共同创作时请保留实际作者署名。贡献代码无需仓库写权限；PR 合并也不会授予维护权限。

请在 PR 中说明原来的行为、改动后的行为，以及维护者如何复现和验证。使用 Node.js 24，在仓库根目录运行以下命令：

```sh
npm ci
npm test
node scripts/audit-release.mjs --self-test
npm run build
```

完整发布审计的操作见 [Check 工作流](workflows/check.yml)。如果改动影响模型导入、装配预览或打印记录，请在本机验证相关操作，在 PR 中用文字说明结果。模型文件、可重建模型的网格数据、私有模型截图和测试资料请留在本机，不要加入 fork、提交、Issue 或 PR 附件。

所有变更都通过 PR 合入 `main`，包括维护者自己的变更。合并前须通过 GitHub Actions 的 `check`。外部贡献由有写权限的维护者审阅并批准；新增修改后需要重新审批。唯一维护者提交自己的 PR 时，可使用仅限 PR 的审批例外，仍须通过同一项检查。
