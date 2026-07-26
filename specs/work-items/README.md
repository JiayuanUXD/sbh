# Task Packet 使用说明

Task Packet 是单次开发会话的最小上下文单元。每个进行中的任务使用一个文件，完成后保留作为交接和验收索引。

命名：

```text
<模块>-<任务编号>-<短名称>.md
backend-M4.7-effective-supply.md
frontend-F5.4-inquiry-idempotency.md
```

使用规则：

1. 一次会话只选择一个主任务编号。
2. 从 [`TEMPLATE.md`](./TEMPLATE.md) 复制并填写。
3. 只引用直接相关的专项 Agent、PRD 章节、代码和测试。
4. 明确非目标，防止任务扩张。
5. 长日志和截图写到 `artifacts/verification/<task-id>/`。
6. 完成后把 Tasks 中的详细过程压缩为结论和 Task Packet 链接。

