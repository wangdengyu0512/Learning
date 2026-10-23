# 文章内嵌交互架构图测试点

需求：文章当前页面直接显示和操作交互图。
环境：http://localhost:8765/posts/city-agent-governance-interactive-architecture/

| 编号 | 测试点 | 预期结果 | 场景类型 | 优先级 |
| --- | --- | --- | --- | --- |
| Learning-inline-display-0-001 | 打开文章 | 正文直接显示交互图和播放控件，无需点击跳转链接 | 正常 | 高 |
| Learning-inline-controls-0-002 | 下一步、上一步、播放、暂停、重置 | 步骤和播放状态随操作变化，浏览器保留文章地址 | 正常 | 高 |
| Learning-inline-branch-0-003 | 切换核验结果 | 未通过时显示返工流程，通过时恢复正常流程 | 正常 | 高 |
| Learning-inline-mobile-2-004 | 390px 手机宽度 | 页面无横向溢出，图内允许横向查看，步骤变化后框架高度适配内容 | 边界 | 高 |
